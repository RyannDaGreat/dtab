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
    assert.deepStrictEqual(dtab.parse('query sql\n\tSELECT *\n\n\t\tFROM users\n\nnext 1'), {query: 'SELECT *\n\n\tFROM users', next: '1'})
    assert.deepStrictEqual(dtab.parse('table txt\n\tname\tage\nprompt \n\tLook here.\ndialect sql'), {table: 'name\tage', prompt: 'Look here.', dialect: 'sql'})
    assert.deepStrictEqual(dtab.parse('config\tdb\n\tinit sql\t schema\n\t\tCREATE\n\tport 1'), {config: {db: {init: 'CREATE', port: '1'}}}, 'a comment may follow the tag')
    assert.deepStrictEqual(dtab.parse('hello big world\n\tkey value'), {hello: 'key value'}, 'any leaf text is a tag')
    assert.throws(() => dtab.parse('x 1\ty 2\n\tz 3'), /line 2: indented under several leaves/)
    assert.deepStrictEqual(dtab.parse('x, y 1\nservers\talpha,\n\tbeta,\tgamma\tport 80'),
        {x: '1', y: '1', servers: {alpha: {port: '80'}, beta: {port: '80'}, gamma: {port: '80'}}}, 'whitespace after a comma is skipped, line breaks included')
    assert.throws(() => dtab.parse('a,\n comment\nb 1'), /line 1: invalid key "a,": a comma needs a key on both sides/)
    assert.strictEqual(dtab.parse('k a, b').k, 'a, b', 'a value keeps its comma and space')
    assert.strictEqual(dtab.stringify({query: 'SELECT *\nFROM t', table: 'a\tb'}), 'query txt\n\tSELECT *\n\tFROM t\ntable txt\n\ta\tb')
    for (const value of ['x\ny', 'x\ty', 'a\n\n\tb\n  c', '#!/bin/bash\necho hi', ''])
        assert.deepStrictEqual(dtab.parse(dtab.stringify({a: value})), {a: value}, 'multiline round trip: ' + JSON.stringify(value))
    assert.strictEqual(
        dtab.stringify({objects: {l1: 'light'}, deltas: {l1: {x: 1, name: 'a b'}}}),
        'objects\n\tl1 light\ndeltas\n\tl1\n\t\tx 1\n\t\tname a b')
}

function testKeyRule() {
    for (const [text, fragment] of [
        ['a\tc|d 1', 'line 1: invalid key "c|d"'],
        ['ok\n\tk:v 2', 'line 2: invalid key "k:v"'],
        ['~scope\n\tx 1', 'invalid key "~scope"'],
        ['log\t@ e', 'invalid key "@"'],
        ['a,b#c\tx 1', 'invalid key "a,b#c"'],
        ['"quoted" 1', 'invalid key "\\"quoted\\""'],
    ])
        assert.throws(() => dtab.parse(text), error => error.message.includes(fragment), text)
    assert.deepStrictEqual(dtab.parse('123aa 1\nfile.json 2\nfile-thing.json 3\n123.json-yaml 4\nitems 5\n_p 6\ncafé 7\n-x 8'),
        {'123aa': '1', 'file.json': '2', 'file-thing.json': '3', '123.json-yaml': '4', items: '5', _p: '6', café: '7', '-x': '8'})
    for (const tree of [{'a b': '1'}, {'a,b': '1'}, {'a|b': '1'}, {'': '1'}])
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
