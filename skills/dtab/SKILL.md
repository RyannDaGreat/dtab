---
name: dtab
description: Read, write and check dtab (Delta Tab, .dtab) files, a config format of tab-separated paths into a tree. Use when a .dtab file is opened, edited or created, or when the user mentions dtab or Delta Tab.
---

# dtab

One line is one path into a tree, and later lines are deltas on top of earlier ones. Every value is a
string. There are no lists.

**Structure is made of TAB characters, never spaces.** Editors, chat and this file render a tab as
spaces, so type tabs deliberately, and check a file after writing it:

```sh
dtab FILE.dtab    # prints the tree as JSON, or the error with its line number (pip install dtab, or npm install deltatab)
```

## Rules

- Tabs separate the steps of a path. Several tabs in a row count as one, so columns can be aligned.
- An entry with a space is `key value`, split at the first space. It sets the key and stays at the
  same level, so `x 1	y .5` sets two keys.
- An indented line continues the path of the line above it.
- Writing a key again replaces it. Writing into an object merges. The last line wins.
- `a,b` writes the same value under `a` and under `b`.
- An entry that starts with a space is a comment.
- A key is a run of letters, digits, `_`, `.`, `-` and `/`. Anything else is an error, with the line number.
- A line that is one `key tag` entry, with lines indented under it, is a multiline string: those lines
  are the value, verbatim from one tab in, so tabs and deeper indentation inside are kept. The tag
  (`sql`, `python`, `txt`, or nothing) tells editors what to highlight and is not part of the value.
  Trailing blank lines are dropped. This is the only way to put a tab in a value.
- A line indented under a line of several leaves is an error, since no leaf can claim it.
- A key holds a value or children, never both: a `key value` line with deeper lines under it is a
  multiline string.

## Examples

Each dtab block is followed by the tree it parses to.

```dtab
objects	l1,l2 light
deltas	l1	position	x 1	y .5
	z -2
```
```json
{"objects": {"l1": "light", "l2": "light"},
 "deltas": {"l1": {"position": {"x": "1", "y": ".5", "z": "-2"}}}}
```

Wide, deep and one-line forms are the same tree, so use whichever reads best:

```dtab
a	b	c x
a	b	d x
```
```json
{"a": {"b": {"c": "x", "d": "x"}}}
```
```dtab
a
	b
		c,d x
```
```json
{"a": {"b": {"c": "x", "d": "x"}}}
```

Comments, replacing and merging:

```dtab
 this whole line is a comment
server	host localhost	port 80	 a comment after the leaves
server	port 8080
server	tls	cert a.pem
```
```json
{"server": {"host": "localhost", "port": "8080", "tls": {"cert": "a.pem"}}}
```

Multiline strings:

```dtab
query sql
	SELECT name
	FROM users
	WHERE age > 30
notes txt
	Plain text. A tab	inside is kept.
```
```json
{"query": "SELECT name\nFROM users\nWHERE age > 30", "notes": "Plain text. A tab\tinside is kept."}
```

## From code

- Python: `pip install dtab`, then `dtab.parse(text)` returns nested dicts and `dtab.stringify(tree)`
  writes them back.
- JavaScript: `npm install deltatab`, then `require('deltatab').parse(text)` and `.stringify(tree)`.
- Both raise on an invalid key or a line under several leaves, naming the line.
- Values are strings: cast numbers and booleans yourself after parsing. For a list, use keys
  (`0`, `1`, ...) or one value with a separator, split when reading.
