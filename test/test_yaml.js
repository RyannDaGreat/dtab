/** Command. Checks YAML data equivalence and source layout independently of editor rendering. */
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const YAML = require('yaml')
const dtab = require('../dtab.js')
const {toYAML} = require('../tools.js')

/**
 * Command. Reports and checks both YAML schemas and source tracing against ordinary DTAB parsing.
 * @param {string} source - Valid DTAB.
 * @param {string} [label] - Assertion context.
 * @returns {string} Converted YAML.
 * @example check('a 1') // 'a: 1\n'
 */
function check(source, label = 'case') {
    console.log('Checking YAML:', label)
    const expected = dtab.parse(source)
    const traced = dtab.parseWithSource(source)
    assert.deepStrictEqual(traced.value, expected, label + ': provenance changed parsing')
    for (const entry of traced.entries) {
        assert.ok(entry.start >= 0 && entry.end >= entry.start && entry.end <= source.length, label + ': source range')
        if (entry.type === 'comment') assert.ok(source.slice(entry.start, entry.end).startsWith(' '), label + ': comment range')
    }
    const yaml = toYAML(source)
    assert.deepStrictEqual(dtab.parse(dtab.stringify(YAML.parse(yaml))), expected, label + ': YAML 1.2 cycle')
    assert.deepStrictEqual(dtab.parse(dtab.stringify(YAML.parse(yaml, {version: '1.1'}))), expected, label + ': YAML 1.1 cycle')
    return yaml
}

for (const name of fs.readdirSync(path.join(__dirname, 'samples'))) {
    if (name.endsWith('.dtab') && name !== 'highlight.dtab') check(fs.readFileSync(path.join(__dirname, 'samples', name), 'utf8'), name)
}
for (const source of [
    '', ' ', '\n', ', ', ',', ',\t, 1\t, 2\n,\t, 3\t, 4',
    'a,a\t, x\na,b\t, y\nb\t, z', 'a,\n\n\tb 1\t note',
    'a 1\t old note\nb 2\na 3\t new note', 'a\t leaf note\n\tx 1\n\tafter 2',
    'x 1\t first\ty 2\t second', 'a\t note\tb\t note two\tc value',
    'a,b 1\t fan-out note\na 2', ',\t first row\n\tx 1\n,\tsecond 2',
    'code sql\t query note\n\tSELECT 1\n\n\t-- not a YAML comment\n\nnext done',
    'code \n\n\t  indented\n\t\ttabbed\n\n',
    'literal txt\n\t# dtab-layout-0\n\tfake:\n\t  nested',
    'on yes\ntrue false\nnull null\n007 007\ndate 2026-09-07\nempty \n-',
    '__proto__\tconstructor prototype\n10 ten\n2 two\n1 one',
    'value a: b # c\t </pre><script>window.yamlInjected=true</script>',
    'value \u0000\u001b\u0085\u2028\u2029\uD800',
    'x ok\t note\u0000\u001b\uD800\uFFFF',
    'x ok\t first\rnot: data\u0085still: comment\u2028also: comment\u2029last: comment',
    'x 1\r\n comment\r\ny 2\r\n',
]) check(source, JSON.stringify(source))

assert.strictEqual(check('count 12\nflag false'), 'count: 12\nflag: "false"\n')
for (const [value, expected] of [
    ['19677', 19677], ['0', 0], ['-12', -12],
    ['9007199254740991', Number.MAX_SAFE_INTEGER], ['-9007199254740991', Number.MIN_SAFE_INTEGER],
    ['019677', '019677'], ['+12', '+12'], ['-0', '-0'], ['1.0', '1.0'], ['1.25', '1.25'],
    ['1e3', '1e3'], ['0x10', '0x10'], [' 19677', ' 19677'], ['19677 ', '19677 '],
    ['9007199254740992', '9007199254740992'], ['9007199254740993', '9007199254740993'],
    ['1000000000000000100', '1000000000000000100'], ['true', 'true'], ['null', 'null'], ['', ''],
]) assert.strictEqual(YAML.parse(check('value ' + value, 'scalar ' + JSON.stringify(value))).value, expected)
assert.strictEqual(check('19677 19677'), '"19677": 19677\n', 'numeric keys remain strings')
assert.deepStrictEqual(YAML.parse(check(', 19677\n, 019677')), [19677, '019677'])
assert.strictEqual(YAML.parse(check('body txt\n\t19677')).body, '19677', 'literal string bodies retain their layout and type')
assert.strictEqual(check(','), '- {}\n')
assert.strictEqual(check('\n note\n\n\nkey 1\n\n'), '\n# note\n\n\nkey: 1\n\n')
assert.strictEqual(check(' note'), '# note\n{}\n')
const notes = check('a 1\t old note\nb 2\na 3\t new note')
assert.strictEqual((notes.match(/old note/g) || []).length, 1)
assert.strictEqual((notes.match(/new note/g) || []).length, 1)
assert.strictEqual((notes.match(/^a:/gm) || []).length, 1, 'deltas produce one YAML key')
for (const source of [
    'a\n\tx 1\nb\n\ty 2\na\n\tx 3\t note-about-a',
    'a 1\t first-a\nb 2\n note-about-a\na 3\t last-a',
    'a 1\t first-a\nb 2\na txt\t note-about-a\n\t  body\n\tlast',
    'a\t first-a\n\tx 1\nb 2\na\t note-about-a\n\tx 3',
]) {
    const output = check(source, 'delta comments stay with their owner')
    assert.ok(output.indexOf('note-about-a') < output.indexOf('\nb:'), output)
    for (const note of ['first-a', 'last-a']) if (source.includes(note)) assert.strictEqual((output.match(new RegExp(note, 'g')) || []).length, 1)
}
assert.ok(check('a,b 1\t one note').includes('one note'))
assert.strictEqual((check('a,b 1\t one note').match(/one note/g) || []).length, 1, 'fan-out does not duplicate comments')

const annotated = fs.readFileSync(path.join(__dirname, 'yaml', 'annotated.dtab'), 'utf8')
const converted = check(annotated, 'rich annotated fixture')
const rows = converted.split('\n')
const tableHeader = rows.find(line => line.includes('assets.parquet:'))
const idRow = rows.find(line => line.includes('asset_id: "@"'))
const urlRow = rows.find(line => line.includes('proxy_url: uri'))
assert.strictEqual(tableHeader.indexOf('TYPE'), idRow.indexOf('str'), 'header and field type columns stay aligned')
assert.strictEqual(tableHeader.indexOf('TYPE'), urlRow.indexOf('str'), 'optional key column does not shift other columns')
assert.strictEqual(tableHeader.indexOf('DESCRIPTION'), idRow.indexOf('Stable asset'), 'description column stays aligned')
assert.strictEqual(tableHeader.indexOf('EXAMPLE'), idRow.indexOf('"sample-id"'), 'example column stays aligned')
assert.ok(converted.includes('DOCUMENTATION ONLY BELOW'))
assert.ok(converted.includes('SUBFIELD'))
assert.ok(converted.includes('A final note stays below the queries'))
const leadingBody = '\n  leading\n# dtab-layout-0\nlast'
const literalTree = {rows: [leadingBody, {text: leadingBody}], after: 'next'}
for (const tabSize of [1, 2, 4, 8, 9]) {
    assert.deepStrictEqual(dtab.parse(dtab.stringify(YAML.parse(toYAML(annotated, {tabSize})))), dtab.parse(annotated))
    assert.deepStrictEqual(YAML.parse(toYAML(dtab.stringify(literalTree), {tabSize})), literalTree,
        'leading blanks and literal comment-looking text must survive every indentation width')
}
for (const tabSize of [0, -1, 1.5, 10, NaN, Infinity]) assert.throws(() => toYAML('a 1', {tabSize}), RangeError)
for (const source of ['bad|key 1', ', 1\nkey 2', 'a 1\na\tb 2']) {
    let message
    assert.throws(() => dtab.parse(source), error => { message = error.message; return true })
    assert.throws(() => toYAML(source), error => error.message === message)
}
console.log('test_yaml.js: data, strings, deltas, comments, columns, blanks, and adversarial cases passed')
