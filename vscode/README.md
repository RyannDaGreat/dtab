# dtab for VS Code

Syntax highlighting, a live JSON preview and a Δ file icon for `.dtab` files.

dtab (Delta Tab) is a config format made of tab-separated paths: one line is one path into a tree,
and later lines are deltas on top of earlier ones. Format, parsers and a live demo:
https://github.com/RyannDaGreat/dtab

Object keys, leaf keys, values, comments (entries starting with a space) and invalid keys each get
their own scope, so any color theme applies. The Tab key inserts a tab.

To see the whitespace that carries the structure, press the whitespace button in the editor title bar
(a Δ with a dot), or run `dtab: Toggle Whitespace`. It draws every tab, and the spaces that start or end an
entry (a comment's leading space, trailing spaces), but not the spaces between the words of a value or
comment. It switches the `dtab.showWhitespace` setting. VS Code's own Toggle Render Whitespace works as
usual, independently.

Inside a multiline string (a `key word` line with lines indented under it) the Tab key inserts four spaces,
since code indents with spaces and tabs are dtab
structure. Everywhere else it inserts a tab.

The preview button in the editor title bar (or Cmd+K V / Ctrl+K V) opens the file's tree as JSON beside
it, updated as you type. While the file does not parse, it shows the parser's message with the line number.
