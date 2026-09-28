// What a TextMate grammar cannot color, since it reads one line at a time: the key and tag of each multiline
// string's header, and the keys of a list that ends its line with a comma and turns out a leaf on a later line.
// Found by looking ahead. Shared by the VS Code extension (semantic tokens, the Tab key) and ../monaco.mjs, so
// no editor needs a copy.
'use strict'

/** Pure function. Number of leading tabs of a line. @example indentOf('\t\tx') // 2 */
const indentOf = line => line.length - line.replace(/^\t+/, '').length

// A key list within a line: runs of non-blanks, where a run ending in a comma goes on past spaces, then tabs
const KEYS = '[^\\t ]+(?:(?<=,) *\\t*[^\\t ]+)*'
// A header line: tabs, earlier entries, final leaf keys (group 1, with indices), tag, comments, trailing tabs
const HEADER_LINE = new RegExp('^\\t*(?:(?: [^\\t]*|' + KEYS + '(?<!,)(?: [^\\t]*)?)\\t+)*(' + KEYS + ')(?<!,) [^\\t]*(?:\\t+ [^\\t]*)*\\t*$', 'd')
// A line whose last entry is a key list ending in a comma (group 1), then spaces, then tabs: the list goes on
const DANGLING_LINE = new RegExp('(?:^|\\t)(' + KEYS + ')(?<=,) *\\t*$', 'd')
// The keys a line starts with (group 1), which go on with a list from an earlier line
const LEADING_KEYS = new RegExp('^\\t*(' + KEYS + ')', 'd')

// Semantic token types, in the order of both editors' legends
const TOKEN_TYPES = ['dtabBlockKey', 'dtabBlockTag', 'dtabLeafKey']

/**
 * Pure function. Whether a line has the shape that opens a multiline string once a deeper line follows:
 * the last non-comment entry is a leaf. Earlier entries and trailing tabs do not affect that.
 * @example isHeaderLine('query sql')            // true
 * @example isHeaderLine('\tprompt \t note')      // true (empty tag, a comment after it)
 * @example isHeaderLine('hello big world')      // true (the tag is "big world")
 * @example isHeaderLine('x, y sql')             // true (one leaf with two keys)
 * @example isHeaderLine('x, y')                 // false (two object keys, the space continues the list)
 * @example isHeaderLine('a\tb sql')             // true (the last entry is a leaf)
 * @example isHeaderLine('a\tb sql\t\t')         // true (trailing tabs are ignored)
 * @example isHeaderLine('b sql\ta')             // false (the path continues after the leaf)
 * @example isHeaderLine('x 1\ty 2')             // true (y owns deeper lines)
 */
const isHeaderLine = line => HEADER_LINE.test(line)

/**
 * Pure function. Whether the next non-blank line after line n is deeper than it.
 * @example deeperFollows(['query sql', '', '\tSELECT 1'], 0)   // true
 * @example deeperFollows(['query sql', 'after 1'], 0)         // false
 */
function deeperFollows(lines, n) {
    let next = n + 1
    while (next < lines.length && !lines[next].trim()) next++
    return next < lines.length && indentOf(lines[next]) > indentOf(lines[n])
}

/**
 * Pure function. The names of a key list with their columns, the list's text being `keys` at `offset` on
 * line `line`. A comma at the end (the list goes on) has no name after it; two commas in a row have an empty one.
 *
 * @example keyNames(4, 'a, b,', 3)                // [{line: 4, name: 'a', start: 3, end: 4}, {line: 4, name: 'b', start: 6, end: 7}]
 * @example keyNames(0, 'a,,b', 0).map(k => k.name) // ['a', '', 'b']
 */
function keyNames(line, keys, offset) {
    let start = offset
    return keys.replace(/,$/, '').split(/(,[ \t]*)/).flatMap((part, i) => {   // names at even indices, separators between
        const name = {line, name: part, start, end: start + part.length}
        start = name.end
        return i % 2 ? [] : [name]
    })
}

/**
 * Pure function. A key list that ends line n with a comma, followed through the lines it goes on to, as the
 * parser does: blank lines and lines of only tabs are passed over, and each line that is only keys ending in
 * a comma adds to the list. It ends on the first line whose keys end without one: as a leaf when a space
 * follows them, else as an object. It ends as null when no key follows a comma (a comment, or the end of the
 * text), which the parser rejects.
 *
 * @param {string[]} lines - the document's lines
 * @param {number} n - a line that ends with a key list and a comma
 * @returns {{dangling: object[], last: object[], line: number, as: string|null}} - the names (as keyNames gives
 *     them) on the lines that end in a comma, the names on the line where the list ends, that line, and how
 * @example keyList(['a,', '', '\tb,', '\tc 1'], 0)
 *   // {dangling: [{line: 0, name: 'a', start: 0, end: 1}, {line: 2, name: 'b', start: 1, end: 2}],
 *   //  last: [{line: 3, name: 'c', start: 1, end: 2}], line: 3, as: 'leaf'}
 * @example keyList(['list\talpha,', '\tbeta\tport 80'], 0).as   // 'object'
 * @example keyList(['a,', ' a comment'], 0).as                 // null
 */
function keyList(lines, n) {
    const first = DANGLING_LINE.exec(lines[n])
    const dangling = keyNames(n, first[1], first.indices[1][0])
    for (let m = n + 1; m < lines.length; m++) {
        if (/^\t*$/.test(lines[m])) continue
        const keys = LEADING_KEYS.exec(lines[m])
        if (!keys) return {dangling, last: [], line: m, as: null}
        const names = keyNames(m, keys[1], keys.indices[1][0])
        const rest = lines[m].slice(keys.indices[1][1])
        if (!keys[1].endsWith(',')) return {dangling, last: names, line: m, as: rest.startsWith(' ') ? 'leaf' : 'object'}
        if (!/^ *\t*$/.test(rest)) return {dangling, last: [], line: m, as: null}
        dangling.push(...names)
    }
    return {dangling, last: [], line: lines.length, as: null}
}

/**
 * Pure function. The spans a line-by-line grammar cannot color, in document order: the final keys and the
 * tag of each multiline string's header (a line shaped like one whose next non-blank line is deeper), as
 * 'dtabBlockKey' and 'dtabBlockTag', and each name of a key list that ends its line with a comma and ends
 * as a leaf on a later line, as 'dtabLeafKey' (the grammar can only color those as object keys). A string's
 * body is text, so nothing in it counts. Keys with a name the parser rejects are left to the grammar, which
 * colors them as errors.
 *
 * @param {string[]} lines - the document's lines
 * @param {RegExp} key - what one key name must match (the parser's KEY)
 * @returns {{line: number, start: number, end: number, type: string}[]} - 0-based line, [start, end) columns
 * @example lookaheadTokens(['query sql\t note', '\tSELECT 1', 'after 1'], dtab.KEY)
 *   // [{line: 0, start: 0, end: 5, type: 'dtabBlockKey'}, {line: 0, start: 6, end: 9, type: 'dtabBlockTag'}]
 * @example lookaheadTokens(['x,', 'y 1'], dtab.KEY)   // [{line: 0, start: 0, end: 1, type: 'dtabLeafKey'}]
 * @example lookaheadTokens(['job ', '\tcommand bash', '\t\tuv run x.py'], dtab.KEY).length   // 2 (command bash is text)
 */
function lookaheadTokens(lines, key) {
    const tokens = []
    const valid = names => names.every(({name}) => key.test(name))
    for (let n = 0; n < lines.length; n++) {
        const line = lines[n]
        if (isHeaderLine(line) && deeperFollows(lines, n)) {
            const [start, end] = HEADER_LINE.exec(line).indices[1]
            if (valid(keyNames(n, line.slice(start, end), start)))
                tokens.push({line: n, start, end, type: 'dtabBlockKey'}, {line: n, start: end + 1, end: end + 1 + line.slice(end + 1).search(/\t|$/), type: 'dtabBlockTag'})
            const indent = indentOf(line)
            while (n + 1 < lines.length && (!lines[n + 1].trim() || indentOf(lines[n + 1]) > indent)) n++   // the body is text, whatever it looks like
        } else if (DANGLING_LINE.test(line)) {
            const list = keyList(lines, n)
            if (list.as === 'leaf' && valid([...list.dangling, ...list.last]))
                tokens.push(...list.dangling.map(({line, start, end}) => ({line, start, end, type: 'dtabLeafKey'})))
            n = list.line - 1   // the list's last line may open a string or start another list
        }
    }
    return tokens
}

module.exports = {indentOf, isHeaderLine, lookaheadTokens, TOKEN_TYPES}
