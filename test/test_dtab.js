// JS-side checks for dtab.js: the documented examples, the key rule, and a parse/stringify round trip
// of every sample. Run with no arguments:  node test/test_dtab.js   (also `npm test`)
// test/test_dtab.py runs this too, and additionally compares dtab.js with dtab.py and the original.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const dtab = require('../dtab.js')

const samplesDir = path.join(__dirname, 'samples')
const HIGHLIGHT_SAMPLE = 'highlight.dtab'  // deliberately contains invalid keys for the vim test; not parsed

function testDocumentedExamples() {
    assert.deepStrictEqual(
        dtab.parse('objects\tl1,l2 light\ndeltas\tl1\tposition\tx 1\ty .5\n\tz -2'),
        {objects: {l1: 'light', l2: 'light'}, deltas: {l1: {position: {x: '1', y: '.5', z: '-2'}}}})
    assert.deepStrictEqual(dtab.parse('a\tb 1\n\t comment\na\tb 2'), {a: {b: '2'}})
    assert.deepStrictEqual(dtab.parse('a\t\t\tb 1'), {a: {b: '1'}})
    assert.strictEqual(
        dtab.stringify({objects: {l1: 'light'}, deltas: {l1: {x: 1, name: 'a b'}}}),
        'objects\n\tl1 light\ndeltas\n\tl1\n\t\tx 1\n\t\tname a b')
}

function testKeyRule() {
    for (const [text, fragment] of [
        ['a\tcheckpoint.initial 1', 'line 1: invalid key "checkpoint.initial"'],
        ['ok 1\n\t2nd 2', 'line 2: invalid key "2nd"'],
        ['a-b 1', 'invalid key "a-b"'],
        ['~scope\n\tx 1', 'invalid key "~scope"'],
        ['log\t@ e', 'invalid key "@"'],
        ['a,b.c\tx 1', 'invalid key "a,b.c"'],
    ])
        assert.throws(() => dtab.parse(text), error => error.message.includes(fragment), text)
    assert.deepStrictEqual(dtab.parse('items 1\nfrom 2\n_private 3\ncafé 4'), {items: '1', from: '2', _private: '3', café: '4'})
    for (const tree of [{'a b': '1'}, {'a,b': '1'}, {0: '1'}, {'': '1'}, {a: 'x\ty'}, {a: 'x\ny'}])
        assert.throws(() => dtab.stringify(tree), /dtab/)
}

function testRoundTrips() {
    for (const file of fs.readdirSync(samplesDir).filter(name => name.endsWith('.dtab') && name !== HIGHLIGHT_SAMPLE)) {
        const text = fs.readFileSync(path.join(samplesDir, file), 'utf8')
        const once = dtab.parse(text)
        assert.deepStrictEqual(dtab.parse(dtab.stringify(once)), once, file + ' did not round trip')
    }
}

testDocumentedExamples()
testKeyRule()
testRoundTrips()
console.log('test_dtab.js: all checks passed')
