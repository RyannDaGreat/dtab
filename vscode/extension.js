// dtab extension entry point. One job: inside a $ block, past the line's own tabs, the Tab key inserts
// spaces, because code indents with spaces while tabs are dtab structure (and the parser strips a tab of
// block indentation). Everywhere else Tab does what it normally does.
'use strict'
const vscode = require('vscode')

const BLOCK_INDENT = '    '   // what Tab inserts inside a $ block

/** Pure function. Number of leading tabs of a line. @example indentOf('\t\tx') // 2 */
const indentOf = line => line.length - line.replace(/^\t+/, '').length

/** Pure function. Whether a line opens a $ block (a `$key` entry, possibly after other entries). @example isBlockLine('a\t$b sql') // true */
const isBlockLine = line => /^\t*(?:[^\t]*\t+)*\$[^\t ]/.test(line)

/**
 * Pure function. Whether line `n` of a dtab document is inside a $ block: walking up through its
 * ancestors (each the nearest shallower non-blank line), the first one that is a $ line puts it inside;
 * a blank line continues whatever is above it.
 *
 * @param {string[]} lines - the document's lines
 * @param {number} n - 0-based line number
 * @returns {boolean}
 * @example insideBlock(['$code python', '\tdef f():', '\t    return 1'], 2)   // true
 * @example insideBlock(['$code python', '\tdef f():', 'after 1'], 2)         // false
 * @example insideBlock(['a', '\t$code', '\t\tx', '\t\t\tdeeper'], 3)         // true (nearest $ ancestor)
 * @example insideBlock(['a', '\tb', '\t\tc 1'], 2)                          // false (no $ ancestor)
 * @example insideBlock(['$code', '\tx', ''], 2)                             // true (a blank line inside the block)
 */
function insideBlock(lines, n) {
    let i = n
    while (i > 0 && !lines[i].trim()) i--            // a blank line: judge by the nearest non-blank line above
    if (!lines[i].trim()) return false
    if (i !== n && isBlockLine(lines[i])) return true  // blank line right under a $ line
    let current = indentOf(lines[i])
    for (let j = i - 1; j >= 0 && current > 0; j--) {
        if (!lines[j].trim()) continue
        const indent = indentOf(lines[j])
        if (indent < current) {
            if (isBlockLine(lines[j])) return true
            current = indent
        }
    }
    return false
}

/** Command. Tab inside a block, past the line's tabs, inserts spaces; otherwise the editor's normal tab. */
async function tab() {
    const editor = vscode.window.activeTextEditor
    if (!editor || !editor.selection.isEmpty) return vscode.commands.executeCommand('tab')
    const position = editor.selection.active
    const lines = editor.document.getText().split('\n')
    if (insideBlock(lines, position.line) && position.character >= indentOf(lines[position.line]))
        return editor.edit(edit => edit.insert(position, BLOCK_INDENT))
    return vscode.commands.executeCommand('tab')
}

function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('dtab.tab', tab))
}

module.exports = {activate, insideBlock}
