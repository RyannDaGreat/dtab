// dtab extension entry point. Two jobs. Indentation inside $ blocks: code indents with spaces while tabs
// are dtab structure (and the parser strips a tab of block indentation), so inside a block Tab inserts
// spaces, and indent/outdent (Cmd+] Cmd+[ Shift+Tab, selections too) shift by spaces; elsewhere all of
// them work with tabs, like a plain dtab file wants. And a live JSON preview of the file beside it, like
// Markdown's, refreshed on every edit.
'use strict'
const vscode = require('vscode')
const dtab = require('./dtab.js')   // the repo's parser; vscode/dtab.js is a symlink to it

const BLOCK_INDENT = '    '   // one level of code indentation inside a $ block
const PREVIEW_SCHEME = 'dtab-preview'   // uri scheme of the read-only JSON documents the preview shows

/** Pure function. Number of leading tabs of a line. @example indentOf('\t\tx') // 2 */
const indentOf = line => line.length - line.replace(/^\t+/, '').length

/** Pure function. Whether a line opens a $ block (a `$key` entry, possibly after other entries). @example isBlockLine('a\t$b sql') // true */
const isBlockLine = line => /^\t*(?:[^\t]*\t+)*\$[^\t ]/.test(line)

/**
 * Pure function. Whether line `n` of a dtab document is inside a $ block: walking up through its
 * ancestors (each the nearest shallower non-blank line), the first one that is a $ line puts it inside.
 * The line's own tabs are its depth, so a line of only whitespace at the $ line's depth, or an empty
 * line, is structure: the Tab key there gives a tab, and only once the line is deeper does it give spaces.
 *
 * @param {string[]} lines - the document's lines
 * @param {number} n - 0-based line number
 * @returns {boolean}
 * @example insideBlock(['$code python', '\tdef f():', '\t    return 1'], 2)   // true
 * @example insideBlock(['$code python', '\tdef f():', 'after 1'], 2)         // false
 * @example insideBlock(['a', '\t$code', '\t\tx', '\t\t\tdeeper'], 3)         // true (nearest $ ancestor)
 * @example insideBlock(['a', '\tb', '\t\tc 1'], 2)                          // false (no $ ancestor)
 * @example insideBlock(['$code', '\tx', '\t'], 2)                           // true (whitespace, deeper than the $ line)
 * @example insideBlock(['a', '\t$code', '\t\tx', '\t'], 3)                  // false (whitespace at the $ line's depth)
 */
function insideBlock(lines, n) {
    let current = indentOf(lines[n])
    for (let j = n - 1; j >= 0 && current > 0; j--) {
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
 * Pure function. The lines a selection covers, as [first, last]. A selection that ends at column 0 of a
 * later line does not include that line (that is how Shift+Down selects whole lines), as in VS Code's own
 * indent command.
 *
 * @param {{start: {line: number, character: number}, end: {line: number, character: number}}} selection
 * @returns {number[]}
 * @example selectedLines({start: {line: 1, character: 0}, end: {line: 3, character: 0}})   // [1, 2]
 * @example selectedLines({start: {line: 1, character: 2}, end: {line: 1, character: 5}})   // [1, 1]
 * @example selectedLines({start: {line: 4, character: 0}, end: {line: 4, character: 0}})   // [4, 4]
 */
function selectedLines(selection) {
    const {start, end} = selection
    return [start.line, end.character === 0 && end.line > start.line ? end.line - 1 : end.line]
}

/**
 * Pure function. The one insertion or deletion that turns `line` into `shifted` (a shift only adds or
 * removes indentation), as {at, insert} or {from, to}, or null when they are equal. Applying that instead
 * of replacing the line lets the editor move carets and selections along with the text.
 *
 * @param {string} line
 * @param {string} shifted
 * @returns {{at: number, insert: string} | {from: number, to: number} | null}
 * @example lineEdit('\tdef f():', '\t    def f():')   // {at: 1, insert: '    '}
 * @example lineEdit('\t    return', '\treturn')       // {from: 1, to: 5}
 * @example lineEdit('a\tb 1', '\ta\tb 1')            // {at: 0, insert: '\t'}
 * @example lineEdit('a', 'a')                         // null
 */
function lineEdit(line, shifted) {
    if (line === shifted) return null
    let at = 0
    while (line[at] === shifted[at]) at++
    if (shifted.length > line.length) return {at, insert: shifted.slice(at, at + shifted.length - line.length)}
    return {from: at, to: at + line.length - shifted.length}
}

/**
 * Command. Shifts every line any selection touches. Lines all inside $ blocks (blank ones aside) are code
 * and shift by spaces; a set touching structure (a $ line, or any line outside a block) shifts by tabs, so
 * a block moves with its $ line.
 */
async function shiftSelection(direction) {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const lines = editor.document.getText().split('\n')
    const numbers = new Set()
    for (const selection of editor.selections) {
        const [first, last] = selectedLines(selection)
        for (let n = first; n <= last; n++) numbers.add(n)
    }
    const code = [...numbers].every(n => !lines[n].trim() || insideBlock(lines, n))
    await editor.edit(edit => {
        for (const n of numbers) {
            const change = lineEdit(lines[n], shiftLine(lines[n], code, direction))
            if (!change) continue
            if ('insert' in change) edit.insert(new vscode.Position(n, change.at), change.insert)
            else edit.delete(new vscode.Range(n, change.from, n, change.to))
        }
    })
}

/**
 * Command. Tab: a selection indents its lines; a caret inside a block, past the line's tabs, gets spaces;
 * any other caret gets a tab. Inserts the tab itself: VS Code's own tab command would re-indent a line of
 * only whitespace to the depth it expects, and dtab structure wants exactly one more tab.
 */
async function tab() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    if (editor.selections.some(selection => !selection.isEmpty)) return shiftSelection(1)
    const lines = editor.document.getText().split('\n')
    await editor.edit(edit => {
        for (const {active} of editor.selections)
            edit.insert(active, insideBlock(lines, active.line) && active.character >= indentOf(lines[active.line]) ? BLOCK_INDENT : '\t')
    })
}

/**
 * Pure function. What the preview shows for dtab text: the tree as JSON, or, while the text is mid-edit
 * and does not parse, the parser's message with its line number.
 *
 * @param {string} text - dtab source
 * @returns {string}
 * @example previewText('a\tb 1')   // '{\n    "a": {\n        "b": "1"\n    }\n}'
 * @example previewText('a|b 1')    // 'dtab line 1: invalid key "a|b": keys may contain only letters, digits and _ . - /'
 */
function previewText(text) {
    try {
        return JSON.stringify(dtab.parse(text), null, 4)
    } catch (error) {
        if (!error.message.startsWith('dtab')) throw error   // only the parser's own verdict belongs in the preview
        return error.message
    }
}

/** Pure function. The preview document's uri for a dtab document: its path plus .json, with the source uri in the query. */
const previewUri = document => vscode.Uri.from({scheme: PREVIEW_SCHEME, path: document.uri.path + '.json', query: document.uri.toString()})

/** Query (reads open documents). A preview document's text: its source document parsed, or '' once the source is closed. */
function previewContent(uri) {
    const source = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.query)
    return source ? previewText(source.getText()) : ''
}

/** Command. Opens the active dtab file's JSON preview beside it (or reveals it), keeping focus in the file. */
async function openPreview() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const document = await vscode.workspace.openTextDocument(previewUri(editor.document))
    await vscode.languages.setTextDocumentLanguage(document, 'json')
    await vscode.window.showTextDocument(document, {viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false})
}

function activate(context) {
    const previewChanged = new vscode.EventEmitter()   // fired with a preview uri: VS Code then asks previewContent again
    context.subscriptions.push(
        vscode.commands.registerCommand('dtab.tab', tab),
        vscode.commands.registerCommand('dtab.indent', () => shiftSelection(1)),
        vscode.commands.registerCommand('dtab.outdent', () => shiftSelection(-1)),
        vscode.commands.registerCommand('dtab.preview', openPreview),
        vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {onDidChange: previewChanged.event, provideTextDocumentContent: previewContent}),
        vscode.workspace.onDidChangeTextDocument(event => { if (event.document.languageId === 'dtab') previewChanged.fire(previewUri(event.document)) }),
    )
}

module.exports = {activate, insideBlock, shiftLine, selectedLines, lineEdit, previewText}
