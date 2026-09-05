// dtab extension entry point. Two jobs, both about whitespace rendering:
//   1. On first use, seed the user's own setting for .dtab files: render tabs (and runs of spaces),
//      but not single spaces inside values. It is written to the user's settings, not pinned by the
//      extension, so it stays a default the user can change.
//   2. Provide a toggle that flips that language-scoped value, because VS Code's built-in
//      "Toggle Render Whitespace" only flips the global one, which a language-scoped value overrides.
'use strict'
const vscode = require('vscode')

const LANGUAGE_SCOPE = '[dtab]'
const RENDER_WHITESPACE = 'editor.renderWhitespace'
const DEFAULT_RENDER_WHITESPACE = 'boundary'   // tabs and multi-space runs shown, single spaces not

/** Query. The user's language-scoped editor settings for dtab, as stored in their settings.json ({} if none). */
function userLanguageSettings() {
    return vscode.workspace.getConfiguration().inspect(LANGUAGE_SCOPE)?.globalValue ?? {}
}

/** Command. Writes one key into the user's `[dtab]` settings block, keeping the others. */
async function setLanguageSetting(key, value) {
    const merged = {...userLanguageSettings(), [key]: value}
    await vscode.workspace.getConfiguration().update(LANGUAGE_SCOPE, merged, vscode.ConfigurationTarget.Global)
}

/** Command. Seeds the whitespace default once; a user who has set anything keeps it. */
async function seedDefault() {
    if (RENDER_WHITESPACE in userLanguageSettings()) return
    await setLanguageSetting(RENDER_WHITESPACE, DEFAULT_RENDER_WHITESPACE)
}

/** Command. Flips the dtab whitespace rendering between the default and none. */
async function toggleRenderWhitespace() {
    const current = userLanguageSettings()[RENDER_WHITESPACE] ?? DEFAULT_RENDER_WHITESPACE
    await setLanguageSetting(RENDER_WHITESPACE, current === 'none' ? DEFAULT_RENDER_WHITESPACE : 'none')
}

function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('dtab.toggleRenderWhitespace', toggleRenderWhitespace))
    seedDefault()
}

module.exports = {activate}
