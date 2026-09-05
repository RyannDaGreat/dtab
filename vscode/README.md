# dtab for VS Code

Syntax highlighting and a Δ file icon for `.dtab` files.

dtab (Delta Tab) is a config format made of tab-separated paths: one line is one path into a tree,
and later lines are deltas on top of earlier ones. Format, parsers and a live demo:
https://github.com/RyannDaGreat/dtab

Object keys, leaf keys, values, comments (entries starting with a space) and invalid keys each get
their own scope, so any color theme applies. The Tab key inserts a tab.

To see the tabs that carry the structure without dotting every space inside a value, set
`"editor.renderWhitespace": "boundary"` (it draws tabs and runs of spaces, not single spaces).
VS Code's normal Toggle Render Whitespace command works as usual.

Inside a `$` block the Tab key inserts four spaces, since code indents with spaces and tabs are dtab
structure. Everywhere else it inserts a tab.
