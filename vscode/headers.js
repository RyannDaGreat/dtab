// The header lines of multiline strings, found by looking ahead, which a TextMate grammar cannot do. Shared by
// the VS Code extension (semantic tokens, the Tab key) and ../monaco.mjs, so no editor needs a copy.
'use strict'

/** Pure function. Number of leading tabs of a line. @example indentOf('\t\tx') // 2 */
const indentOf = line => line.length - line.replace(/^\t+/, '').length

// A key list within a line: runs of non-blanks, where a run ending in a comma goes on past spaces, then tabs
const KEYS = '[^\\t ]+(?:(?<=,) *\\t*[^\\t ]+)*'
// A header line: tabs, earlier entries, final leaf keys (group 1, with indices), tag, comments, trailing tabs
const HEADER_LINE = new RegExp('^\\t*(?:(?: [^\\t]*|' + KEYS + '(?<!,)(?: [^\\t]*)?)\\t+)*(' + KEYS + ')(?<!,) [^\\t]*(?:\\t+ [^\\t]*)*\\t*$', 'd')

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
 * Pure function. The header lines of a document's multiline strings: the lines shaped like a header
 * whose next non-blank line is deeper, each with the columns of its key and of its tag.
 *
 * @param {string[]} lines - the document's lines
 * @returns {{line: number, key: [number, number], tag: [number, number]}[]} - 0-based line, [start, end) columns
 * @example headers(['query sql\t note', '\tSELECT 1', 'dialect sql', 'after 1'])   // [{line: 0, key: [0, 5], tag: [6, 9]}]
 */
function headers(lines) {
    const found = []
    for (let n = 0; n < lines.length; n++) {
        if (!isHeaderLine(lines[n])) continue
        let next = n + 1
        while (next < lines.length && !lines[next].trim()) next++
        if (next === lines.length || indentOf(lines[next]) <= indentOf(lines[n])) continue
        const [start, key] = HEADER_LINE.exec(lines[n]).indices[1]
        found.push({line: n, key: [start, key], tag: [key + 1, key + 1 + lines[n].slice(key + 1).search(/\t|$/)]})
    }
    return found
}

module.exports = {indentOf, isHeaderLine, headers}
