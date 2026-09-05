#!/usr/bin/env node
/**
 * dtab (Delta Tab): config files made of tab-separated paths. One line is one path into a tree,
 * and later lines are deltas on top of earlier ones.
 *
 *     objects	l1,l2 light                ->  {"objects": {"l1": "light", "l2": "light"}}
 *     deltas	l1	position	x 1	y .5     ->  {"deltas": {"l1": {"position": {"x": "1", "y": ".5"}}}}
 *     	z -2                              ->  continues the path of the line above
 *     	 this entry starts with a space, so it is a comment
 *     $query sql                            ->  {"query": "SELECT *\nFROM users"}: a multiline value, tagged sql for editors
 *     	SELECT *
 *     	FROM users
 *
 * Rules:
 *   - Tabs indent, and separate the steps of a path (several in a row count as one, for alignment).
 *     An entry without a space is a key to step into.
 *   - An entry with a space is `key value`, split at the first space. It sets the key and stays put.
 *   - An indented line continues the path of the line above it.
 *   - Writing a key again replaces it; writing into an object merges. Last line wins.
 *   - `a,b` writes the same value under a and under b.
 *   - An entry starting with a space is a comment. A trailing tab is an empty key that swallows the lines under it.
 *   - `$key` is a multiline leaf: its value is the entries after it on its line plus every line indented
 *     under it, one line each, with their common indentation removed. A word after the key on the `$` line
 *     (`$query sql`) is a language tag for editors and is not part of the value.
 *   - Keys are identifiers (Python's str.isidentifier rule), so trees are EasyDict-friendly. Every value is a string.
 *
 * Single pass, one stack, O(total characters). Same algorithm and API as dtab.py.
 * Works as a browser <script> (defines window.dtab) and in node (module.exports, and `dtab FILE` on the command line).
 */
'use strict'

const KEY_SEPARATOR = ','  // a,b writes the same value under each key
const BLOCK_PREFIX = '$'   // $key: a leaf whose value is the lines under it ($ as in string)
const KEY_RULE = 'keys must be identifiers (letters, digits, underscores, not starting with a digit)'
const TAB_RUN = /\t+/  // Several tabs in a row are one separator, so columns can be aligned
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u  // the same Unicode classes Python's str.isidentifier uses

/**
 * Pure function. Parses dtab text into nested plain objects of strings. Throws, with the line number,
 * on a key that breaks KEY_RULE.
 *
 * @param {string} text - dtab source. Whitespace-only lines are ignored.
 * @returns {object}
 *
 * @example parse('objects\tl1,l2 light\ndeltas\tl1\tposition\tx 1\ty .5\n\tz -2')
 *   // {objects: {l1: 'light', l2: 'light'}, deltas: {l1: {position: {x: '1', y: '.5', z: '-2'}}}}
 * @example parse('a\tb 1\n\t comment\na\tb 2')   // {a: {b: '2'}}
 * @example parse('$query sql\n\tSELECT *\n\n\t\tFROM users\n\nnext 1')   // {query: 'SELECT *\n\n\tFROM users', next: '1'}
 * @example parse('$cmd\tpip install rp\tpython train.py')                  // {cmd: 'pip install rp\npython train.py'}
 * @example parse('a\tb 1\nc.d\te 2')              // throws: dtab line 2: invalid key "c.d": keys must be identifiers ...
 */
function parse(text) {
    const root = {}
    const stack = [[-1, [root]]]  // [indent, nodes that deeper lines nest into]
    let block = null  // while inside a $ block: {indent of the $ line, nodes, names, first lines, raw deeper lines}
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]
        const indent = line.length - line.replace(/^\t+/, '').length
        if (block) {
            if (!line.trim() || indent > block.indent) {
                block.deep.push(line)
                continue
            }
            finishBlock(block)
            block = null
        }
        if (!line.trim()) continue
        while (stack[stack.length - 1][0] >= indent) stack.pop()
        let nodes = stack[stack.length - 1][1]
        const entries = line.slice(indent).split(TAB_RUN)
        for (let position = 0; position < entries.length; position++) {
            const entry = entries[position]
            const spaceAt = entry.indexOf(' ')
            const key = spaceAt === -1 ? entry : entry.slice(0, spaceAt)
            if (!key) {
                if (spaceAt === -1) nodes = [{}]  // Empty key (trailing tab): everything under it is discarded
                continue
            }
            if (key.startsWith(BLOCK_PREFIX)) {
                const names = keyNames(key.slice(BLOCK_PREFIX.length), index + 1, true)
                block = {indent, nodes, names, head: entries.slice(position + 1), deep: []}  // rest of the $ line, then deeper lines (raw)
                break
            }
            const names = keyNames(key, index + 1, true)
            if (spaceAt !== -1) {
                const value = entry.slice(spaceAt + 1)
                for (const node of nodes) for (const name of names) node[name] = value
            } else {
                nodes = nodes.flatMap(node => names.map(name => child(node, name)))
            }
        }
        stack.push([indent, nodes])
    }
    if (block) finishBlock(block)
    return root
}

/**
 * Command (mutates the block's nodes). Joins a $ block into its value: the first lines from the $ line
 * itself, then the deeper lines with their common indentation removed (so relative indentation inside
 * code survives), trailing blank lines dropped. Written under every name the $ key stands for.
 *
 * @example const nodes = [{}]; finishBlock({nodes, names: ['q'], head: [], deep: ['\t\tSELECT *', '', '\t\t\tFROM t', '', '']}); nodes
 *   // [{q: 'SELECT *\n\n\tFROM t'}]
 * @example const nodes = [{}]; finishBlock({nodes, names: ['c'], head: ['pip install rp'], deep: ['\techo done']}); nodes
 *   // [{c: 'pip install rp\necho done'}]
 */
function finishBlock(block) {
    const deep = block.deep
    while (deep.length && !deep[deep.length - 1].trim()) deep.pop()
    const indents = deep.filter(line => line.trim()).map(line => line.length - line.replace(/^\t+/, '').length)
    const common = indents.length ? Math.min(...indents) : 0
    const lines = block.head.concat(deep.map(line => line.trim() ? line.slice(common) : ''))
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    const value = lines.join('\n')
    for (const node of block.nodes) for (const name of block.names) node[name] = value
}

/**
 * Pure function. Writes nested plain objects as dtab, one key per line, tab-indented. Leaves are
 * written with String(); a leaf containing a newline or a tab is written as a $ block. Throws on a key
 * that breaks KEY_RULE. parse(stringify(tree)) deep-equals tree when every leaf is a string without
 * trailing newlines.
 *
 * @param {object} tree - Nested plain objects
 * @returns {string}
 *
 * @example stringify({objects: {l1: 'light'}, deltas: {l1: {x: 1, name: 'a b'}}})
 *   // 'objects\n\tl1 light\ndeltas\n\tl1\n\t\tx 1\n\t\tname a b'
 * @example stringify({query: 'SELECT *\nFROM t'})   // '$query\n\tSELECT *\n\tFROM t'
 */
function stringify(tree) {
    const lines = []
    stringifyInto(tree, 0, lines)
    return lines.join('\n')
}

/**
 * Pure function (throws). The identifiers a key stands for: `a,b` is two while parsing, and a
 * stringify key must be a single bare identifier.
 *
 * @param {string} key
 * @param {number|null} lineNumber - For the error message; null outside parsing
 * @param {boolean} allowCommas - Whether `a,b` is a list of keys
 * @returns {string[]}
 *
 * @example keyNames('l1,l2', 1, true)           // ['l1', 'l2']
 * @example keyNames('table_bottom', null, false) // ['table_bottom']
 * @example keyNames('a,b', null, false)          // throws: dtab: invalid key "a,b": keys must be identifiers ...
 */
function keyNames(key, lineNumber, allowCommas) {
    const names = allowCommas ? key.split(KEY_SEPARATOR) : [key]
    for (const name of names) {
        if (!IDENTIFIER.test(name)) {
            const where = lineNumber ? ' line ' + lineNumber : ''
            throw new Error('dtab' + where + ': invalid key ' + JSON.stringify(key) + ': ' + KEY_RULE)
        }
    }
    return names
}

/**
 * Command (may mutate node). node[name] as an object to step into, replacing a string value if there is one.
 *
 * @example const n = {a: 'leaf'}; child(n, 'a').x = '1'; child(n, 'b'); n   // {a: {x: '1'}, b: {}}
 */
function child(node, name) {
    let value = node[name]
    if (!isPlainObject(value)) value = node[name] = {}
    return value
}

/**
 * Pure function. Whether a value is a plain object (a dtab node rather than a leaf).
 *
 * @example isPlainObject({a: 1}) // true
 * @example isPlainObject([1])    // false
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

/** Command (appends to lines). One dtab line per key of node, indented by depth tabs. */
function stringifyInto(node, depth, lines) {
    for (const [rawKey, rawValue] of Object.entries(node)) {
        const [key] = keyNames(rawKey, null, false)
        const indent = '\t'.repeat(depth)
        if (isPlainObject(rawValue)) {
            lines.push(indent + key)
            stringifyInto(rawValue, depth + 1, lines)
        } else {
            const value = String(rawValue)
            if (value.includes('\n') || value.includes('\t')) {  // a $ block holds any text; a one-line value cannot hold a tab
                lines.push(indent + BLOCK_PREFIX + key)
                for (const part of value.split('\n')) lines.push(indent + '\t' + part)
            } else {
                lines.push(indent + key + ' ' + value)
            }
        }
    }
}

const dtab = {parse, stringify, KEY_SEPARATOR, BLOCK_PREFIX, KEY_RULE}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = dtab
    if (require.main === module) {
        // Command line: dtab FILE  ->  the tree as JSON on stdout
        const fs = require('fs')
        process.stdout.write(JSON.stringify(parse(fs.readFileSync(process.argv[2], 'utf8')), null, 4) + '\n')
    }
} else {
    window.dtab = dtab
}
