#!/usr/bin/env node
/**
 * dtab (Delta Tab): config files made of tab-separated paths. One line is one path into a tree,
 * and later lines are deltas on top of earlier ones.
 *
 *     objects	l1,l2 light                ->  {"objects": {"l1": "light", "l2": "light"}}
 *     deltas	l1	position               ->  {"deltas": {"l1": {"position": {}}}}
 *     	x 1	y .5	z -2                 ->  continues inside position
 *     	 this entry starts with a space, so it is a comment
 *     query sql                             ->  {"query": "SELECT *\nFROM users"}: a multiline string, tagged sql for editors
 *     	SELECT *
 *     	FROM users
 *
 * Rules:
 *   - Tabs indent, and separate the steps of a path (several in a row count as one, for alignment).
 *     An entry without a space is a key to step into.
 *   - An entry with a space is `key value`, split at the first space. It sets the key and stays put.
 *   - Deeper lines belong to the last non-comment entry: children for a container, text for a leaf.
 *   - Writing a string key again replaces its value; writing into a container merges. Changing its type is an error.
 *   - A lone comma key appends a fresh entry. Nonempty containers of only comma entries become lists, in order;
 *     named and comma keys cannot mix. Empty containers stay dictionaries; there is no distinct empty list.
 *   - `a,b` writes the same value under a and under b. After the comma, spaces, then tabs or line breaks, are
 *     skipped, so `a, b` and `a,` at the end of a line with `b` on the next are the same. What follows the comma
 *     must be a key: a comment there (a space after a tab or a line break), or nothing, is an error. A lone comma is not a continuation.
 *   - An entry starting with a space is a comment. Trailing tabs outside string bodies are ignored.
 *   - When the last non-comment entry is a leaf, deeper lines replace its value with a multiline string.
 *     The body starts one tab past the header line's leading tabs and is verbatim from there, tabs included
 *     (the only way to put a tab in a value). Earlier entries keep their values. The leaf's own text is a
 *     tag for editors, `sql` or `python` or `txt` or nothing, not part of the value.
 *   - Named keys are one or more letters, digits, or KEY_PUNCTUATION (`_.-/`), so `file.json`, `a/b` and `123aa` are keys. Keys that
 *     are also identifiers work as attributes (config.deltas.l1). Every leaf is a string.
 *
 * One parsing pass, one stack, then linear list conversion. O(total characters). Same algorithm and API as dtab.py.
 * Works as a browser <script> (defines window.dtab) and in node (module.exports, and `dtab FILE` on the command line).
 */
'use strict'

const KEY_SEPARATOR = ','  // a,b writes the same value under each key
const TEXT_TAG = 'txt'     // the tag stringify gives a multiline string; any single word is a tag, editors color the ones they know
const KEY_PUNCTUATION = '_.-/'   // Allowed in keys besides letters and digits. SEMANTIC BINDING: dtab-key-punctuation
const KEY_RULE = 'keys may contain only letters, digits and ' + [...KEY_PUNCTUATION].join(' ')
const COMMA_RULE = 'a comma needs a key on both sides; a comment does not count'
const TAB_RUN = /\t+/  // Several tabs in a row are one separator, so columns can be aligned
const KEY = new RegExp('^[\\p{L}\\p{N}' + KEY_PUNCTUATION.replace(/[\]\\^-]/g, '\\$&') + ']+$', 'u')  // letters, digits (as Python's \w) and the punctuation; the rest is reserved for syntax
const SPACED_KEYS = /(^|\t)((?:[^\t\n ,]+, *[\t\n]*)+)/g  // keys at an entry's start whose commas are followed by whitespace
const DANGLING = /(?:^|\t)[^\t\n ]+,$/  // a key list ending in a comma: it goes on on the next line

/**
 * Pure function. Parses dtab into objects, arrays and string leaves. Rejects invalid keys, type changes
 * and mixed named/anonymous keys; key and string/container errors include the line number.
 *
 * @param {string} text - dtab source. Whitespace-only lines are ignored outside multiline strings.
 * @returns {object|Array}
 *
 * @example parse('objects\tl1,l2 light\ndeltas\tl1\tposition\n\tx 1\ty .5\tz -2')
 *   // {objects: {l1: 'light', l2: 'light'}, deltas: {l1: {position: {x: '1', y: '.5', z: '-2'}}}}
 * @example parse('a\tb 1\n\t comment\na\tb 2')   // {a: {b: '2'}}
 * @example parse('query sql\n\tSELECT *\n\n\t\tFROM users\n\nnext 1')   // {query: 'SELECT *\n\n\tFROM users', next: '1'}
 * @example parse('table txt\n\tname\tage\n\tryan\t30\nprompt \n\tLook here.')   // {table: 'name\tage\nryan\t30', prompt: 'Look here.'}
 * @example parse('dialect sql')                        // {dialect: 'sql'}
 * @example parse('A\tB\tcode py\n\tSome Code Here')       // {A: {B: {code: 'Some Code Here'}}}
 * @example parse('A\tB\t\n\tcode py\n\t\tSome Code Here') // {A: {B: {code: 'Some Code Here'}}}
 * @example parse('a\tb 1\nfile.json\tsize 2\n123aa 3')   // {a: {b: '1'}, 'file.json': {size: '2'}, '123aa': '3'}
 * @example parse('a\tb 1\nc|d\te 2')              // throws: dtab line 2: invalid key "c|d": keys may contain only letters, digits and _ . - /
 * @example parse('hello big world\n\tkey value')   // {hello: 'key value'}
 * @example parse('hello world\tmoose meat\n\tworld happy')   // {hello: 'world', moose: 'world happy'}
 * @example parse('x, y 1\nservers\talpha,\n\tbeta,\tgamma\tport 80')
 *   // {x: '1', y: '1', servers: {alpha: {port: '80'}, beta: {port: '80'}, gamma: {port: '80'}}}
 * @example parse(',\t, 1\t, 2\n,\t, 3\t, 4') // [['1', '2'], ['3', '4']]
 * @example parse(',') // [{}]
 * @example parse('a,\n comment\nb 1')   // throws: dtab line 1: invalid key "a,": a comma needs a key on both sides; a comment does not count
 */
function parse(text) {
    const root = Object.create(null)  // internal dictionary: even __proto__ is an ordinary key
    const stack = [[-1, [root]]]  // [indent, nodes that deeper lines nest into]
    let block = null  // last entry is a leaf: {indent, nodes, names, deep: raw lines under it}
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index++) {
        let line = lines[index]
        const lineNumber = index + 1
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
        line = closeUp(line)
        while (DANGLING.test(line) && index + 1 < lines.length) line = closeUp(line + '\n' + lines[++index])  // the key list goes on on the next line
        while (stack[stack.length - 1][0] >= indent) stack.pop()
        let nodes = stack[stack.length - 1][1]
        for (const entry of line.slice(indent).split(TAB_RUN)) {
            const spaceAt = entry.indexOf(' ')
            const key = spaceAt === -1 ? entry : entry.slice(0, spaceAt)
            if (!key) continue  // Comment or trailing tabs; neither changes the path
            const names = key === KEY_SEPARATOR ? [Symbol()] : keyNames(key, lineNumber, true)
            if (spaceAt !== -1) {
                const value = entry.slice(spaceAt + 1)
                for (const node of nodes) for (const name of names) {
                    if (isPlainObject(node[name])) throw new Error('dtab line ' + lineNumber + ': cannot replace a container with a string')
                    node[name] = value
                }
                block = {indent, nodes, names, deep: []}
            } else {
                nodes = nodes.flatMap(node => names.map(name => child(node, name, lineNumber)))
                block = null
            }
        }
        stack.push([indent, nodes])
    }
    if (block) finishBlock(block)
    return resolveLists(root)
}

/**
 * Pure function. Converts anonymous-only dictionaries to arrays; mixed keys are an error.
 *
 * @param {object|string} node - Parsed subtree; anonymous keys are Symbols, named keys are strings.
 * @returns {object|Array|string} Empty dictionaries remain dictionaries.
 *
 * @example resolveLists({items: {[Symbol()]: 'red', [Symbol()]: {}}}) // {items: ['red', {}]}
 * @example resolveLists({empty: {}}) // {empty: {}}
 * @example resolveLists({name: 'red', [Symbol()]: 'blue'}) // throws: dtab: cannot mix list entries and named keys
 */
function resolveLists(node) {
    if (!isPlainObject(node)) return node
    const keys = Reflect.ownKeys(node)
    const anonymous = keys.filter(key => typeof key === 'symbol').length
    if (anonymous && anonymous !== keys.length) throw new Error('dtab: cannot mix list entries and named keys')
    const values = keys.map(key => resolveLists(node[key]))
    return anonymous ? values : Object.fromEntries(keys.map((key, index) => [key, values[index]]))
}

/**
 * Command (mutates the block's nodes). The lines under a leaf, trailing blank lines dropped, become the
 * key's value: each loses the one tab that puts it under the key's line and is verbatim from there, so
 * tabs and deeper indentation inside code survive. With no lines, the key keeps the leaf's own text.
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
 * Pure function. Writes objects and nonempty arrays as dtab, one entry per line, tab-indented.
 * Leaves use String(); newlines or tabs use multiline strings tagged TEXT_TAG. Throws on invalid
 * keys or empty arrays (use {} instead). parse(stringify(tree)) deep-equals tree when leaves are
 * strings and multiline values end in a nonblank line.
 *
 * @param {object|Array} tree - Nested containers with scalar leaves.
 * @returns {string}
 *
 * @example stringify({objects: {l1: 'light'}, deltas: {l1: {x: 1, name: 'a b'}}})
 *   // 'objects\n\tl1 light\ndeltas\n\tl1\n\t\tx 1\n\t\tname a b'
 * @example stringify({query: 'SELECT *\nFROM t', table: 'a\tb'})   // 'query txt\n\tSELECT *\n\tFROM t\ntable txt\n\ta\tb'
 * @example stringify(['red', {}]) // ', red\n,'
 * @example stringify([]) // throws: dtab: empty lists have no representation; use {}
 */
function stringify(tree) {
    const lines = []
    stringifyInto(tree, 0, lines)
    return lines.join('\n')
}

/**
 * Pure function. What an editor's comment toggle does to its selections, the same in every dtab editor. The unit
 * is the entry: a run of non-tab characters with something other than spaces in it, which is a comment when
 * it starts with a space. A selection touches an entry when it covers some of its text after its leading
 * spaces; a caret touches every entry of its line. The touched entries all lose one space when they all start
 * with one; otherwise each gains one, so a comment already there becomes a double comment. Commenting then
 * toggling the same selections gives the text back, however the editor moves them over the new spaces. Tabs,
 * blank lines and runs of only spaces are never touched.
 *
 * @param {string[]} lines - the document's lines, without line breaks
 * @param {Array<number[]>} selections - [startLine, startColumn, endLine, endColumn] each: 0-based, UTF-16 code
 *   units, the end column excluded (Infinity for the line's end); start and end equal for a caret
 * @returns {{remove: boolean, at: Array<number[]>}} whether to remove a space or insert one, and where: the
 *   [line, column] of each touched entry's first character, in document order
 *
 * @example commentToggle(['a\tb 1', '\tc 2'], [[0, 0, 1, 4]])     // {remove: false, at: [[0, 0], [0, 2], [1, 1]]}
 * @example commentToggle([' a\t b 1', 'c 3'], [[0, 5, 0, 5]])    // {remove: true, at: [[0, 0], [0, 3]]} (a caret: its line)
 * @example commentToggle(['a\tb\tc 1'], [[0, 2, 0, 3]])           // {remove: false, at: [[0, 2]]} (only b)
 * @example commentToggle(['a\tb 1', 'c 2'], [[0, 0, 1, 0]])       // {remove: false, at: [[0, 0], [0, 2]]} (ends before line 1)
 * @example commentToggle(['a\t\t', ''], [[0, 1, 1, 0]])           // {remove: false, at: []} (nothing but tabs)
 */
function commentToggle(lines, selections) {
    const touched = new Map()   // 'line,column' -> [line, column, starts with a space]
    for (const [startLine, startColumn, endLine, endColumn] of selections) {
        const caret = startLine === endLine && startColumn === endColumn
        for (let line = startLine; line <= endLine; line++) {
            const from = caret || line > startLine ? 0 : startColumn
            const to = caret || line < endLine ? Infinity : endColumn
            for (const {0: entry, 1: spaces, index} of lines[line].matchAll(/( *)[^\t ][^\t]*/g))
                if (index + spaces.length < to && from < index + entry.length) touched.set(line + ',' + index, [line, index, spaces.length > 0])
        }
    }
    const entries = [...touched.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    return {remove: entries.length > 0 && entries.every(entry => entry[2]), at: entries.map(([line, column]) => [line, column])}
}

/**
 * Pure function. The lines after an editor's comment toggle (commentToggle) with the given selections.
 *
 * @param {string[]} lines
 * @param {Array<number[]>} selections - as for commentToggle
 * @returns {string[]}
 *
 * @example toggleComments(['a\tb 1', '\tc 2'], [[0, 0, 1, 4]])      // [' a\t b 1', '\t c 2']
 * @example toggleComments([' a\t b 1', '\t c 2'], [[0, 0, 1, 5]])   // ['a\tb 1', '\tc 2']
 * @example toggleComments(['x 1\t note'], [[0, 0, 0, 0]])           // [' x 1\t  note'] (the comment there becomes a double comment)
 * @example toggleComments(['a\tb\tc 1'], [[0, 2, 0, 3]])            // ['a\t b\tc 1']
 */
function toggleComments(lines, selections) {
    const {remove, at} = commentToggle(lines, selections)
    const result = lines.slice()
    for (const [line, column] of at.reverse())
        result[line] = result[line].slice(0, column) + (remove ? '' : ' ') + result[line].slice(remove ? column + 1 : column)
    return result
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
 * @example keyNames('a,,b', 3, true)             // throws: dtab line 3: invalid key "a,,b": a comma needs a key on both sides; a comment does not count
 */
function keyNames(key, lineNumber, allowCommas) {
    const names = allowCommas ? key.split(KEY_SEPARATOR) : [key]
    for (const name of names) {
        if (!KEY.test(name)) {
            const where = lineNumber ? ' line ' + lineNumber : ''
            throw new Error('dtab' + where + ': invalid key ' + JSON.stringify(key) + ': ' + (allowCommas && !name ? COMMA_RULE : KEY_RULE))
        }
    }
    return names
}

/**
 * Pure function. A line with the whitespace after its keys' commas removed: `a, b,` becomes `a,b,`.
 * Values keep theirs, since only an entry's start is a key.
 *
 * @example closeUp('x, y 1\tk a, b')   // 'x,y 1\tk a, b'
 * @example closeUp('a,\n\tb,\tc')      // 'a,b,c'
 */
function closeUp(line) {
    return line.replace(SPACED_KEYS, (match, before, keys) => before + keys.replace(/[ \t\n]/g, ''))
}

/**
 * Command. Creates a missing child dictionary; rejects replacing a string with a container.
 *
 * @param {object} node - Parent to mutate.
 * @param {string|symbol} name - Named or anonymous key.
 * @param {number} lineNumber - Source line for errors.
 * @returns {object} Child container.
 *
 * @example const n = {}; child(n, 'a', 1).x = '1'; JSON.stringify(n) // '{"a":{"x":"1"}}'
 * @example child({a: 'leaf'}, 'a', 2) // throws: dtab line 2: cannot replace a string with a container
 */
function child(node, name, lineNumber) {
    if (!Object.hasOwn(node, name)) node[name] = Object.create(null)
    else if (!isPlainObject(node[name])) throw new Error('dtab line ' + lineNumber + ': cannot replace a string with a container')
    return node[name]
}

/**
 * Pure function. Whether a value is a plain object (a dtab node rather than a leaf).
 *
 * @param {*} value - Value to inspect.
 * @returns {boolean}
 *
 * @example isPlainObject({a: 1}) // true
 * @example isPlainObject([1])    // false
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

/**
 * Command. Appends one dtab entry per child, indented by depth tabs.
 *
 * @param {object|Array} node - Container to serialize.
 * @param {number} depth - Indentation level.
 * @param {string[]} lines - Destination, modified in place.
 * @returns {void}
 *
 * @example const lines = []; stringifyInto(['red'], 0, lines); lines // [', red']
 */
function stringifyInto(node, depth, lines) {
    if (Array.isArray(node) && !node.length) throw new Error('dtab: empty lists have no representation; use {}')
    for (const [rawKey, rawValue] of Object.entries(node)) {
        const [key] = Array.isArray(node) ? [KEY_SEPARATOR] : keyNames(rawKey, null, false)
        const indent = '\t'.repeat(depth)
        if (isPlainObject(rawValue) || Array.isArray(rawValue)) {
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

const dtab = {parse, stringify, commentToggle, toggleComments, KEY_SEPARATOR, TEXT_TAG, KEY_PUNCTUATION, KEY, KEY_RULE}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = dtab
    if (module.id === '.') {   // `node dtab.js FILE`; not require.main, which a browser bundle rewrites but cannot run
        // Command line: dtab FILE  ->  the tree as JSON on stdout
        const fs = require('fs')
        process.stdout.write(JSON.stringify(parse(fs.readFileSync(process.argv[2], 'utf8')), null, 4) + '\n')
    }
} else {
    window.dtab = dtab
}
