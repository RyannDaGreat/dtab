// Runs the dtab extension inside the installed VS Code (an isolated profile under node_modules/.cache, no
// real settings or extensions touched) and checks the JSON preview: it opens beside the file as json,
// leaves focus in the file, follows an edit into the parser's message, and recovers. Then the Tab and
// indent commands: one tab on a whitespace-only line, a Shift+Down selection ending at column 0 leaves
// the next line alone, the caret rides along with indented text, and every cursor is served.
// Run:  node test/test_vscode_live.js   (needs `npm install --no-save @vscode/test-electron` and VS Code in /Applications)
// This one file is both the launcher (when run directly) and the suite VS Code loads (its `run` export).
'use strict'
const assert = require('assert')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const VSCODE = '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
const PROFILE = path.join(ROOT, 'node_modules', '.cache', 'dtab-live')   // short: VS Code makes a unix socket here
const SETTLE_MS = 1000   // VS Code refreshes a virtual document some time after its provider fires

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Command (drives the editor). The suite VS Code runs; rejects on the first failed check. */
async function run() {
    const vscode = require('vscode')
    const tree = JSON.stringify({a: {b: '1'}, q: 'SELECT 1'}, null, 4)
    const source = await vscode.workspace.openTextDocument({language: 'dtab', content: 'a\tb 1\n$q sql\n\tSELECT 1\n'})
    const editor = await vscode.window.showTextDocument(source)
    await vscode.commands.executeCommand('dtab.preview')
    await sleep(SETTLE_MS)
    const preview = vscode.workspace.textDocuments.find(document => document.uri.scheme === 'dtab-preview')
    assert.ok(preview, 'no preview document; open: ' + vscode.workspace.textDocuments.map(d => d.uri.toString()).join(', '))
    assert.strictEqual(preview.languageId, 'json')
    assert.strictEqual(preview.getText(), tree)
    assert.ok(vscode.window.visibleTextEditors.some(e => e.document === preview), 'preview not visible')
    assert.strictEqual(vscode.window.activeTextEditor.document, source, 'focus should stay in the dtab file')
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'c/d 2\n'))
    await sleep(SETTLE_MS)
    assert.ok(preview.getText().startsWith('dtab line 1: invalid key'), 'preview did not follow the edit: ' + JSON.stringify(preview.getText()))
    await editor.edit(edit => edit.delete(new vscode.Range(0, 0, 1, 0)))
    await sleep(SETTLE_MS)
    assert.strictEqual(preview.getText(), tree, 'preview did not recover')

    // The Tab and indent commands, each on a fresh document with the selections set first.
    const P = (line, ch) => new vscode.Position(line, ch)
    const S = (from, to) => new vscode.Selection(from, to || from)
    async function run(content, selections, command) {
        const document = await vscode.workspace.openTextDocument({language: 'dtab', content})
        const editor = await vscode.window.showTextDocument(document)
        editor.selections = selections
        await vscode.commands.executeCommand(command)
        return {text: document.getText(), selections: editor.selections}
    }
    let r = await run('x\n\t$code\n\t\tbody\n\t\n', [S(P(3, 1))], 'dtab.tab')
    assert.strictEqual(r.text, 'x\n\t$code\n\t\tbody\n\t\t\n', 'Tab on a whitespace line at the $ depth: exactly one tab, not a re-indent')
    r = await run('$code\n\tx\n\ty\nafter 1\n', [S(P(1, 0), P(3, 0))], 'dtab.indent')
    assert.strictEqual(r.text, '$code\n\t    x\n\t    y\nafter 1\n', 'a selection ending at column 0 must not touch that line')
    r = await run('$code\n\t    x\n\t    y\nafter 1\n', [S(P(1, 0), P(3, 0))], 'dtab.outdent')
    assert.strictEqual(r.text, '$code\n\tx\n\ty\nafter 1\n', 'outdent of a column-0-ended selection')
    r = await run('$code\n\tabcdef\n', [S(P(1, 3))], 'dtab.indent')
    assert.strictEqual(r.text, '$code\n\t    abcdef\n')
    assert.strictEqual(r.selections[0].active.character, 7, 'the caret should ride along with the indented text')
    r = await run('$code\n\t    abcdef\n', [S(P(1, 7))], 'dtab.outdent')
    assert.strictEqual(r.selections[0].active.character, 3, 'the caret should ride along with the outdented text')
    r = await run('$code\n\tx\n\ty\n', [S(P(1, 2)), S(P(2, 2))], 'dtab.tab')
    assert.strictEqual(r.text, '$code\n\tx    \n\ty    \n', 'every cursor gets its spaces')
    r = await run('a\nb 1\nc 2\n', [S(P(0, 0), P(0, 1)), S(P(2, 0), P(2, 1))], 'dtab.indent')
    assert.strictEqual(r.text, '\ta\nb 1\n\tc 2\n', 'every selection gets indented')
    console.log('test_vscode_live.js: all checks passed')
}

if (require.main === module) {
    require('@vscode/test-electron').runTests({
        vscodeExecutablePath: VSCODE,
        extensionDevelopmentPath: path.join(ROOT, 'vscode'),
        extensionTestsPath: __filename,
        launchArgs: ['--user-data-dir=' + path.join(PROFILE, 'user'), '--extensions-dir=' + path.join(PROFILE, 'extensions'), '--disable-extensions', '--disable-gpu'],
    }).catch(error => { console.error(error); process.exit(1) })
}

module.exports = {run}
