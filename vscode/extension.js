// dtab extension entry point. One job: indentation inside $ blocks. Code indents with spaces while tabs
// are dtab structure (and the parser strips a tab of block indentation), so inside a block Tab inserts
// spaces, and indent/outdent (Cmd+] Cmd+[ Shift+Tab, selections too) shift by spaces. Elsewhere all of
// them work with tabs, like a plain dtab file wants.
'use strict'
const vscode = require('vscode')

const BLOCK_INDENT = '    '   // one level of code indentation inside a $ block

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

/**
 * Pure function. One line shifted by one indentation level, by spaces inside a block and by a tab
 * outside it. Blank lines are left alone; outdenting removes what is there, up to one level.
 *
 * @param {string} line
 * @param {boolean} inBlock - whether the line is inside a $ block
 * @param {number} direction - +1 to indent, -1 to outdent
 * @returns {string}
 * @example shiftLine('\tdef f():', true, 1)     // '\t    def f():'
 * @example shiftLine('\t    return', true, -1)  // '\treturn'
 * @example shiftLine('\t  x', true, -1)         // '\tx'
 * @example shiftLine('a\tb 1', false, 1)        // '\ta\tb 1'
 * @example shiftLine('\ta', false, -1)          // 'a'
 * @example shiftLine('', true, 1)               // ''
 */
function shiftLine(line, inBlock, direction) {
    if (!line.trim()) return line
    if (!inBlock) return direction > 0 ? '\t' + line : line.replace(/^\t/, '')
    const tabs = indentOf(line)
    const rest = line.slice(tabs)
    if (direction > 0) return line.slice(0, tabs) + BLOCK_INDENT + rest
    return line.slice(0, tabs) + rest.replace(new RegExp('^ {1,' + BLOCK_INDENT.length + '}'), '')
}

/**
 * Command. Shifts every line the selection touches. A selection entirely inside a $ block is code and
 * shifts by spaces; one touching structure (a $ line, or any line outside a block) shifts by tabs, so a
 * block moves with its $ line.
 */
async function shiftSelection(direction) {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const lines = editor.document.getText().split('\n')
    const first = editor.selection.start.line, last = editor.selection.end.line
    let code = true
    for (let n = first; n <= last; n++) if (lines[n].trim() && !insideBlock(lines, n)) code = false
    await editor.edit(edit => {
        for (let n = first; n <= last; n++) {
            const shifted = shiftLine(lines[n], code, direction)
            if (shifted !== lines[n]) edit.replace(editor.document.lineAt(n).range, shifted)
        }
    })
}

/** Command. Tab: a selection indents its lines; a caret inside a block, past the line's tabs, gets spaces; else a tab. */
async function tab() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    if (!editor.selection.isEmpty) return shiftSelection(1)
    const position = editor.selection.active
    const lines = editor.document.getText().split('\n')
    if (insideBlock(lines, position.line) && position.character >= indentOf(lines[position.line]))
        return editor.edit(edit => edit.insert(position, BLOCK_INDENT))
    return vscode.commands.executeCommand('tab')
}

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('dtab.tab', tab),
        vscode.commands.registerCommand('dtab.indent', () => shiftSelection(1)),
        vscode.commands.registerCommand('dtab.outdent', () => shiftSelection(-1)),
    )
}

module.exports = {activate, insideBlock, shiftLine}
