// Drives docs/index.html in headless Chrome: the example parses, the JSON pane matches dtab.js on the
// same text, the editor highlights entries with the same classes dtab.vim uses, tabs are drawn, typing
// a tab inserts a tab, a bad key shows the parser's error with its line number, and Cmd-/ or Ctrl-/ toggles
// comments as test/comment_cases.json says.
// Default: serves the repo locally and substitutes the installed YAML build. DTAB_DEMO_URL tests real deployed assets instead.
// Run: node test/test_web.js, or DTAB_DEMO_URL=https://ryanndagreat.github.io/dtab/ node test/test_web.js
// Needs Puppeteer and a downloaded Chrome.
'use strict'
const assert = require('assert')
const fs = require('fs')
const http = require('http')
const path = require('path')
const puppeteer = require('puppeteer')
const dtab = require('../dtab.js')
const YAML = require('yaml')
const {toYAML} = require('../tools.js')

const ROOT = path.join(__dirname, '..')
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg'}

/** Command. A static file server for ROOT on an OS-assigned port; resolves to [server, port]. */
function serve() {
    return new Promise(resolve => {
        const server = http.createServer((request, response) => {
            const file = path.join(ROOT, decodeURIComponent(request.url.split('?')[0]))
            if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                response.writeHead(404); response.end(); return
            }
            response.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'})
            response.end(fs.readFileSync(file))
        })
        server.listen(0, '127.0.0.1', () => resolve([server, server.address().port]))
    })
}

/** Query (reads the page). The editor's text. */
const editorText = page => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue())

/** Command (edits the page). Replaces the editor's text, which re-renders the JSON pane. */
const setEditorText = (page, text) => page.evaluate(t => document.querySelector('.CodeMirror').CodeMirror.setValue(t), text)

/**
 * Query (reads the page). The [class, text] of every highlighted span on a 1-based editor line.
 * CodeMirror draws each tab as nested spans of padding spaces, so a tab is reported once as ['tab', '\t'].
 * Its tab-wrap-hack span is layout bookkeeping, not a syntax token.
 */
const lineTokens = (page, line) => page.evaluate(n =>
    [...document.querySelectorAll('.CodeMirror-line')[n - 1].querySelectorAll('span[class*="cm-"]:not(.cm-tab-wrap-hack)')]
        .map(s => { const cls = s.className.replace(/\s*cm-/g, ' ').trim(); return [cls, cls === 'tab' ? '\t' : s.textContent] })
        .filter((token, i, all) => !(token[0] === 'tab' && i > 0 && all[i - 1][0] === 'tab')), line)

/**
 * Command. Tests the local or deployed demo in a fresh browser; writes a preview screenshot and closes browser/server.
 * @returns {Promise<void>}
 * @example await main() // Resolves after all UI assertions pass; rejects on failure.
 */
async function main() {
    const liveURL = process.env.DTAB_DEMO_URL
    const RICH_PREVIEW_VIEWPORT = {width: 2400, height: 1800} // Fits both annotation grids and the full 70-line fixture.
    const YAML_CDN = 'https://cdn.jsdelivr.net/npm/yaml@' + require('yaml/package.json').version + '/'
    const YAML_ROOT = path.join(ROOT, 'node_modules', 'yaml')
    const [server, port] = liveURL ? [null, null] : await serve()
    const browser = await puppeteer.launch({headless: true})
    try {
        const page = await browser.newPage()
        const failures = [], yamlRequests = []
        // Local checks substitute YAML; deployed checks must fetch every asset from its real server.
        if (!liveURL) await page.setRequestInterception(true)
        page.on('request', request => {
            if (!request.url().startsWith(YAML_CDN)) { if (!liveURL) request.continue(); return }
            yamlRequests.push(request.url())
            if (liveURL) return
            const file = path.resolve(YAML_ROOT, decodeURIComponent(request.url().slice(YAML_CDN.length).split('?')[0]))
            if (!file.startsWith(YAML_ROOT + path.sep) || !fs.existsSync(file)) {
                request.respond({status: 404, body: 'Missing YAML browser module'}); return
            }
            request.respond({status: 200, contentType: 'text/javascript', headers: {'Access-Control-Allow-Origin': '*'}, body: fs.readFileSync(file)})
        })
        page.on('pageerror', error => { failures.push(error.message); console.error('Page error:', error.message) })
        const url = liveURL || 'http://127.0.0.1:' + port + '/docs/index.html'
        console.log('Testing', url, liveURL ? '(real CDN assets)' : '(local assets)')
        await page.goto(url, {waitUntil: 'networkidle0'})
        assert.deepStrictEqual(failures, [], 'page startup errors')
        assert.strictEqual(await page.evaluate(() => typeof dtab.parseWithSource), 'function', 'stale parser: YAML tools require parseWithSource')

        // 1. The example renders as JSON, and it is exactly what dtab.js says about the same text.
        const sourceText = await editorText(page)
        const shown = await page.$eval('#output', element => element.textContent)
        assert.deepStrictEqual(JSON.parse(shown), dtab.parse(sourceText), 'JSON pane differs from dtab.parse')
        assert.strictEqual(JSON.parse(shown).camera.fov, '35', 'last line should win')
        assert.strictEqual(JSON.parse(shown).lights.fill.castShadow, 'true', 'comma key should fan out')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getOption('lineNumbers')), true)
        assert.ok(await page.$('.CodeMirror-code .CodeMirror-linenumber'), 'source line numbers should be visible')
        assert.deepStrictEqual(await page.evaluate(() => [
            getComputedStyle(document.querySelector('.CodeMirror-gutters')).backgroundColor === getComputedStyle(document.querySelector('.pane')).backgroundColor,
            getComputedStyle(document.querySelector('.CodeMirror-linenumber')).color === getComputedStyle(document.querySelector('.pane .label')).color,
        ]), [true, true], 'line-number gutter should match the dark theme')

        // 2. Highlighting: object keys, leaf keys, values, comments, tabs, and a bad key each get their class.
        await setEditorText(page, ' a comment\ncamera\tposition\tx 0\ty 5\nbad|key 1\n')
        assert.deepStrictEqual(await page.$$eval('.CodeMirror-code .CodeMirror-linenumber', nodes => nodes.map(node => node.textContent)), ['1', '2', '3', '4'], 'numbers include blank lines and match parser error lines')
        assert.deepStrictEqual(await lineTokens(page, 1), [['dtab-comment', ' a comment']])
        assert.deepStrictEqual(await lineTokens(page, 2), [
            ['dtab-object-key', 'camera'], ['tab', '\t'], ['dtab-object-key', 'position'], ['tab', '\t'],
            ['dtab-leaf-key', 'x '], ['dtab-value', '0'], ['tab', '\t'], ['dtab-leaf-key', 'y '], ['dtab-value', '5'],
        ])
        assert.deepStrictEqual(await lineTokens(page, 3), [['dtab-bad-key', 'bad|key '], ['dtab-value', '1']])
        const tabGlyph = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-tab'), '::before').content)
        assert.strictEqual(tabGlyph, '"→"', 'tabs should be drawn as an arrow')
        const error = await page.$eval('#output', element => element.textContent)
        assert.ok(error.includes('line 3') && error.includes('bad|key'), 'error not shown: ' + error)

        // 2b. Multiline strings: the tag picks an embedded language, a shebang picks one too, no tag means plain text,
        //     and the block ends at the first line that is not deeper. The JSON pane shows the joined value.
        await setEditorText(page, 'query sql\n\tSELECT * FROM t\nplain txt\n\tjust text\ns \n\t#!/bin/bash\n\techo hi\nafter 1\n')
        assert.deepStrictEqual((await lineTokens(page, 1)).map(t => t[0]), ['dtab-block-key', 'dtab-block-tag'])
        const italic = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-dtab-block-tag')).fontStyle)
        assert.strictEqual(italic, 'italic', 'the language tag should be italic')
        assert.ok((await lineTokens(page, 2)).some(t => t[0] === 'keyword' && t[1] === 'SELECT'), 'sql keyword not highlighted in a sql string')
        assert.deepStrictEqual(await lineTokens(page, 4), [['tab', '\t'], ['dtab-block-text', 'just text']])
        assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.cm-dtab-block-text')).fontStyle), 'italic', 'plain block text should be italic')
        assert.ok((await lineTokens(page, 7)).some(t => t[0] === 'builtin' && t[1] === 'echo'), 'shebang did not select shell highlighting')
        assert.deepStrictEqual((await lineTokens(page, 8)).map(t => t[0]), ['dtab-leaf-key', 'dtab-value'])
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)),
            {query: 'SELECT * FROM t', plain: 'just text', s: '#!/bin/bash\necho hi', after: '1'})
        // A comment may follow the tag on the header line; a one-word leaf with nothing deeper is a plain leaf.
        await setEditorText(page, 'command bash\t note\n\techo hi\ndialect sql\nafter 1\n')
        assert.deepStrictEqual((await lineTokens(page, 1)).map(t => t[0]), ['dtab-block-key', 'dtab-block-tag', 'tab', 'dtab-comment'])
        assert.ok((await lineTokens(page, 2)).some(t => t[0] === 'builtin' && t[1] === 'echo'), 'the string under a bash header was not handed to the shell mode')
        assert.deepStrictEqual((await lineTokens(page, 3)).map(t => t[0]), ['dtab-leaf-key', 'dtab-value'], 'a one-word leaf without deeper lines stays a leaf')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {command: 'echo hi', dialect: 'sql', after: '1'})
        // jsonl: a JSON value per line, each line colored
        await setEditorText(page, 'log jsonl\n\t{"a": 1}\n\t{"a": true}\n')
        assert.deepStrictEqual((await lineTokens(page, 1)).map(t => t[0]), ['dtab-block-key', 'dtab-block-tag'])
        assert.ok((await lineTokens(page, 2)).some(t => t[0] === 'number' && t[1] === '1'), 'first line of a jsonl string not highlighted as JSON')
        assert.ok((await lineTokens(page, 3)).some(t => t[0] === 'atom' && t[1] === 'true'), 'second line of a jsonl string not highlighted as JSON')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {log: '{"a": 1}\n{"a": true}'})

        // Inline object paths and trailing tabs keep the final leaf's language and indentation baseline.
        for (const header of ['A\tB\tcode sql', 'A\tB\tcode sql\t', 'A\tB\tcode sql\t note\t']) {
            await setEditorText(page, header + '\n\tSELECT * FROM t\nafter 1\n')
            const tokens = await lineTokens(page, 1)
            assert.ok(tokens.some(t => t[0] === 'dtab-object-key' && t[1] === 'A'), 'object prefix lost its highlighting')
            assert.ok(tokens.some(t => t[0] === 'dtab-block-key' && t[1] === 'code'), 'inline block key not highlighted')
            assert.ok((await lineTokens(page, 2)).some(t => t[0] === 'keyword' && t[1] === 'SELECT'), 'inline sql string not highlighted')
            assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {A: {B: {code: 'SELECT * FROM t'}}, after: '1'})
        }
        for (const header of ['A\tB', 'A\tB\t']) {
            await setEditorText(page, header + '\n\tcode sql\n\t\tSELECT * FROM t')
            assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {A: {B: {code: 'SELECT * FROM t'}}})
        }

        await setEditorText(page, 'hello world\tmoose meat\t note\t\n\tworld happy')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {hello: 'world', moose: 'world happy'})
        assert.deepStrictEqual((await lineTokens(page, 1)).map(t => t[0]),
            ['dtab-leaf-key', 'dtab-value', 'tab', 'dtab-block-key', 'dtab-block-tag', 'tab', 'dtab-comment', 'tab'])
        await setEditorText(page, 'hello world\tmoose,\telk sql\n\tSELECT 1')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {hello: 'world', moose: 'SELECT 1', elk: 'SELECT 1'})
        assert.ok((await lineTokens(page, 2)).some(t => t[0] === 'keyword' && t[1] === 'SELECT'), 'only the last leaf selects the embedded language')

        // 2c. Whitespace after a comma in a key: spaces and tabs within the line, or a line break with the list
        //     going on on the next line, where the mode looks ahead to color the dangling keys as what the list
        //     turns out to be. A comma that only a comment follows is an error.
        await setEditorText(page, 'x, y 1\nlist\talpha,\n\tbeta,\tgamma\tport 80\nq,\nr txt\n\ttext\nbad,\n a comment\n')
        assert.deepStrictEqual(await lineTokens(page, 1), [['dtab-leaf-key', 'x, y '], ['dtab-value', '1']])
        assert.deepStrictEqual(await lineTokens(page, 2), [['dtab-object-key', 'list'], ['tab', '\t'], ['dtab-object-key', 'alpha,']])
        const tabbed = await lineTokens(page, 3)   // the tab inside the key token is drawn as spaces
        assert.deepStrictEqual(tabbed.map(t => t[0]), ['tab', 'dtab-object-key', 'tab', 'dtab-leaf-key', 'dtab-value'])
        assert.match(tabbed[1][1], /^beta, +gamma$/, 'one key token across the tab after the comma')
        assert.deepStrictEqual((await lineTokens(page, 4)).map(t => t[0]), ['dtab-leaf-key'], 'a dangling list that ends as a leaf is painted as one')
        assert.deepStrictEqual((await lineTokens(page, 5)).map(t => t[0]), ['dtab-block-key', 'dtab-block-tag'], 'the continuation line is the header')
        assert.deepStrictEqual(await lineTokens(page, 7), [['dtab-bad-key', 'bad,']])
        const commaError = await page.$eval('#output', element => element.textContent)
        assert.ok(commaError.includes('line 7') && commaError.includes('a comma needs a key'), 'error not shown: ' + commaError)

        // Anonymous entries stay separate; their multiline headers work like named headers.
        await setEditorText(page, ',\t, 1\t, 2\n,\t, 3\t, 4')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), [['1', '2'], ['3', '4']])
        assert.strictEqual((await lineTokens(page, 1)).filter(([kind]) => kind.includes('dtab-list-key')).length, 3)
        assert.deepStrictEqual(await page.$$eval('.cm-dtab-list-key', spans => spans.map(span => {
            const style = getComputedStyle(span)
            return [style.color, style.fontWeight]
        })), [
            ['rgb(215, 135, 215)', '700'], ['rgb(95, 215, 255)', '700'], ['rgb(95, 215, 255)', '700'],
            ['rgb(215, 135, 215)', '700'], ['rgb(95, 215, 255)', '700'], ['rgb(95, 215, 255)', '700'],
        ], 'list containers use bold object-key purple; string entries use bold cyan')
        await setEditorText(page, ', sql\n\tSELECT 1\n, done')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), ['SELECT 1', 'done'])
        assert.deepStrictEqual((await lineTokens(page, 1)).map(([kind]) => kind), ['dtab-leaf-key dtab-list-key', 'dtab-block-tag'])
        assert.deepStrictEqual(await page.$eval('.cm-dtab-list-key', span => {
            const style = getComputedStyle(span)
            return [style.color, style.fontWeight]
        }), ['rgb(95, 215, 255)', '700'], 'multiline string commas are also bold cyan')
        assert.ok((await lineTokens(page, 2)).some(([kind, text]) => kind === 'keyword' && text === 'SELECT'))

        // 3. The toggles: unchecking removes the colors and the tab glyphs, and the choice survives a reload.
        const valueColor = () => page.evaluate(() => getComputedStyle(document.querySelector('.cm-dtab-value')).color)
        const glyph = () => page.evaluate(() => getComputedStyle(document.querySelector('.cm-tab'), '::before').content)
        const plainColor = await page.evaluate(() => getComputedStyle(document.querySelector('.CodeMirror')).color)
        assert.notStrictEqual(await valueColor(), plainColor, 'values should be colored while highlight is on')
        await page.click('#toggle-highlight')
        assert.strictEqual(await valueColor(), plainColor, 'highlight off should leave values uncolored')
        await page.click('#toggle-tabs')
        assert.strictEqual(await glyph(), 'none', 'tabs off should hide the arrows')
        await page.reload({waitUntil: 'networkidle0'})
        assert.strictEqual(await page.$eval('#toggle-highlight', e => e.checked), false, 'toggle state should persist')
        await page.click('#toggle-highlight')
        await page.click('#toggle-tabs')
        await setEditorText(page, ' a comment\ncamera\tposition\tx 0\ty 5\nbad|key 1\n')
        assert.strictEqual(await glyph(), '"→"', 'tabs back on should draw the arrows')

        // 4a. Inside a multiline string, past the line's indent, the Tab key inserts spaces (code indents with spaces);
        //     at the start of a block line, and anywhere outside a block, it inserts a tab.
        await setEditorText(page, 'A\tB\thello world\tcode python\t\n\tdef f():\n\t\nafter 1')
        const cm = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror)
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setCursor({line: 2, ch: 1}) })
        await page.keyboard.press('Tab'); await page.keyboard.type('return 1')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getLine(2)), '\t    return 1', 'Tab inside a block should insert spaces')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.setCursor({line: 2, ch: 0}) })
        await page.keyboard.press('Tab')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getLine(2)), '\t\t    return 1', 'Tab at the start of a block line should insert a tab')
        await setEditorText(page, 'a\n\tcode \n\t\tbody\n\t\nafter 1')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setCursor({line: 3, ch: 1}) })
        await page.keyboard.press('Tab')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getLine(3)), '\t\t', 'a whitespace line at the header\'s depth is structure: Tab should insert a tab')
        await setEditorText(page, 'code python\n\tdef f():\n\t\nafter 1')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setCursor({line: 2, ch: 1}) })
        await page.keyboard.press('Tab'); await page.keyboard.type('return 1')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.setCursor({line: 2, ch: 0}) })
        await page.keyboard.press('Tab')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.setCursor({line: 3, ch: 5}) })
        await page.keyboard.press('Tab')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getLine(3)), 'after\t 1', 'Tab outside a block should insert a tab')

        // 4b. Shift-Tab outdents; Tab with a multi-line selection indents; each line by its own rule.
        const value = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue().split('\n'))
        const select = (a, b) => page.evaluate((a, b) => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setSelection({line: a, ch: 0}, {line: b, ch: c.getLine(b).length}) }, a, b)   // through the end of line b
        const shiftTab = async () => { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift') }
        await setEditorText(page, 'before\ncode python\n\tdef f():\n\t    return 1')
        await select(2, 3); await page.keyboard.press('Tab')
        assert.deepStrictEqual(await value(), ['before', 'code python', '\t    def f():', '\t        return 1'], 'a selection inside the block shifts by spaces')
        await shiftTab()
        assert.deepStrictEqual(await value(), ['before', 'code python', '\tdef f():', '\t    return 1'], 'Shift-Tab takes the spaces back')
        await select(1, 3); await page.keyboard.press('Tab')
        assert.deepStrictEqual(await value(), ['before', '\tcode python', '\t\tdef f():', '\t\t    return 1'], 'a selection touching the header shifts everything by tabs')
        await shiftTab()
        assert.deepStrictEqual(await value(), ['before', 'code python', '\tdef f():', '\t    return 1'], 'and Shift-Tab undoes it')
        // A Shift+Down selection ends at column 0 of the next line, which is not part of it.
        await setEditorText(page, 'code \n\tx\n\ty\nafter 1\n')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setSelection({line: 1, ch: 0}, {line: 3, ch: 0}) })
        await page.keyboard.press('Tab')
        assert.deepStrictEqual(await value(), ['code ', '\t    x', '\t    y', 'after 1', ''], 'a selection ending at column 0 must not touch that line')
        // Right after an edit above, the answer must come from the current text, not a stale highlight cache.
        await setEditorText(page, 'code\n\tx\n\ty\nafter 1\n')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.replaceRange(' ', {line: 0, ch: 4}); c.setCursor({line: 2, ch: 2}) })
        await page.keyboard.press('Tab')
        assert.deepStrictEqual(await value(), ['code ', '\tx', '\ty    ', 'after 1', ''], 'Tab right after turning the line above into a header should already give spaces')

        // 4. The Tab key inserts a tab character instead of leaving the editor.
        await setEditorText(page, 'a')
        await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.focus(); cm.setCursor({line: 0, ch: 1}) })
        await page.keyboard.press('Tab')
        await page.keyboard.type('b 1')
        assert.strictEqual(await editorText(page), 'a\tb 1', 'Tab key did not insert a tab')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', element => element.textContent)), {a: {b: '1'}})

        // 5. The comment toggle (Cmd-/ or Ctrl-/): every case of test/comment_cases.json, with the editor's own
        //    selections; pressed again with the selections as CodeMirror moved them, and a commented case is back.
        const {cases} = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'comment_cases.json'), 'utf8'))
        const utf16 = (line, column) => [...line].slice(0, column).join('').length
        const command = process.platform === 'darwin' ? 'Meta' : 'Control'
        const toggle = async modifier => { await page.keyboard.down(modifier); await page.keyboard.press('Slash'); await page.keyboard.up(modifier) }
        const selections = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.listSelections().map(r => [r.from().line, r.from().ch, r.to().line, r.to().ch]))
        for (const [index, {name, lines, selections: chosen, expected}] of cases.entries()) {
            await setEditorText(page, lines.join('\n'))
            const ranges = chosen.map(([sl, sc, el, ec]) => ({anchor: {line: sl, ch: utf16(lines[sl], sc)}, head: {line: el, ch: ec === null ? lines[el].length : utf16(lines[el], ec)}}))
            await page.evaluate(r => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setSelections(r) }, ranges)
            const commenting = !dtab.commentToggle(lines, ranges.map(r => [r.anchor.line, r.anchor.ch, r.head.line, r.head.ch])).remove
            await toggle(index % 2 ? 'Control' : command)   // both bindings, every other case
            assert.deepStrictEqual(await value(), expected, name)
            const predicted = dtab.toggleComments(expected, await selections())
            await toggle(command)
            assert.deepStrictEqual(await value(), predicted, name + ': pressed again')
            if (commenting) assert.deepStrictEqual(predicted, lines, name + ': pressed twice gives the lines back')
        }

        // 6. YAML is lazy, keeps exact copyable text, and never overwrites a newer JSON render.
        assert.deepStrictEqual(yamlRequests, [], 'JSON preview should not fetch YAML')
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror
            const choice = document.getElementById('preview-format')
            cm.setValue('old 1')
            choice.value = 'yaml'; choice.dispatchEvent(new Event('change'))
            cm.setValue('latest 2')
            choice.value = 'json'; choice.dispatchEvent(new Event('change'))
        })
        await page.waitForFunction(() => globalThis.dtabTools)
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {latest: '2'}, 'stale YAML load replaced JSON')
        assert.ok(yamlRequests.length > 0, 'YAML was not requested at the pinned version')
        const annotated = fs.readFileSync(path.join(ROOT, 'test', 'yaml', 'annotated.dtab'), 'utf8')
        await setEditorText(page, annotated)
        await page.select('#preview-format', 'yaml')
        await page.waitForFunction(expected => document.getElementById('output').textContent === expected, {}, toYAML(annotated))
        assert.deepStrictEqual(dtab.parse(dtab.stringify(YAML.parse(await page.$eval('#output', e => e.textContent)))), dtab.parse(annotated))
        await setEditorText(page, 'port 19677\nid 019677')
        await page.waitForFunction(expected => document.getElementById('output').textContent === expected, {}, toYAML('port 19677\nid 019677'))
        assert.deepStrictEqual(YAML.parse(await page.$eval('#output', e => e.textContent)), {port: 19677, id: '019677'})
        await page.select('#preview-format', 'json')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), {port: '19677', id: '019677'}, 'JSON remains string-valued')
        await setEditorText(page, annotated)
        await page.select('#preview-format', 'yaml')
        await page.waitForFunction(expected => document.getElementById('output').textContent === expected, {}, toYAML(annotated))
        assert.ok(await page.$('#output .cm-comment'), 'YAML comments should be highlighted')
        await page.setViewport(RICH_PREVIEW_VIEWPORT)
        await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.refresh())
        fs.mkdirSync(path.join(ROOT, '.scratchpad'), {recursive: true})
        await page.screenshot({path: path.join(ROOT, '.scratchpad', 'yaml-preview.png'), fullPage: true})

        const yamlTabbed = 'code txt\n\t\tactual tab\n\t  spaces\n'
        await setEditorText(page, yamlTabbed)
        await page.waitForFunction(expected => document.getElementById('output').textContent === expected, {}, toYAML(yamlTabbed))
        assert.ok((await page.$eval('#output', e => e.textContent)).includes('\t'), 'syntax coloring expanded data tabs')
        const hostile = 'x <img src=x onerror=window.yamlInjected=true>\t </pre><script>window.yamlInjected=true</script>'
        await setEditorText(page, hostile)
        await page.waitForFunction(expected => document.getElementById('output').textContent === expected, {}, toYAML(hostile))
        assert.strictEqual(await page.evaluate(() => Boolean(globalThis.yamlInjected || document.querySelector('#output img, #output script'))), false)
        await setEditorText(page, ', 1\nkey 2')
        await page.waitForFunction(() => document.querySelector('#output .error')?.textContent.includes('line 2'))
        await page.reload({waitUntil: 'networkidle0'})
        assert.strictEqual(await page.$eval('#preview-format', e => e.value), 'yaml', 'preview choice should persist')
        await page.waitForFunction(expected => document.getElementById('output').textContent === expected, {}, toYAML(await editorText(page)))
        await page.select('#preview-format', 'json')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)), dtab.parse(await editorText(page)))
        assert.deepStrictEqual(failures, [], 'page errors: ' + failures.join('; '))
        console.log('test_web.js: all checks passed')
    } finally {
        await browser.close()
        server?.close()
    }
}

main().catch(error => { console.error(error); process.exit(1) })
