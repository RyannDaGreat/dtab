// Runs the ORIGINAL Lab-In-A-Cube djson.js (vendored untouched in test/original/) under node on a file.
// Usage: node test/run_original.js path/to/file.dtab   -> prints JSON to stdout
// Leaves are kept as raw strings via the original's own leaf_parser option, matching dtab's strings-only rule.
// Whitespace-only lines are removed first (dtab ignores them; the original turned them into empty keys that
// swallowed the following indented lines).
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const original = path.join(__dirname, 'original')
const context = {
    console: { assert: console.assert, warn() {}, error: console.error, log() {} },
    Audio: function () {},   // r.js instantiates one at load time
}
context.window = context
vm.createContext(context)   // the context gets its OWN builtins (Object etc.) so prototype checks pass
for (const file of ['proxies.js', 'r.js', 'assert.js', 'deltas.js', 'djson_macros.js', 'djson.js'])
    vm.runInContext(fs.readFileSync(path.join(original, file), 'utf8'), context, { filename: file })

const text = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(line => line.trim()).join('\n')
const parsed = vm.runInContext('(text) => JSON.stringify(djson.parse(text, {leaf_parser: x => x}))', context)(text)
process.stdout.write(parsed + '\n')
