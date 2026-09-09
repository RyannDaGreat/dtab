"""
Writes the VS Code grammar (syntaxes/dtab.tmLanguage.json) and language-configuration.json from a few
constants, because TextMate grammars have no way to name a regex fragment: the key character class
alone appears forty times. Run it after changing anything below; test/test_dtab.py checks the committed
files match its output.

    python vscode/make_grammar.py
"""

import json
import re
from pathlib import Path

KEY_PUNCTUATION = "_.-/"  # Allowed in keys besides letters and digits. SEMANTIC BINDING: dtab-key-punctuation
KEY = r"[\p{L}\p{N}" + re.escape(KEY_PUNCTUATION) + "]+"  # \p{L}\p{N}: what Python's \w matches
KEYS = KEY + "(?:, *\\t*" + KEY + ")*"  # a,b comma keys; after a comma, spaces then tabs may follow (a line break may too, see the object key rule)
# The block goes on while lines are deeper than the header (its tabs are group 1) or blank. A lookahead, so the
# match is empty and the embedded grammar scans each line from column 0: VS Code's shell grammar only starts a
# statement after `^` or a separator (`;`, `|`, `&`, ...), so a scan that began after the tabs never saw a command.
WHILE = "^(?=\\1\\t|\\s*$)"

# (tag regex, VS Code grammar scope, name used in the meta scope). The README's table.
EMBEDDED = [
    ("sql", "source.sql", "sql"), ("python|py", "source.python", "python"), ("javascript|js", "source.js", "javascript"),
    ("typescript|ts", "source.ts", "typescript"), ("html", "text.html.basic", "html"), ("css", "source.css", "css"),
    ("json", "source.json", "json"), ("yaml|yml", "source.yaml", "yaml"), ("markdown|md", "text.html.markdown", "markdown"),
    ("bash|sh|shell|zsh", "source.shell", "shellscript"), ("c", "source.c", "c"), ("cpp", "source.cpp", "cpp"),
    ("rust", "source.rust", "rust"), ("go", "source.go", "go"), ("java", "source.java", "java"), ("swift", "source.swift", "swift"),
    ("dtab", "source.dtab", "dtab"),
]
# (interpreter regex in a shebang, scope, name)
SHEBANGS = [("bash|zsh|sh", "source.shell", "shellscript"), ("python\\d*", "source.python", "python"), ("node", "source.js", "javascript")]

# A header is a line with one leaf, comments allowed before and after, with lines indented under it. A TextMate grammar cannot look at the next line, so every such line opens a region that
# ends at once when nothing deeper follows, and the header itself is colored as the ordinary leaf it may be.
# The extension paints real headers (key yellow, tag orange) through semantic tokens, which can look ahead.
BLOCK_CAPTURES = {
    "2": {"name": "meta.entries-before-block.dtab", "patterns": [{"include": "#entry"}]},
    "3": {"name": "entity.name.tag.leaf-key.dtab", "patterns": [{"include": "#comma"}]},
    "4": {"name": "string.unquoted.value.dtab"},
    "5": {"name": "meta.entries-after-header.dtab", "patterns": [{"include": "#entry"}]},
}
HEADER = "^(\\t*)((?: [^\\t\\n]*\\t+)*)(%s) (%s)((?:\\t+ [^\\t\\n]*)*)$"  # tabs, comments, key(s), the tag, comments


def block_rule(tag_regex, scope, name):
    """Pure function. The rule for `key TAG`: the lines under it go to that language's grammar."""
    return {
        "comment": "key %s: the lines under it are highlighted as %s" % (name, name),
        "begin": HEADER % (KEYS, tag_regex),
        "beginCaptures": BLOCK_CAPTURES,
        "while": WHILE,
        "contentName": "meta.embedded.block.%s" % name,
        "patterns": [{"include": scope}],
    }


def shebang_rule(regex, scope, name):
    """Pure function. Inside a plain block: a shebang as the first text hands the rest to that language."""
    return {
        "comment": "A shebang as the block's first text picks %s for the rest of the block (lasts until the enclosing block ends)" % name,
        "begin": "(?<![^\\t])(#![^\\t]*\\b(?:%s)\\b[^\\t]*)" % regex,
        "beginCaptures": {"1": {"name": "comment.line.number-sign.shebang.%s" % name}},
        "while": "\\G",
        "contentName": "meta.embedded.block.%s" % name,
        "patterns": [{"include": scope}],
    }


def grammar():
    """Pure function. The whole TextMate grammar as a dict."""
    return {
        "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
        "name": "dtab",
        "scopeName": "source.dtab",
        "comment": "Same tokens as dtab.vim: an entry between tabs is a comment (leading space), a leaf (key value) or an "
                   "object key. Keys are letters, digits and " + " ".join(KEY_PUNCTUATION) + "; a comma between keys may be followed by "
                   "whitespace, a line break included. A `key word` line with lines "
                   "indented under it (bound with a backreference to its tabs) is a multiline string: those lines are text, "
                   "highlighted as the word's language, or as the language named by a shebang as the first text. Generated "
                   "by make_grammar.py; do not edit by hand.",
        "patterns": [
            {"comment": "A whitespace-only line", "match": "^\\s*$"},
        ] + [block_rule(*e) for e in EMBEDDED] + [
            {
                "comment": "key with any other tag, or none: plain text, unless its first text is a shebang",
                "begin": HEADER % (KEYS, "[^\\t\\n]*"),
                "beginCaptures": BLOCK_CAPTURES,
                "while": WHILE,
                "contentName": "markup.italic string.unquoted.block.dtab",
                "patterns": [shebang_rule(*s) for s in SHEBANGS],
            },
            {
                "comment": "Leading tabs (indent), then the entries of the line",
                "begin": "^(\\t*)",
                "beginCaptures": {"1": {"name": "punctuation.whitespace.indent.dtab"}},
                "end": "$",
                "patterns": [{"include": "#entry"}],
            },
        ],
        "repository": {
            "entry": {"patterns": [
                {"comment": "Tab run between entries", "match": "\\t+", "name": "punctuation.separator.tab.dtab"},
                {"comment": "Comment: an entry that starts with a space", "match": " [^\\t]*", "name": "comment.line.dtab"},
                {"comment": "Leaf: key(s), one space, value up to the next tab",
                 "match": "(%s) ([^\\t]*)" % KEYS,
                 "captures": {"1": {"name": "entity.name.tag.leaf-key.dtab", "patterns": [{"include": "#comma"}]},
                              "2": {"name": "string.unquoted.value.dtab"}}},
                {"comment": "Object key: key(s) with no space. A comma at the end of the line continues the list on the next line, which a "
                            "grammar cannot see, so the keys are object keys even when the list ends as a leaf there",
                 "match": "%s(?:,$)?(?=\\t|$)" % KEYS,
                 "captures": {"0": {"name": "entity.name.type.object-key.dtab", "patterns": [{"include": "#comma"}]}}},
                {"comment": "Anything else before a space: a bad key, with its value",
                 "match": "([^\\t ]+) ([^\\t]*)",
                 "captures": {"1": {"name": "invalid.illegal.key.dtab"}, "2": {"name": "string.unquoted.value.dtab"}}},
                {"comment": "Anything else with no space: a bad object key", "match": "[^\\t ]+", "name": "invalid.illegal.key.dtab"},
            ]},
            "comma": {"match": ",", "name": "punctuation.separator.comma.dtab"},
        },
    }


def language_configuration():
    """Pure function. VS Code's editor behavior for the language: comments, folding, what a word is."""
    return {
        "comments": {"lineComment": " "},
        "indentationRules": {"increaseIndentPattern": "^\\t*[^\\t ]+$", "decreaseIndentPattern": "^$"},
        "folding": {"offSide": True},
        "wordPattern": KEY,
    }


def write(directory):
    """Command (writes two files under directory). Returns the paths written."""
    directory = Path(directory)
    outputs = {directory / "syntaxes" / "dtab.tmLanguage.json": grammar(), directory / "language-configuration.json": language_configuration()}
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content, indent=4, ensure_ascii=False) + "\n")
    return [str(path) for path in outputs]


if __name__ == "__main__":
    print("\n".join(write(Path(__file__).parent)))
