// Checks the VS Code extension: the TextMate grammar loads and tokenizes the same sample the vim test
// uses, giving each entry the scope that matches its vim highlight group, and the package manifest
// points at files that exist.
// Run:  node test/test_vscode.js   (needs `npm install --no-save vscode-textmate vscode-oniguruma`)
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const textmate = require('vscode-textmate')
const oniguruma = require('vscode-oniguruma')

const ROOT = path.join(__dirname, '..')
const EXTENSION = path.join(ROOT, 'vscode')
const GRAMMAR = path.join(EXTENSION, 'syntaxes', 'dtab.tmLanguage.json')

// vim group letter (test/expected/highlight.txt) -> the TextMate scope fragment that must cover the same text
const SCOPE_FOR_VIM_GROUP = {
    O: 'entity.name.type.object-key',
    K: 'entity.name.tag.leaf-key',
    V: 'string.unquoted.value',
    C: 'comment.line',
    X: 'invalid.illegal.key',
}

/** Command (reads files). The dtab TextMate grammar, loaded through the same engine VS Code uses. */
async function loadGrammar() {
    const wasm = fs.readFileSync(path.join(ROOT, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'))
    const onigLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
        createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
        createOnigString: s => new oniguruma.OnigString(s),
    }))
    const registry = new textmate.Registry({
        onigLib,
        loadGrammar: scope => scope === 'source.dtab' ? textmate.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR) : null,
    })
    return registry.loadGrammar('source.dtab')
}

/**
 * Pure function. For one line, the innermost dtab scope covering each UTF-8 BYTE, as a string of
 * vim-style letters ('?' where no expected scope applies). Per byte, not per character, because the
 * vim expected map is per byte (vim's synID takes byte columns), so 'é' is two letters in both.
 *
 * @example letters(grammar, 'a\tb 1')  // 'O.KKV'
 */
function letters(grammar, line) {
    const {tokens} = grammar.tokenizeLine(line, textmate.INITIAL)
    const out = []
    for (const token of tokens) {
        const scopes = token.scopes.join(' ')
        let letter = '?'
        if (scopes.includes('punctuation.separator.tab') || scopes.includes('punctuation.whitespace.indent')) letter = '.'
        else if (scopes.includes('punctuation.separator.comma')) letter = ','
        else for (const [vim, scope] of Object.entries(SCOPE_FOR_VIM_GROUP)) if (scopes.includes(scope)) letter = vim
        out.push(letter.repeat(Buffer.byteLength(line.slice(token.startIndex, token.endIndex))))
    }
    return out.join('')
}

async function main() {
    const grammar = await loadGrammar()
    const sample = fs.readFileSync(path.join(ROOT, 'test', 'samples', 'highlight.dtab'), 'utf8').split('\n')
    const expected = fs.readFileSync(path.join(ROOT, 'test', 'expected', 'highlight.txt'), 'utf8').split('\n')
    for (let i = 0; i < expected.length; i++) {
        if (!sample[i]) continue
        // Differences that are fine: vim paints only the offending character of a bad key red, the grammar
        // paints the whole key (so X is accepted wherever vim has a key letter in an entry that contains an X);
        // the space after a leaf key is K in vim and uncaptured here; a trailing tab is E in vim, '.' here.
        const got = letters(grammar, sample[i])
        const want = expected[i].replace(/E/g, '.')
        const bytes = Buffer.from(sample[i])   // both maps are per byte
        const entryHasBadKey = c => {
            const start = bytes.lastIndexOf('\t', c) + 1
            let end = bytes.indexOf('\t', c); if (end === -1) end = bytes.length
            return want.slice(start, end).includes('X')
        }
        for (let c = 0; c < want.length; c++) {
            const ok = got[c] === want[c]
                || (want[c] === ' ' && got[c] === '?')
                || (bytes[c] === 0x20 && want[c] === 'K')
                || (got[c] === 'X' && 'OK'.includes(want[c]) && entryHasBadKey(c))
            assert.ok(ok, 'line ' + (i + 1) + ' col ' + (c + 1) + ': vim says ' + JSON.stringify(want[c]) + ', grammar says ' + JSON.stringify(got[c]) + '\n  ' + JSON.stringify(sample[i]) + '\n  want ' + want + '\n  got  ' + got)
        }
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'package.json'), 'utf8'))
    for (const file of [manifest.icon, manifest.contributes.languages[0].configuration, manifest.contributes.languages[0].icon.light,
                        manifest.contributes.languages[0].icon.dark, manifest.contributes.grammars[0].path])
        assert.ok(fs.existsSync(path.join(EXTENSION, file)), 'manifest points at missing file ' + file)
    assert.deepStrictEqual(manifest.contributes.languages[0].extensions, ['.dtab'])
    assert.ok(fs.existsSync(path.join(EXTENSION, manifest.main)), 'manifest main is missing')
    assert.ok(!('editor.renderWhitespace' in manifest.contributes.configurationDefaults['[dtab]']),
        'renderWhitespace must not be pinned by configurationDefaults (it would defeat the user toggle)')
    assert.strictEqual(manifest.contributes.commands[0].command, manifest.contributes.keybindings[0].command)
    require('child_process').execFileSync('node', ['--check', path.join(EXTENSION, manifest.main)])   // syntax only: it needs the vscode module to run
    console.log('test_vscode.js: all checks passed')
}

main().catch(error => { console.error(error); process.exit(1) })
