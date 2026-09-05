// Drives docs/index.html in headless Chrome: the example parses, the JSON pane matches dtab.js on the
// same text, the editor highlights entries with the same classes dtab.vim uses, tabs are drawn, typing
// a tab inserts a tab, and a bad key shows the parser's error with its line number.
// Serves the repo root over HTTP so the page's CDN-or-local script fallback works offline.
// Run:  node test/test_web.js        (needs `npm install --no-save puppeteer` and a downloaded Chrome)
'use strict'
const assert = require('assert')
const fs = require('fs')
const http = require('http')
const path = require('path')
const puppeteer = require('puppeteer')
const dtab = require('../dtab.js')

const ROOT = path.join(__dirname, '..')
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg'}

/** Command. A static file server for ROOT on an OS-assigned port; resolves to [server, port]. */
function serve() {
    return new Promise(resolve => {
        const server = http.createServer((request, response) => {
            const file = path.join(ROOT, decodeURIComponent(request.url.split('?')[0]))
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                response.writeHead(404); response.end(); return
            }
            response.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'})
            response.end(fs.readFileSync(file))
        })
        server.listen(0, () => resolve([server, server.address().port]))
    })
}

/** Query (reads the page). The editor's text. */
const editorText = page => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue())

/** Command (edits the page). Replaces the editor's text, which re-renders the JSON pane. */
const setEditorText = (page, text) => page.evaluate(t => document.querySelector('.CodeMirror').CodeMirror.setValue(t), text)

/**
 * Query (reads the page). The [class, text] of every highlighted span on a 1-based editor line.
 * CodeMirror draws each tab as nested spans of padding spaces, so a tab is reported once as ['tab', '\t'].
 */
const lineTokens = (page, line) => page.evaluate(n =>
    [...document.querySelectorAll('.CodeMirror-line')[n - 1].querySelectorAll('span[class*="cm-"]')]
        .map(s => { const cls = s.className.replace(/\s*cm-/g, ' ').trim(); return [cls, cls === 'tab' ? '\t' : s.textContent] })
        .filter((token, i, all) => !(token[0] === 'tab' && i > 0 && all[i - 1][0] === 'tab')), line)

async function main() {
    const [server, port] = await serve()
    const browser = await puppeteer.launch({headless: true})
    try {
        const page = await browser.newPage()
        const failures = []
        page.on('pageerror', error => failures.push(error.message))
        await page.goto('http://127.0.0.1:' + port + '/docs/index.html', {waitUntil: 'networkidle0'})

        // 1. The example renders as JSON, and it is exactly what dtab.js says about the same text.
        const sourceText = await editorText(page)
        const shown = await page.$eval('#output', element => element.textContent)
        assert.deepStrictEqual(JSON.parse(shown), dtab.parse(sourceText), 'JSON pane differs from dtab.parse')
        assert.strictEqual(JSON.parse(shown).camera.fov, '35', 'last line should win')
        assert.strictEqual(JSON.parse(shown).lights.fill.castShadow, 'true', 'comma key should fan out')

        // 2. Highlighting: object keys, leaf keys, values, comments, tabs, and a bad key each get their class.
        await setEditorText(page, ' a comment\ncamera\tposition\tx 0\ty 5\nbad.key 1\n')
        assert.deepStrictEqual(await lineTokens(page, 1), [['dtab-comment', ' a comment']])
        assert.deepStrictEqual(await lineTokens(page, 2), [
            ['dtab-object-key', 'camera'], ['tab', '\t'], ['dtab-object-key', 'position'], ['tab', '\t'],
            ['dtab-leaf-key', 'x '], ['dtab-value', '0'], ['tab', '\t'], ['dtab-leaf-key', 'y '], ['dtab-value', '5'],
        ])
        assert.deepStrictEqual(await lineTokens(page, 3), [['dtab-bad-key', 'bad.key '], ['dtab-value', '1']])
        const tabGlyph = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-tab'), '::before').content)
        assert.strictEqual(tabGlyph, '"→"', 'tabs should be drawn as an arrow')
        const error = await page.$eval('#output', element => element.textContent)
        assert.ok(error.includes('line 3') && error.includes('bad.key'), 'error not shown: ' + error)

        // 2b. $ blocks: the tag picks an embedded language, a shebang picks one too, no tag means plain value text,
        //     and the block ends at the first line that is not deeper. The JSON pane shows the joined value.
        await setEditorText(page, '$query sql\n\tSELECT * FROM t\n$plain\n\tjust text\n$s\n\t#!/bin/bash\n\techo hi\nafter 1\n')
        assert.deepStrictEqual((await lineTokens(page, 1)).map(t => t[0]), ['dtab-block-key', 'dtab-block-tag'])
        const italic = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-dtab-block-tag')).fontStyle)
        assert.strictEqual(italic, 'italic', 'the language tag should be italic')
        assert.ok((await lineTokens(page, 2)).some(t => t[0] === 'keyword' && t[1] === 'SELECT'), 'sql keyword not highlighted in a $query sql block')
        assert.deepStrictEqual(await lineTokens(page, 4), [['tab', '\t'], ['dtab-block-text', 'just text']])
        assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.cm-dtab-block-text')).fontStyle), 'italic', 'plain block text should be italic')
        assert.ok((await lineTokens(page, 7)).some(t => t[0] === 'builtin' && t[1] === 'echo'), 'shebang did not select shell highlighting')
        assert.deepStrictEqual((await lineTokens(page, 8)).map(t => t[0]), ['dtab-leaf-key', 'dtab-value'])
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', e => e.textContent)),
            {query: 'SELECT * FROM t', plain: 'just text', s: '#!/bin/bash\necho hi', after: '1'})

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
        await setEditorText(page, ' a comment\ncamera\tposition\tx 0\ty 5\nbad.key 1\n')
        assert.strictEqual(await glyph(), '"→"', 'tabs back on should draw the arrows')

        // 4a. Inside a $ block, past the line's indent, the Tab key inserts spaces (code indents with spaces);
        //     at the start of a block line, and anywhere outside a block, it inserts a tab.
        await setEditorText(page, '$code python\n\tdef f():\n\t\nafter 1')
        const cm = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror)
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setCursor({line: 2, ch: 1}) })
        await page.keyboard.press('Tab'); await page.keyboard.type('return 1')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getLine(2)), '\t    return 1', 'Tab inside a block should insert spaces')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.setCursor({line: 2, ch: 0}) })
        await page.keyboard.press('Tab')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getLine(2)), '\t\t    return 1', 'Tab at the start of a block line should insert a tab')
        await page.evaluate(() => { const c = document.querySelector('.CodeMirror').CodeMirror; c.setCursor({line: 3, ch: 5}) })
        await page.keyboard.press('Tab')
        assert.strictEqual(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getLine(3)), 'after\t 1', 'Tab outside a block should insert a tab')

        // 4b. Shift-Tab outdents; Tab with a multi-line selection indents; each line by its own rule.
        const value = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue().split('\n'))
        const select = (a, b) => page.evaluate((a, b) => { const c = document.querySelector('.CodeMirror').CodeMirror; c.focus(); c.setSelection({line: a, ch: 0}, {line: b, ch: 0}) }, a, b)
        const shiftTab = async () => { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift') }
        await setEditorText(page, 'before 1\n$code python\n\tdef f():\n\t    return 1')
        await select(2, 3); await page.keyboard.press('Tab')
        assert.deepStrictEqual(await value(), ['before 1', '$code python', '\t    def f():', '\t        return 1'], 'a selection inside the block shifts by spaces')
        await shiftTab()
        assert.deepStrictEqual(await value(), ['before 1', '$code python', '\tdef f():', '\t    return 1'], 'Shift-Tab takes the spaces back')
        await select(1, 3); await page.keyboard.press('Tab')
        assert.deepStrictEqual(await value(), ['before 1', '\t$code python', '\t\tdef f():', '\t\t    return 1'], 'a selection touching the $ line shifts everything by tabs')
        await shiftTab()
        assert.deepStrictEqual(await value(), ['before 1', '$code python', '\tdef f():', '\t    return 1'], 'and Shift-Tab undoes it')

        // 4. The Tab key inserts a tab character instead of leaving the editor.
        await setEditorText(page, 'a')
        await page.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.focus(); cm.setCursor({line: 0, ch: 1}) })
        await page.keyboard.press('Tab')
        await page.keyboard.type('b 1')
        assert.strictEqual(await editorText(page), 'a\tb 1', 'Tab key did not insert a tab')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', element => element.textContent)), {a: {b: '1'}})

        assert.deepStrictEqual(failures, [], 'page errors: ' + failures.join('; '))
        console.log('test_web.js: all checks passed')
    } finally {
        await browser.close()
        server.close()
    }
}

main().catch(error => { console.error(error); process.exit(1) })
