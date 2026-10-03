/** JavaScript supporting tools for DTAB. Node: require('deltatab/tools'). Browser: load dtab and YAML first. */
'use strict'

;(() => {
    const core = typeof module !== 'undefined' && module.exports ? require('./dtab.js') : globalThis.dtab
    const YAML = typeof module !== 'undefined' && module.exports ? require('yaml') : globalThis.YAML
    const DEFAULT_TAB_SIZE = 4
    const MAX_YAML_INDENT = 9 // YAML's explicit block-scalar indentation indicator is one digit.
    const SCALAR_TOKENS = new Set(['scalar', 'single-quoted-scalar', 'double-quoted-scalar', 'block-scalar'])

    /**
     * Pure function. Expands one physical line's tabs and maps UTF-16 offsets to logical columns.
     * @param {string} text - One line, without its newline.
     * @param {number} tabSize - Positive tab-stop width.
     * @returns {{text: string, columns: number[]}} columns includes the end offset.
     * @example expandTabs('a\tb', 4) // {text: 'a   b', columns: [0, 1, 4, 5]}
     */
    function expandTabs(text, tabSize) {
        const columns = [0], chunks = []
        for (let index = 0; index < text.length; index++) {
            const width = text[index] === '\t' ? tabSize - columns.at(-1) % tabSize : 1
            chunks.push(text[index] === '\t' ? ' '.repeat(width) : text[index])
            columns.push(columns.at(-1) + width)
        }
        return {text: chunks.join(''), columns}
    }

    /**
     * Pure function. Collects typed tokens from a nested YAML concrete-syntax tree.
     * @param {*} value - Token, token array, or token field.
     * @returns {object[]} Tokens, including nested headers and comments but not text inside scalars.
     * @example cstTokens({type: 'document', end: [{type: 'comment', source: '# note'}]}).map(t => t.type)
     *   // ['document', 'comment']
     */
    function cstTokens(value) {
        if (Array.isArray(value)) return value.flatMap(cstTokens)
        if (!value || typeof value !== 'object') return []
        return [...(value.type ? [value] : []), ...Object.values(value).flatMap(cstTokens)]
    }

    /**
     * Pure function. Makes nonprinting characters visible rather than introducing invalid YAML comments.
     * @param {string} text - A comment line with line breaks already separated.
     * @returns {string}
     * @example printableComment('a\u0000b') // 'a\\u0000b'
     */
    function printableComment(text) {
        return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f\uD800-\uDFFF\uFFFE\uFFFF]/gu,
            char => '\\u' + char.codePointAt(0).toString(16).padStart(4, '0'))
    }

    /**
     * Command. Indexes and orders a fresh YAML tree; retains string bodies and emits cycle-safe integers.
     * @param {object} node - YAML AST node to mutate.
     * @param {Array<string|number>} path - Its final DTAB path.
     * @param {Map} records - First/last source entry per serialized path.
     * @param {Map} nodes - Destination of {node, key, path} records, modified in place.
     * @returns {void}
     * @example // indexNodes(doc.contents, [], records, nodes); nodes.get('["query"]').node.type === 'BLOCK_LITERAL'
     */
    function indexNodes(node, path, records, nodes) {
        const id = JSON.stringify(path)
        const info = {node, key: null, path, ...records.get(id)}
        nodes.set(id, info)
        if (YAML.isScalar(node)) {
            if (info.last?.body) node.type = YAML.Scalar.BLOCK_LITERAL
            else if (Number.isSafeInteger(Number(node.value)) && String(Number(node.value)) === node.value) node.value = Number(node.value)
        }
        if (YAML.isMap(node)) {
            node.items.sort((a, b) => records.get(JSON.stringify([...path, a.key.value])).order - records.get(JSON.stringify([...path, b.key.value])).order)
            for (const pair of node.items) {
                const next = [...path, pair.key.value]
                indexNodes(pair.value, next, records, nodes)
                nodes.get(JSON.stringify(next)).key = pair.key
            }
        } else if (YAML.isSeq(node)) {
            node.items.forEach((item, index) => indexNodes(item, [...path, index], records, nodes))
        }
    }

    /**
     * Command. Adds temporary layout comments to a fresh YAML document; returns their original content.
     * Original comment text stays out of these markers, so source text cannot impersonate a marker.
     * @param {object} doc - YAML document to mutate.
     * @param {object[]} entries - Provenance from core.parseWithSource().
     * @param {Map} nodes - Final-path YAML nodes.
     * @param {string} source - Original DTAB.
     * @param {number} tabSize - Source tab-stop width.
     * @returns {Map<string, object>} Printed marker -> original comment group or blank line.
     * @example // attachLayout(doc, entries, nodes, 'x 1\t note', 4).size === 1
     */
    function attachLayout(doc, entries, nodes, source, tabSize) {
        const groups = new Map(), counter = new YAML.LineCounter()
        const lines = source.split('\n').map(line => expandTabs(line, tabSize))
        let offset = 0
        for (const line of source.split('\n')) { counter.addNewLine(offset); offset += line.length + 1 }
        let pending = [], emitted = false
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index]
            if (entry.type === 'entry') {
                const target = nodes.get(JSON.stringify(entry.paths[0]))
                if (target) {
                    const place = target.key || target.node
                    // yaml flattens multiline block-header comments; keep older delta notes before the header.
                    if (target.node.type === YAML.Scalar.BLOCK_LITERAL && target.node.comment && (pending.length || entries[index + 1]?.owner === entry)) {
                        pending.unshift(target.node.comment)
                        target.node.comment = undefined
                    }
                    if (pending.length) place.commentBefore = [place.commentBefore, ...pending].filter(Boolean).join('\n')
                    pending = []
                    emitted = true
                }
                continue
            }
            let group, target
            if (entry.type === 'blank') {
                group = {blank: true}
            } else {
                const start = counter.linePos(entry.start)
                let end = entry.end
                while (entries[index + 1]?.type === 'comment' && entries[index + 1].owner === entry.owner &&
                    counter.linePos(entries[index + 1].start).line === start.line) end = entries[++index].end
                const line = lines[start.line - 1]
                const firstColumn = line.columns[start.col - 1]
                const lastColumn = line.columns[counter.linePos(end).col - 1]
                target = entry.owner && nodes.get(JSON.stringify(entry.owner.paths[0]))
                const scope = target ? (YAML.isCollection(target.node) ? target.path : target.path.slice(0, -1)) : entry.paths[0]
                group = {column: firstColumn - 1, text: line.text.slice(firstColumn + 1, lastColumn).replace(/\r$/, ''), scope: JSON.stringify(scope)}
            }
            const marker = ' dtab-layout-' + groups.size
            groups.set('#' + marker, group)
            if (target) {
                // A collection's key comment belongs on its header, not after all of its children.
                const place = YAML.isCollection(target.node) && target.node.items.length ? target.key : target.node
                if (place) place.comment = [place.comment, marker].filter(Boolean).join('\n')
                else pending.push(marker) // An anonymous container has no key; keep its note beside the first child.
            } else pending.push(marker)
        }
        if (pending.length) {
            if (emitted) doc.comment = pending.join('\n')
            else doc.commentBefore = pending.join('\n')
        }
        return groups
    }

    /**
     * Command. Uses flow collections only for uncommented, single-source-line subtrees.
     * @param {object} node - Fresh YAML node to mutate.
     * @param {Array<string|number>} path - Final path.
     * @param {Map} nodes - Node/source records.
     * @param {object} counter - Source YAML.LineCounter.
     * @returns {{first: number, last: number, decorated: boolean}} Subtree's source extent.
     * @example // compactRows(doc.contents, [], nodes, counter) keeps an inline matrix row in [ ... ].
     */
    function compactRows(node, path, nodes, counter) {
        const info = nodes.get(JSON.stringify(path))
        let first = info.first ? counter.linePos(info.first.start).line : Infinity
        let last = info.last ? counter.linePos(info.last.body?.[1] ?? info.last.end).line : -Infinity
        let decorated = Boolean(node.comment || node.commentBefore || info.key?.comment || info.key?.commentBefore || info.last?.body)
        const children = YAML.isMap(node) ? node.items.map(pair => [pair.key.value, pair.value]) : YAML.isSeq(node) ? node.items.map((item, index) => [index, item]) : []
        for (const [key, child] of children) {
            const span = compactRows(child, [...path, key], nodes, counter)
            first = Math.min(first, span.first)
            last = Math.max(last, span.last)
            decorated ||= span.decorated
        }
        if ((path.length || children.length > 1) && children.length && first === last && !decorated &&
            !(YAML.isMap(node) && children.length === 1 && typeof path.at(-1) === 'number')) node.flow = true
        return {first, last, decorated}
    }

    /**
     * Pure function. Restores comment columns and blank runs using YAML token boundaries, never scalar text.
     * Sibling documentation rows share any extra shift required by YAML punctuation or quoting.
     * @param {string} text - YAML containing only converter-generated comment markers.
     * @param {Map<string, object>} groups - Marker content and original columns.
     * @param {(string|number)[]} scalars - AST scalar values in emission order, including keys.
     * @returns {string} YAML with original comments and structural blanks restored.
     * @example alignLayout('x: "1" # marker\n', new Map([['# marker', {column: 8, text: 'note', scope: '[]'}]]), ['x', '1'])
     *   // 'x: "1"  # note\n'
     */
    function alignLayout(text, groups, scalars) {
        const tokens = cstTokens([...new YAML.Parser().parse(text)])
        const lines = text.split('\n'), counter = new YAML.LineCounter()
        let offset = 0
        for (const line of lines) { counter.addNewLine(offset); offset += line.length + 1 }
        const protectedLines = new Set(), literalLines = new Set(), comments = new Map(), shifts = new Map(), seen = new Set()
        let scalar = 0
        for (const token of tokens) {
            // The incorrect |2 header can make indent=1 body text look like YAML keys or comments.
            if (literalLines.size && literalLines.has(counter.linePos(token.offset).line - 1)) continue
            if (SCALAR_TOKENS.has(token.type)) {
                const value = scalars[scalar++]
                if (token.type === 'block-scalar' && /[1-9]/.test(token.props[0].source)) {
                    // yaml 2.9.1 hard-codes |2 even for indent=4. Derive the real prefix from the original value.
                    const sourceLines = value.split('\n'), bodyLines = token.source.split('\n')
                    const first = sourceLines.findIndex(line => line.trim())
                    const indent = bodyLines[first].length - sourceLines[first].length - token.indent
                    if (indent < 1 || indent > MAX_YAML_INDENT) throw new Error('Invalid emitted block-scalar indentation')
                    const {line, col} = counter.linePos(token.props[0].offset)
                    lines[line - 1] = lines[line - 1].slice(0, col - 1) + lines[line - 1].slice(col - 1).replace(/[1-9]/, String(indent))
                }
                const start = token.type === 'block-scalar' ? token.props.at(-1).offset + token.props.at(-1).source.length : token.offset
                if (token.type === 'block-scalar') {
                    const first = counter.linePos(start).line - 1
                    for (let line = first; line < first + value.split('\n').length; line++) {
                        literalLines.add(line); protectedLines.add(line)
                    }
                }
                if (token.source.length) {
                    const end = counter.linePos(start + token.source.length - 1).line - 1
                    for (let line = counter.linePos(start).line - 1; line <= end; line++) protectedLines.add(line)
                }
            } else if (token.type === 'comment') {
                const group = groups.get(token.source)
                if (!group) throw new Error('Unexpected comment in generated YAML: ' + token.source)
                if (seen.has(group)) throw new Error('YAML conversion duplicated a source comment')
                seen.add(group)
                const {line, col} = counter.linePos(token.offset)
                const prefix = lines[line - 1].slice(0, col - 1).trimEnd()
                if (group.blank && prefix) throw new Error('Blank-line marker unexpectedly follows YAML data')
                comments.set(line - 1, {prefix, group})
                if (!group.blank) shifts.set(group.scope, Math.max(shifts.get(group.scope) || 0, (prefix ? prefix.length + 1 : 0) - group.column))
            }
        }
        if (seen.size !== groups.size) throw new Error('YAML conversion lost a source comment or blank line')
        if (scalar !== scalars.length) throw new Error('YAML scalar token count differs from its source tree')
        const result = []
        for (let index = 0; index < lines.length; index++) {
            const item = comments.get(index)
            if (item?.group.blank) result.push('')
            else if (item) {
                const {prefix, group} = item
                const column = group.column + shifts.get(group.scope)
                for (const [part, comment] of group.text.split(/\r\n?|\n|\u0085|\u2028|\u2029/).entries()) {
                    const before = part === 0 ? prefix : ''
                    result.push(before + ' '.repeat(column - before.length) + '# ' + printableComment(comment))
                }
            } else if (lines[index].trim() || protectedLines.has(index)) result.push(lines[index])
        }
        return result.join('\n') + '\n'
    }

    /**
     * Pure function. Converts DTAB to YAML while retaining comments, blank runs, and annotation columns.
     * Data semantics take priority: deltas coalesce, fan-out expands, and inline paths may need new lines.
     * Comments are kept once with their surviving owner, including notes on later delta writes.
     * Tabs use logical UTF-16 columns, not font-specific glyph widths. YAML quoting can shift a table's notes.
     *
     * @param {string} text - Original DTAB, including its comments and spacing.
     * @param {object} [options]
     * @param {number} [options.tabSize=4] - Source tab stops and YAML indentation, from 1 through 9.
     * @returns {string} YAML matching core.parse(text) after integer leaves are converted back to strings.
     * @example toYAML('count 12\nflag false') // 'count: 12\nflag: "false"\n'
     * @example toYAML(',') // '- {}\n'
     */
    function toYAML(text, {tabSize = DEFAULT_TAB_SIZE} = {}) {
        if (!Number.isInteger(tabSize) || tabSize < 1 || tabSize > MAX_YAML_INDENT) throw new RangeError('tabSize must be an integer from 1 through ' + MAX_YAML_INDENT)
        const {value, entries} = core.parseWithSource(text)
        const doc = new YAML.Document(value, {compat: 'yaml-1.1', aliasDuplicateObjects: false})
        const records = new Map(), nodes = new Map(), counter = new YAML.LineCounter()
        let offset = 0
        for (const line of text.split('\n')) { counter.addNewLine(offset); offset += line.length + 1 }
        for (const entry of entries) if (entry.type === 'entry') for (const path of entry.paths) {
            const id = JSON.stringify(path)
            if (!records.has(id)) records.set(id, {first: entry, order: records.size})
            records.get(id).last = entry
        }
        indexNodes(doc.contents, [], records, nodes)
        const groups = attachLayout(doc, entries, nodes, text, tabSize)
        compactRows(doc.contents, [], nodes, counter)
        const scalars = []
        YAML.visit(doc, {Scalar: (_, node) => { scalars.push(node.value) }})
        const output = alignLayout(doc.toString({indent: tabSize, lineWidth: 0, blockQuote: 'literal'}), groups, scalars)
        const recovered = JSON.stringify(YAML.parse(output), (_, item) => typeof item === 'number' ? String(item) : item)
        if (recovered !== JSON.stringify(value)) throw new Error('YAML conversion changed DTAB data')
        return output
    }

    const tools = {toYAML}
    if (typeof module !== 'undefined' && module.exports) module.exports = tools
    else globalThis.dtabTools = tools
})()
