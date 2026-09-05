// dtab extension entry point: STRUCTURAL whitespace rendering.
//
// VS Code's own renderWhitespace setting is per editor and dots every space, including the ones
// inside a value like `name Demo scene`. dtab has exactly two kinds of whitespace that carry meaning,
// tabs and the single space between a key and its value, so this draws markers on those and nothing
// else, using editor decorations. VS Code's own rendering is turned off for dtab files so the two
// never overlap, and a command toggles the markers (bound where the built-in toggle would be).
'use strict'
const vscode = require('vscode')

const LANGUAGE = 'dtab'
const TOGGLE_COMMAND = 'dtab.toggleRenderWhitespace'
const STATE_KEY = 'dtab.renderWhitespace'   // remembered across sessions; on by default
const TAB_GLYPH = '→'                  // →
const SPACE_GLYPH = '·'                // ·

const marker = glyph => vscode.window.createTextEditorDecorationType({
    before: {contentText: glyph, color: new vscode.ThemeColor('editorWhitespace.foreground'), width: '0', margin: '0'},
})
const tabMarker = marker(TAB_GLYPH)
const spaceMarker = marker(SPACE_GLYPH)

/**
 * Pure function. Character offsets of the structural whitespace in one dtab line: every tab, and the
 * first space of each entry that has one (the key/value separator). Spaces inside a value, and the
 * leading space of a comment, are not structural.
 *
 * @param {string} line
 * @returns {{tabs: number[], spaces: number[]}}
 * @example markers('a\tb 1 2\t c')   // {tabs: [1, 7], spaces: [3]}
 * @example markers('\t\tkey value')  // {tabs: [0, 1], spaces: [5]}
 */
function markers(line) {
    const tabs = [], spaces = []
    let entryStart = 0
    for (let i = 0; i <= line.length; i++) {
        if (i === line.length || line[i] === '\t') {
            const entry = line.slice(entryStart, i)
            const space = entry.indexOf(' ')
            if (space > 0) spaces.push(entryStart + space)   // > 0: a leading space is a comment, not a separator
            if (i < line.length) tabs.push(i)
            entryStart = i + 1
        }
    }
    return {tabs, spaces}
}

/** Command. Draws or clears the markers on one editor. */
function decorate(editor, on) {
    if (!editor || editor.document.languageId !== LANGUAGE) return
    const tabRanges = [], spaceRanges = []
    if (on) {
        for (let n = 0; n < editor.document.lineCount; n++) {
            const {tabs, spaces} = markers(editor.document.lineAt(n).text)
            for (const c of tabs) tabRanges.push(new vscode.Range(n, c, n, c + 1))
            for (const c of spaces) spaceRanges.push(new vscode.Range(n, c, n, c + 1))
        }
    }
    editor.setDecorations(tabMarker, tabRanges)
    editor.setDecorations(spaceMarker, spaceRanges)
}

function activate(context) {
    const isOn = () => context.globalState.get(STATE_KEY, true)
    const refreshAll = () => vscode.window.visibleTextEditors.forEach(e => decorate(e, isOn()))

    context.subscriptions.push(
        vscode.commands.registerCommand(TOGGLE_COMMAND, async () => { await context.globalState.update(STATE_KEY, !isOn()); refreshAll() }),
        vscode.window.onDidChangeVisibleTextEditors(refreshAll),
        vscode.workspace.onDidChangeTextDocument(event =>
            vscode.window.visibleTextEditors.filter(e => e.document === event.document).forEach(e => decorate(e, isOn()))),
    )
    refreshAll()
}

module.exports = {activate, markers}
