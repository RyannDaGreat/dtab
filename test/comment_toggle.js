// dtab.js's comment toggle on cases from a JSON file, for test/test_dtab.py to compare with dtab.py.
// Run:  node test/comment_toggle.js CASES.json   ->  JSON on stdout: per case {lines, parsed} (parsed: the tree
// of the toggled lines, or {error}). A case is {lines, selections}; columns are characters (code points), a
// null end column is the line's end.
'use strict'
const fs = require('fs')
const dtab = require('../dtab.js')

/** Pure function. A character column as UTF-16 code units, the unit of dtab.js and the editors. */
const utf16 = (line, column) => [...line].slice(0, column).join('').length

/** Pure function. The tree of some lines, or the parser's error. */
function parsed(lines) {
    try {
        return dtab.parse(lines.join('\n'))
    } catch (error) {
        return {error: error.message}
    }
}

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
process.stdout.write(JSON.stringify(cases.map(({lines, selections}) => {
    const result = dtab.toggleComments(lines, selections.map(([sl, sc, el, ec]) => [sl, utf16(lines[sl], sc), el, ec === null ? Infinity : utf16(lines[el], ec)]))
    return {lines: result, parsed: parsed(result)}
})))
