<!-- <p align="center"><img src="https://raw.githubusercontent.com/RyannDaGreat/dtab/main/assets/logo.jpg" alt="dtab" width="640"></p> -->
<!-- <img width="6912" height="4188" alt="image" src="https://github.com/user-attachments/assets/db10af67-b7ba-4e42-a808-946c8cdcc2c7" /> -->
<img width="6912" height="2940" alt="image" src="https://github.com/user-attachments/assets/24f2187b-9e71-45e6-9a4b-427ad00e48c8" />



<p align="center"><sub>Logo made with <a href="https://github.com/RyannDaGreat/SvelteLib">PowerRP</a>. <a href="https://ryanndagreat.github.io/SvelteLib/?repo=RyannDaGreat/dtab">Open it in PowerRP</a> to edit it (source: <code>assets/doc.json</code>).</sub></p>

# dtab

**Delta Tab.** Config files made of tab-separated paths. One line is one path into a tree, and later lines are deltas on top of earlier ones.
[Try it in your browser](https://ryanndagreat.github.io/dtab/): dtab on the left, JSON or formatting-aware YAML on the right.

```
objects	l1,l2 light
deltas	l1	position
	x 1	y .5	z -2
```

```python
import dtab
dtab.parse(open("scene.dtab").read())
# {'objects': {'l1': 'light', 'l2': 'light'},
#  'deltas': {'l1': {'position': {'x': '1', 'y': '.5', 'z': '-2'}}}}
```

## Why

- Less to look at. No braces or quotes around values. Tabs align paths and values into columns.
- Small parser: one stack, followed by a linear pass to resolve lists.
- Named entries are addressable: `config.deltas.l1.position.x` with EasyDict in Python or plain property access in JavaScript, brackets for keys like `file.json`. Anonymous list entries are append-only.
- You choose the shape. Lines stack, and `c,d` writes one value under several keys, so the same tree can be written wide, deep, or on one line, trading horizontal space for vertical. These are the same file:

  ```
  a	b	c x
  a	b	d x
  ```
  ```
  a
  	b
  		c x
  		d x
  ```
  ```
  a	b	c,d x
  ```

  A long list goes one key per line, the comma at the end of each saying it goes on:

  ```
  servers	alpha,
  	beta,
  	gamma	port 80
  ```

## Rules

- Tabs separate the steps of a path. `deltas	l1	position` walks three keys down. Several tabs in a row count as one, so you can align columns. Trailing tabs outside string bodies are ignored.
- An entry with a space is `key value`. It sets the key and stays at the same level, so `x 1	y .5` sets two keys.
- Deeper lines belong to the last non-comment entry: children for a container, text for a leaf.
- Writing a string key again replaces its value. Writing into a container merges. Changing its type is an error.
- A lone `,` key appends a fresh entry. A nonempty container with only comma entries becomes a list, in order. Named and comma keys cannot mix. Empty containers stay dictionaries; a lone comma by itself produces `[{}]`, not `[]`.
- `a,b` writes the same value under `a` and under `b`. Spaces, tabs or a line break may follow the comma, so `a, b`, and `a,` at the end of a line with `b` on the next, are the same list. A key must follow the comma: a comment cannot stand there. A lone comma is not a continuation.
- An entry that starts with a space is a comment.
- A leaf with lines indented under it is a multiline string. See below.

Every leaf is a string. Cast the ones you need. A named key is any run of letters, digits, `_`, `.`, `-` and `/`,
so `file.json`, `2026-09-07`, `assets/logo` and `0` are keys. Keys that happen to be identifiers work as attributes
(`config.deltas.l1` with EasyDict and friends); the rest are reached with brackets (`config["file.json"]`).

## Lists

A comma entry follows the same path/leaf rules as a named entry. This matrix uses tabs between entries:

```text
,	, 1	, 2
,	, 3	, 4
```

It produces `[["1", "2"], ["3", "4"]]`. Reopening a named list appends more entries; existing entries have no keys to revisit. Empty lists have no distinct representation; use an empty dictionary instead.

## Multiline strings

When the last non-comment entry is a leaf, deeper lines replace its value with a multiline string.
Earlier entries keep their values. The body starts one tab past the header line's **leading indentation**
and is taken verbatim from there. Tabs and deeper indentation inside are part of the value.
This is the only way to put a tab in a value. Blank lines inside are kept, trailing ones dropped.

```
query sql	 a comment may follow the tag
	SELECT name, age
	FROM users
	WHERE age > 30
```

The leaf's own text is a tag that tells editors which language to highlight, and it is not part of the
value. Any text will do, `txt` or nothing at all (`prompt ` with a trailing space) for plain text.
Unknown tags are plain text, never an error. For example:

```
hello world	moose meat
	world happy
```

This gives `{"hello": "world", "moose": "world happy"}`: `moose` is last, so the text belongs to it.

These forms both give `{"A": {"B": {"code": "Some Code Here"}}}`:

```
A	B	code py
	Some Code Here
```
```
A	B
	code py
		Some Code Here
```

Trailing tabs after `B` or `code py` change nothing. A space is different: `B ` is an empty leaf,
not an object key.

| Tag | Also |
|---|---|
| `sql` | |
| `python` | `py` |
| `javascript` | `js` |
| `typescript` | `ts` |
| `html`, `css`, `json`, `jsonl`, `yaml`, `markdown` | `yml`, `md` |
| `bash` | `sh`, `shell`, `zsh` |
| `c`, `cpp`, `rust`, `go`, `java`, `swift` | |
| `dtab` | |

## Install

- **Python**: `pip install dtab` then `import dtab`
- **JavaScript**: `npm install deltatab` then `const dtab = require('deltatab')`, or `<script src="https://cdn.jsdelivr.net/npm/deltatab/dtab.js">` for `window.dtab`
- **Vim**: `Plugin 'RyannDaGreat/dtab'` (Vundle) or `Plug 'RyannDaGreat/dtab'` (vim-plug), or paste `dtab.vim` into your vimrc. Highlights `*.dtab`, flags bad keys, gives the file a Δ icon in NERDTree if vim-devicons is installed, `:DtabPreview` opens a split showing the tree as JSON that follows your edits (needs `+python3`), `J` joins the line below with a tab (deep form to wide form), or with a space after a comma, whenever that keeps the tree the same, and `gc` comments (below).
- **VS Code**: search "dtab" in Extensions, or `code --install-extension RyannDaGreat.dtab`. Highlighting, a Δ file icon, a live JSON preview of the file beside it (the preview button in the title bar, or Cmd+K V), a button beside it that draws the whitespace carrying the structure: the tabs, and the spaces that start or end an entry, not those between the words of a value, and Cmd+/ comments (below).
- **Monaco, Shiki and other TextMate hosts**: `npm install deltatab` includes the TextMate grammar, `deltatab/vscode/syntaxes/dtab.tmLanguage.json`. For Monaco, `await highlight(monaco, {wasm: fetch(onigWasmUrl), grammars: {'source.sql': sqlGrammar}})` from `deltatab/monaco.mjs` colors a registered `dtab` language the way VS Code does, multiline-string headers included. It needs `vscode-textmate`, `vscode-oniguruma`, and `'semanticHighlighting.enabled': true` in the editor options.
- **Claude Code, Codex, Cursor and other agents**: `npx skills add RyannDaGreat/dtab` installs a skill that teaches the agent the rules ([`skills/dtab/SKILL.md`](skills/dtab/SKILL.md), in the Agent Skills format they all read).

Commenting works the same in Vim (`gcc`, `gc` with a motion, `gc` on a visual selection, `:DtabComment`), in VS Code (Cmd+/ or Ctrl+/) and in the demo (Cmd+/ or Ctrl+/). A comment is an entry that starts with a space, so the toggle works on entries: the ones a selection touches, even part of a line, or every entry of the line a cursor is on. When all of them are comments, each loses one space; otherwise each gains one, so a comment among them becomes a double comment. Toggling twice gives the text back.

## API

- `parse(text)` returns nested dicts/lists (Python) or objects/arrays (JavaScript), with string leaves. Invalid keys, mixed named/anonymous keys and type changes raise errors.
- `stringify(tree)` writes the tree back out, one entry per line. Empty lists raise an error because they have no distinct representation.
- Command line: `dtab scene.dtab` prints the tree as JSON.
- JavaScript `parseWithSource(text)` returns `{value, entries}`: the same parsed data plus original UTF-16 ranges, final paths, comments, and blank lines for source-aware tools. It uses the same parser, not a separate grammar.

## JavaScript supporting tools: YAML

```javascript
const {toYAML} = require('deltatab/tools')
console.log(toYAML('port 19677\t Local service\n', {tabSize: 4}))
// port: "19677" # Local service
```

`toYAML(text, {tabSize: 4})` uses the `yaml` package for YAML syntax, quoting, and literal string blocks. Its output parses to the same data as `dtab.parse(text)`, with string leaves, including values that resemble numbers, booleans, or dates. The web editor's **JSON / YAML** selector uses this same function and remembers your choice; JSON remains the default.

This is source conversion, not `stringify(parse(text))`: comments and blank runs are retained, tabs are expanded at their original stops, and aligned documentation columns stay aligned. Sibling annotation rows share any extra horizontal shift needed when YAML punctuation or quotes consume their padding. Short uncommented paths and matrix rows use compact YAML collections when possible. See [the annotated example](test/yaml/annotated.dtab).

YAML cannot preserve every DTAB layout: fan-out expands, repeated keys merge to their final values, and inline paths with comments may need additional lines. Each source comment is retained once, near its surviving entry; later delta notes stay with that owner rather than moving to an unrelated section. Comments are not duplicated across fan-out. Multiline highlighting tags are not data and are omitted, while the string contents remain intact. Positions are logical character columns, not font-dependent glyph widths. `tabSize` also sets YAML indentation and must be an integer from 1 through 9.

For direct browser use, load the existing DTAB script first, then the YAML dependency and tools:

```html
<script src="https://cdn.jsdelivr.net/npm/deltatab/dtab.js"></script>
<script type="module">
import * as YAML from 'https://cdn.jsdelivr.net/npm/yaml@2.9.1/browser/index.js'
globalThis.YAML = YAML
await import('https://cdn.jsdelivr.net/npm/deltatab/tools.js')
console.log(dtabTools.toYAML('port 19677'))
</script>
```

Conversion errors are reported, not replaced with a comment-free dump. Generated YAML is checked against the parsed DTAB data before it is returned.
