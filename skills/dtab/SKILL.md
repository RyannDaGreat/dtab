---
name: dtab
description: Read, write and check dtab (Delta Tab, .dtab) files, a config format of tab-separated paths into a tree. Use when a .dtab file is opened, edited or created, or when the user mentions dtab or Delta Tab.
---

# dtab

One line is one path into a tree, and later lines are deltas on top of earlier ones. Containers are
dictionaries or append-only lists; every leaf is a string.

**Structure is made of TAB characters, never spaces.** Editors, chat and this file render a tab as
spaces, so type tabs deliberately, and check a file after writing it:

```sh
dtab FILE.dtab    # prints the tree as JSON, or the error with its line number (pip install dtab, or npm install deltatab)
```

## Rules

- Tabs separate the steps of a path. Several tabs in a row count as one, so columns can be aligned.
  Trailing tabs outside string bodies are ignored. A space is different: `key ` is an empty leaf.
- An entry with a space is `key value`, split at the first space. It sets the key and stays at the
  same level, so `x 1	y .5` sets two keys.
- Deeper lines belong to the last non-comment entry: children for a container, text for a leaf.
- Writing a string key again replaces its value. Writing into a container merges. Changing its type is an error.
- A lone `,` key appends a fresh entry. Nonempty containers of only comma entries become lists, in order;
  named and comma keys cannot mix. Empty containers stay dictionaries; no distinct empty list exists.
- `a,b` writes the same value under `a` and under `b`. Spaces, tabs or a line break may follow the
  comma, so `a, b`, and `a,` at the end of a line with `b` on the next, are the same list. A key must
  follow the comma: a comment cannot stand there. A lone comma is not a continuation.
- An entry that starts with a space is a comment.
- A named key is a run of letters, digits, `_`, `.`, `-` and `/`. Anything else is an error, with the line number.
- When the last non-comment entry is a leaf, deeper lines replace its value with a multiline string.
  Earlier entries keep their values. The body is verbatim from one tab past the header line's leading
  indentation. The leaf's text (`sql`, `python`, `txt`, or nothing) is an editor tag, not part of the value.
  Trailing blank lines are dropped. This is the only way to put a tab in a value.

## Examples

Each dtab block is followed by the tree it parses to.

```dtab
objects	l1,l2 light
deltas	l1	position
	x 1	y .5	z -2
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

A key list may hold spaces after its commas, or go on to the next line after a comma at the end:

```dtab
lights	key, fill	on true
servers	alpha,
	beta,
	gamma	port 80
```
```json
{"lights": {"key": {"on": "true"}, "fill": {"on": "true"}},
 "servers": {"alpha": {"port": "80"}, "beta": {"port": "80"}, "gamma": {"port": "80"}}}
```

Comma entries use the same path/leaf rules. These tabs make a matrix; each leading comma starts a row:

```dtab
,	, 1	, 2
,	, 3	, 4
```
```json
[["1", "2"], ["3", "4"]]
```

Reopen a named list to append. A comma without children appends an empty dictionary, not an empty list:

```dtab
items	, red
items	,
empty
```
```json
{"items": ["red", {}], "empty": {}}
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

The last entry owns the deeper text, regardless of earlier leaves:

```dtab
hello world	moose meat
	world happy
```
```json
{"hello": "world", "moose": "world happy"}
```

Inline paths work too. These three forms are equivalent (the third has a trailing tab after `B`):

```dtab
A	B	code py
	Some Code Here
```
```json
{"A": {"B": {"code": "Some Code Here"}}}
```
```dtab
A	B
	code py
		Some Code Here
```
```json
{"A": {"B": {"code": "Some Code Here"}}}
```
```dtab
A	B	
	code py
		Some Code Here
```
```json
{"A": {"B": {"code": "Some Code Here"}}}
```

## From code

- Python: `pip install dtab`, then `dtab.parse(text)` returns nested dicts/lists and `dtab.stringify(tree)`
  writes them back.
- JavaScript: `npm install deltatab`, then `require('deltatab').parse(text)` and `.stringify(tree)`.
- Both raise on an invalid key, naming the line.
- Leaves are strings: cast numbers and booleans yourself after parsing. `stringify` rejects empty lists;
  use empty dictionaries instead.

## When unsure

The source is https://github.com/RyannDaGreat/dtab. `dtab.py` and `dtab.js` are the parsers, one
short function each, and the docstring at the top of `dtab.py` is the full specification.
`test/samples/*.dtab` exercise every feature, edge cases included; run `dtab` on one to see its tree.
Read a file with `curl https://raw.githubusercontent.com/RyannDaGreat/dtab/main/dtab.py`.
