#!/usr/bin/env node
/**
 * dtab (Delta Tab): config files made of tab-separated paths. One line is one path into a tree,
 * and later lines are deltas on top of earlier ones.
 *
 *     objects	l1,l2 light                ->  {"objects": {"l1": "light", "l2": "light"}}
 *     deltas	l1	position	x 1	y .5     ->  {"deltas": {"l1": {"position": {"x": "1", "y": ".5"}}}}
 *     	z -2                              ->  continues the path of the line above
 *     	 this entry starts with a space, so it is a comment
 *     query sql                             ->  {"query": "SELECT *\nFROM users"}: a multiline string, tagged sql for editors
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
 *   - A `key word` line with lines indented under it is a multiline string: the word is a language tag for
 *     editors (empty, or `txt`, for plain text) and the value is those lines, one tab deeper than the key's line
 *     and verbatim from there, tabs included. The only way to put a tab in a value.
 *   - A line indented under any other leaf line (a value with spaces, or several leaves) is an error.
 *   - Keys are one or more letters, digits, or KEY_PUNCTUATION (`_.-/`), so `file.json`, `a/b` and `123aa` are keys. Keys that
 *     are also identifiers work as attributes (config.deltas.l1). Every value is a string.
 *
 * Single pass, one stack, O(total characters). Same algorithm and API as dtab.py.
 * Works as a browser <script> (defines window.dtab) and in node (module.exports, and `dtab FILE` on the command line).
 */
'use strict'

const KEY_SEPARATOR = ','  // a,b writes the same value under each key
const TEXT_TAG = 'txt'     // the tag stringify gives a multiline string; any single word is a tag, editors color the ones they know
const KEY_PUNCTUATION = '_.-/'   // Allowed in keys besides letters and digits. SEMANTIC BINDING: dtab-key-punctuation
const KEY_RULE = 'keys may contain only letters, digits and ' + [...KEY_PUNCTUATION].join(' ')
const TAB_RUN = /\t+/  // Several tabs in a row are one separator, so columns can be aligned
const KEY = new RegExp('^[\\p{L}\\p{N}' + KEY_PUNCTUATION.replace(/[\]\\^-]/g, '\\$&') + ']+$', 'u')  // letters, digits (as Python's \w) and the punctuation; the rest is reserved for syntax

/**
 * Pure function. Parses dtab text into nested plain objects of strings. Throws, with the line number,
 * on a key that breaks KEY_RULE or on a line indented under a leaf that is not a multiline string's header.
 *
 * @param {string} text - dtab source. Whitespace-only lines are ignored outside multiline strings.
 * @returns {object}
 *
 * @example parse('objects\tl1,l2 light\ndeltas\tl1\tposition\tx 1\ty .5\n\tz -2')
 *   // {objects: {l1: 'light', l2: 'light'}, deltas: {l1: {position: {x: '1', y: '.5', z: '-2'}}}}
 * @example parse('a\tb 1\n\t comment\na\tb 2')   // {a: {b: '2'}}
 * @example parse('query sql\n\tSELECT *\n\n\t\tFROM users\n\nnext 1')   // {query: 'SELECT *\n\n\tFROM users', next: '1'}
 * @example parse('table txt\n\tname\tage\n\tryan\t30\nprompt \n\tLook here.')   // {table: 'name\tage\nryan\t30', prompt: 'Look here.'}
 * @example parse('dialect sql')                        // {dialect: 'sql'}
 * @example parse('a\tb 1\nfile.json\tsize 2\n123aa 3')   // {a: {b: '1'}, 'file.json': {size: '2'}, '123aa': '3'}
 * @example parse('a\tb 1\nc|d\te 2')              // throws: dtab line 2: invalid key "c|d": keys may contain only letters, digits and _ . - /
 * @example parse('hello big world\n\tkey value')   // throws: dtab line 2: indented under a value; a multiline string starts with `key word`
 */
function parse(text) {
    const root = {}
    const stack = [[-1, [root], false]]  // [indent, nodes that deeper lines nest into, whether the line is only leaves]
    let block = null  // after a `key word` line: {indent, nodes, names, deep: raw lines under it}
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
        if (stack[stack.length - 1][2]) throw new Error('dtab line ' + (index + 1) + ': indented under a value; a multiline string starts with `key word`')
        let nodes = stack[stack.length - 1][1]
        const leaves = []  // [names, value] of the line's leaves; a header is a line of exactly one, with a one-word value
        let stepsIn = false
        for (const entry of line.slice(indent).split(TAB_RUN)) {
            const spaceAt = entry.indexOf(' ')
            const key = spaceAt === -1 ? entry : entry.slice(0, spaceAt)
            if (!key) {
                if (spaceAt === -1) { nodes = [{}]; stepsIn = true }  // Empty key (trailing tab): everything under it is discarded
                continue
            }
            const names = keyNames(key, index + 1, true)
            if (spaceAt !== -1) {
                const value = entry.slice(spaceAt + 1)
                for (const node of nodes) for (const name of names) node[name] = value
                leaves.push([names, value])
            } else {
                nodes = nodes.flatMap(node => names.map(name => child(node, name)))
                stepsIn = true
            }
        }
        const onlyLeaves = leaves.length > 0 && !stepsIn
        stack.push([indent, nodes, onlyLeaves])
        if (onlyLeaves && leaves.length === 1 && !leaves[0][1].includes(' ')) block = {indent, nodes, names: leaves[0][0], deep: []}
    }
    if (block) finishBlock(block)
    return root
}

/**
 * Command (mutates the block's nodes). The lines under a `key word` line, trailing blank lines dropped,
 * become the key's value: each loses the one tab that puts it under the key's line and is verbatim from
 * there, so tabs and deeper indentation inside code survive. With no lines, the key keeps the word.
 *
 * @example const nodes = [{q: 'sql'}]; finishBlock({indent: 0, nodes, names: ['q'], deep: ['\tSELECT *', '', '\t\tFROM t', '', '']}); nodes
 *   // [{q: 'SELECT *\n\n\tFROM t'}]
 * @example const nodes = [{q: 'sql'}]; finishBlock({indent: 0, nodes, names: ['q'], deep: ['', '']}); nodes   // [{q: 'sql'}]
 */
function finishBlock(block) {
    const deep = block.deep
    while (deep.length && !deep[deep.length - 1].trim()) deep.pop()
    if (!deep.length) return
    const base = '\t'.repeat(block.indent + 1)
    const value = deep.map(line => line.startsWith(base) ? line.slice(base.length) : '').join('\n')
    for (const node of block.nodes) for (const name of block.names) node[name] = value
}

/**
 * Pure function. Writes nested plain objects as dtab, one key per line, tab-indented. Leaves are
 * written with String(); a leaf containing a newline or a tab is written as a multiline string tagged
 * TEXT_TAG. Throws on a key that breaks KEY_RULE. parse(stringify(tree)) deep-equals tree when every
 * leaf is a string without trailing newlines.
 *
 * @param {object} tree - Nested plain objects
 * @returns {string}
 *
 * @example stringify({objects: {l1: 'light'}, deltas: {l1: {x: 1, name: 'a b'}}})
 *   // 'objects\n\tl1 light\ndeltas\n\tl1\n\t\tx 1\n\t\tname a b'
 * @example stringify({query: 'SELECT *\nFROM t', table: 'a\tb'})   // 'query txt\n\tSELECT *\n\tFROM t\ntable txt\n\ta\tb'
 */
function stringify(tree) {
    const lines = []
    stringifyInto(tree, 0, lines)
    return lines.join('\n')
}

/**
 * Pure function (throws). The names a key stands for: `a,b` is two while parsing, and a stringify key
 * must be a single name.
 *
 * @param {string} key
 * @param {number|null} lineNumber - For the error message; null outside parsing
 * @param {boolean} allowCommas - Whether `a,b` is a list of keys
 * @returns {string[]}
 *
 * @example keyNames('l1,l2', 1, true)           // ['l1', 'l2']
 * @example keyNames('file-thing.json', null, false) // ['file-thing.json']
 * @example keyNames('a,b', null, false)          // throws: dtab: invalid key "a,b": keys may contain only letters, digits and _ . - /
 */
function keyNames(key, lineNumber, allowCommas) {
    const names = allowCommas ? key.split(KEY_SEPARATOR) : [key]
    for (const name of names) {
        if (!KEY.test(name)) {
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
            if (value.includes('\n') || value.includes('\t')) {  // a multiline string holds any text; a one-line value cannot hold a tab
                lines.push(indent + key + ' ' + TEXT_TAG)
                for (const part of value.split('\n')) lines.push(indent + '\t' + part)
            } else {
                lines.push(indent + key + ' ' + value)
            }
        }
    }
}

const dtab = {parse, stringify, KEY_SEPARATOR, TEXT_TAG, KEY_PUNCTUATION, KEY, KEY_RULE}

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
