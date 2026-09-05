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
// The embedded languages come from VS Code's own bundled grammars, which is also where they come from at runtime.
const VSCODE_EXTENSIONS = '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions'
const BUNDLED_GRAMMARS = {
    'source.sql': path.join(VSCODE_EXTENSIONS, 'sql/syntaxes/sql.tmLanguage.json'),
    'source.shell': path.join(VSCODE_EXTENSIONS, 'shellscript/syntaxes/shell-unix-bash.tmLanguage.json'),
}

// vim group letter (test/expected/highlight.txt) -> the TextMate scope fragment that must cover the same text
const SCOPE_FOR_VIM_GROUP = {
    O: 'entity.name.type.object-key',
    K: 'entity.name.tag.leaf-key',
    V: 'string.unquoted.value',
    C: 'comment.line',
    X: 'invalid.illegal.key',
    T: 'block-tag',
    B: 'string.unquoted.block',
    K2: 'entity.name.function.block-key',   // a $key: its own scope, same structural letter as a leaf key
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
        loadGrammar: scope => {
            if (scope === 'source.dtab') return textmate.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR)
            const file = BUNDLED_GRAMMARS[scope]
            return file && fs.existsSync(file) ? textmate.parseRawGrammar(fs.readFileSync(file, 'utf8'), file) : null
        },
    })
    return registry.loadGrammar('source.dtab')
}

/**
 * Pure function. For one tokenized line, the innermost dtab scope covering each UTF-8 BYTE, as a string
 * of vim-style letters ('?' where no expected scope applies). Per byte, not per character, because the
 * vim expected map is per byte (vim's synID takes byte columns), so 'é' is two letters in both.
 *
 * @example letters('a\tb 1', grammar.tokenizeLine('a\tb 1', textmate.INITIAL).tokens)  // 'O.KKV'
 */
function letters(line, tokens) {
    const out = []
    for (const token of tokens) {
        const scopes = token.scopes.join(' ')
        let letter = '?'
        if (scopes.includes('punctuation.separator.tab') || scopes.includes('punctuation.whitespace.indent')) letter = '.'
        else if (scopes.includes('punctuation.separator.comma')) letter = ','
        else for (const [vim, scope] of Object.entries(SCOPE_FOR_VIM_GROUP)) if (scopes.includes(scope)) letter = vim[0]
        out.push(letter.repeat(Buffer.byteLength(line.slice(token.startIndex, token.endIndex))))
    }
    return out.join('')
}

async function main() {
    const grammar = await loadGrammar()
    const sample = fs.readFileSync(path.join(ROOT, 'test', 'samples', 'highlight.dtab'), 'utf8').split('\n')
    const expected = fs.readFileSync(path.join(ROOT, 'test', 'expected', 'highlight.txt'), 'utf8').split('\n')
    let stack = textmate.INITIAL   // carried across lines, as VS Code does, so multi-line $ blocks work
    for (let i = 0; i < expected.length; i++) {
        const result = grammar.tokenizeLine(sample[i] ?? '', stack)
        stack = result.ruleStack
        if (!sample[i]) continue
        // Differences that are fine: vim paints only the offending character of a bad key red, the grammar
        // paints the whole key (so X is accepted wherever vim has a key letter in an entry that contains an X);
        // the space after a leaf key is K in vim and uncaptured here; a trailing tab is E in vim, '.' here.
        const got = letters(sample[i], result.tokens)
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
                || (want[c] === 'K' && bytes[c] === 0x24 && got[c] === '?')   // the $ of a block key: vim colors it, the grammar leaves it
                || (want[c] === 'T' && bytes[c] === 0x20 && got[c] === '?')   // the space before a block tag: vim's tag match includes it
                || (bytes[c] === 0x09 && (got[c] === '?' || got[c] === 'B'))  // tabs in and around a block: region vs capture boundaries
            assert.ok(ok, 'line ' + (i + 1) + ' col ' + (c + 1) + ': vim says ' + JSON.stringify(want[c]) + ', grammar says ' + JSON.stringify(got[c]) + '\n  ' + JSON.stringify(sample[i]) + '\n  want ' + want + '\n  got  ' + got)
        }
    }

    // Embedded languages: a tagged block hands its lines to that language's grammar; a shebang does the same.
    const sqlLine = grammar.tokenizeLine('\tSELECT * FROM t', grammar.tokenizeLine('$query sql', textmate.INITIAL).ruleStack)
    const inLanguage = (line, name, suffix) => line.tokens.some(tok => tok.scopes.includes('meta.embedded.block.' + name) && tok.scopes.some(s => s.endsWith(suffix) && !s.startsWith('meta.')))
    assert.ok(inLanguage(sqlLine, 'sql', '.sql'), 'sql block not handed to the sql grammar')
    const midLine = grammar.tokenizeLine('\t\tCREATE TABLE t', grammar.tokenizeLine('config\tdb\t$init sql', textmate.INITIAL).ruleStack)
    assert.ok(inLanguage(midLine, 'sql', '.sql'), 'a $ block after other entries on its line was not handed to sql')
    stack = textmate.INITIAL
    for (const line of ['$s', '\t#!/bin/bash']) stack = grammar.tokenizeLine(line, stack).ruleStack
    const shLine = grammar.tokenizeLine('\techo hi', stack)
    assert.ok(shLine.tokens.some(tok => tok.scopes.includes('meta.embedded.block.shellscript')), 'shebang block not handed to the shell grammar')
    const after = grammar.tokenizeLine('after 1', shLine.ruleStack)
    assert.ok(after.tokens.some(tok => tok.scopes.includes('entity.name.tag.leaf-key.dtab')), 'block did not end at a shallower line')

    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'package.json'), 'utf8'))
    for (const file of [manifest.icon, manifest.contributes.languages[0].configuration, manifest.contributes.languages[0].icon.light,
                        manifest.contributes.languages[0].icon.dark, manifest.contributes.grammars[0].path])
        assert.ok(fs.existsSync(path.join(EXTENSION, file)), 'manifest points at missing file ' + file)
    assert.deepStrictEqual(manifest.contributes.languages[0].extensions, ['.dtab'])
    assert.ok(!('editor.renderWhitespace' in manifest.contributes.configurationDefaults['[dtab]']),
        'renderWhitespace must not be set per language: it would defeat the built-in toggle')
    require('child_process').execFileSync('node', ['--check', path.join(EXTENSION, manifest.main)])   // syntax only: it needs the vscode module to run
    assert.strictEqual(manifest.contributes.keybindings[0].command, manifest.contributes.commands[0].command)

    // The block detector behind the Tab key is pure; load it with a stub in place of the vscode module.
    const Module = require('module'); const realLoad = Module._load
    Module._load = (request, ...rest) => request === 'vscode' ? {} : realLoad(request, ...rest)
    const {insideBlock} = require(path.join(EXTENSION, manifest.main))
    assert.strictEqual(insideBlock(['$code python', '\tdef f():', '\t    return 1'], 2), true)
    assert.strictEqual(insideBlock(['$code python', '\tdef f():', 'after 1'], 2), false)
    assert.strictEqual(insideBlock(['a', '\t$code', '\t\tx', '\t\t\tdeeper'], 3), true, 'nearest $ ancestor')
    assert.strictEqual(insideBlock(['a', '\tb', '\t\tc 1'], 2), false, 'no $ ancestor')
    assert.strictEqual(insideBlock(['$code', '\tx', ''], 2), true, 'blank line inside a block')
    assert.strictEqual(insideBlock(['a', '\t$code', '\t\tx', '\tnext 1'], 3), false, 'shallower line ends the block')
    assert.strictEqual(insideBlock(['config\tdb\t$init sql', '\t\tCREATE'], 1), true, '$ after other entries')
    assert.strictEqual(insideBlock(['$code', '\tx'], 0), false, 'the $ line itself is not inside the block')
    const {shiftLine} = require(path.join(EXTENSION, manifest.main))
    assert.strictEqual(shiftLine('\tdef f():', true, 1), '\t    def f():')
    assert.strictEqual(shiftLine('\t    return', true, -1), '\treturn')
    assert.strictEqual(shiftLine('\t  x', true, -1), '\tx', 'outdent removes what is there, up to one level')
    assert.strictEqual(shiftLine('\treturn', true, -1), '\treturn', 'no spaces to remove: the structural tab stays')
    assert.strictEqual(shiftLine('a\tb 1', false, 1), '\ta\tb 1')
    assert.strictEqual(shiftLine('\ta', false, -1), 'a')
    assert.strictEqual(shiftLine('', true, 1), '', 'blank lines are left alone')
    assert.ok(manifest.contributes.keybindings.some(k => k.mac === 'cmd+]' && k.command === 'dtab.indent'))
    assert.ok(manifest.contributes.keybindings.some(k => k.key === 'shift+tab' && k.command === 'dtab.outdent'))
    Module._load = realLoad
    console.log('test_vscode.js: all checks passed')
}

main().catch(error => { console.error(error); process.exit(1) })
