// Drives docs/index.html in headless Chrome: the example parses, the JSON pane matches dtab.js on the
// same text, typing a tab inserts a tab, and a bad key shows the parser's error with its line number.
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

async function main() {
    const [server, port] = await serve()
    const browser = await puppeteer.launch({headless: true})
    try {
        const page = await browser.newPage()
        const failures = []
        page.on('pageerror', error => failures.push(error.message))
        await page.goto('http://127.0.0.1:' + port + '/docs/index.html', {waitUntil: 'networkidle0'})

        // 1. The example renders as JSON, and it is exactly what dtab.js says about the same text.
        const sourceText = await page.$eval('#source', element => element.value)
        const shown = await page.$eval('#output', element => element.textContent)
        assert.deepStrictEqual(JSON.parse(shown), dtab.parse(sourceText), 'JSON pane differs from dtab.parse')
        assert.ok(sourceText.includes('\t'), 'example has no tabs')
        assert.strictEqual(JSON.parse(shown).camera.fov, '35', 'last line should win')
        assert.strictEqual(JSON.parse(shown).lights.fill.castShadow, 'true', 'comma key should fan out')

        // 2. The Tab key inserts a tab character instead of leaving the textarea.
        await page.focus('#source')
        await page.evaluate(() => { const s = document.getElementById('source'); s.value = 'a'; s.selectionStart = s.selectionEnd = 1 })
        await page.keyboard.press('Tab')
        await page.keyboard.type('b 1')
        assert.strictEqual(await page.$eval('#source', element => element.value), 'a\tb 1', 'Tab key did not insert a tab')
        assert.deepStrictEqual(JSON.parse(await page.$eval('#output', element => element.textContent)), {a: {b: '1'}})

        // 3. A bad key shows the parser's own message, line number included.
        await page.evaluate(() => { const s = document.getElementById('source'); s.value = 'ok 1\nbad.key 2'; s.dispatchEvent(new Event('input')) })
        const error = await page.$eval('#output', element => element.textContent)
        assert.ok(error.includes('line 2') && error.includes('bad.key'), 'error not shown: ' + error)

        assert.deepStrictEqual(failures, [], 'page errors: ' + failures.join('; '))
        console.log('test_web.js: all checks passed')
    } finally {
        await browser.close()
        server.close()
    }
}

main().catch(error => { console.error(error); process.exit(1) })
