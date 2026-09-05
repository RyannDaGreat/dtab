<!-- <p align="center"><img src="https://raw.githubusercontent.com/RyannDaGreat/dtab/main/assets/logo.jpg" alt="dtab" width="640"></p> -->
<!-- <img width="6912" height="4188" alt="image" src="https://github.com/user-attachments/assets/db10af67-b7ba-4e42-a808-946c8cdcc2c7" /> -->
<img width="6912" height="2940" alt="image" src="https://github.com/user-attachments/assets/24f2187b-9e71-45e6-9a4b-427ad00e48c8" />



<p align="center"><sub>Logo made with <a href="https://github.com/RyannDaGreat/SvelteLib">PowerRP</a>. <a href="https://ryanndagreat.github.io/SvelteLib/?repo=RyannDaGreat/dtab">Open it in PowerRP</a> to edit it (source: <code>assets/doc.json</code>).</sub></p>

# dtab

**Delta Tab.** Config files made of tab-separated paths. One line is one path into a tree, and later lines are deltas on top of earlier ones.
[Try it in your browser](https://ryanndagreat.github.io/dtab/): dtab on the left, JSON on the right.

```
objects	l1,l2 light
deltas	l1	position	x 1	y .5
	z -2
```

```python
import dtab
dtab.parse(open("scene.dtab").read())
# {'objects': {'l1': 'light', 'l2': 'light'},
#  'deltas': {'l1': {'position': {'x': '1', 'y': '.5', 'z': '-2'}}}}
```

## Why

- Less to look at. No braces, quotes, or commas between values. A file with its tabs aligned reads like pseudocode, and is easy to write by hand, even on paper.
- Simple. Six rules, one pass, about 70 lines per implementation.
- Everything is addressable. There are no lists, so every value has a dotted path: `config.deltas.l1.position.x` works with EasyDict in Python and plain property access in JavaScript.
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

## Rules

- Tabs separate the steps of a path. `deltas	l1	position` walks three keys down. Several tabs in a row count as one, so you can align columns.
- An entry with a space is `key value`. It sets the key and stays at the same level, so `x 1	y .5` sets two keys.
- An indented line continues the path of the line above it.
- Writing a key again replaces it. Writing into an object merges.
- `a,b` writes the same value under `a` and under `b`.
- An entry that starts with a space is a comment.
- `$key` starts a multiline string. See below.

Every value is a string. Cast the ones you need. Keys are identifiers (letters, digits, underscores),
so attribute access like `config.deltas.l1` works with EasyDict and friends.

## Multiline strings

`$key` makes the lines indented under it the value, with their common indentation removed. Blank
lines inside are kept, trailing ones dropped.

```
$query sql
	SELECT name, age
	FROM users
	WHERE age > 30
```

The word after the key is optional. It tells editors which language to highlight and is not part of
the value. Unknown tags are plain text, never an error.

| Tag | Also |
|---|---|
| `sql` | |
| `python` | `py` |
| `javascript` | `js` |
| `typescript` | `ts` |
| `html`, `css`, `json`, `yaml`, `markdown` | `yml`, `md` |
| `bash` | `sh`, `shell`, `zsh` |
| `c`, `cpp`, `rust`, `go`, `java`, `swift` | |
| `dtab` | |

## Install

- **Python**: `pip install dtab` then `import dtab`
- **JavaScript**: `npm install deltatab` then `const dtab = require('deltatab')`, or `<script src="https://cdn.jsdelivr.net/npm/deltatab/dtab.js">` for `window.dtab`
- **Vim**: `Plugin 'RyannDaGreat/dtab'` (Vundle) or `Plug 'RyannDaGreat/dtab'` (vim-plug), or paste `dtab.vim` into your vimrc. Highlights `*.dtab`, flags bad keys and trailing tabs, and gives the file a Δ icon in NERDTree if vim-devicons is installed.
- **VS Code**: search "dtab" in Extensions, or `code --install-extension RyannDaGreat.dtab`. Highlighting plus a Δ file icon.

## API

- `parse(text)` returns nested dicts (Python) or plain objects (JavaScript). Raises on an invalid key, with the line number.
- `stringify(tree)` writes the tree back out, one key per line.
- Command line: `dtab scene.dtab` prints the tree as JSON.
