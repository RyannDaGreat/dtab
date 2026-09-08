# dtab

Test everything: `python test/test_dtab.py` (needs node, vim, and `npm install --no-save puppeteer vscode-textmate vscode-oniguruma @vscode/test-electron` in one go, since each `--no-save` install removes the others; without them the web, grammar and live VS Code checks are skipped).

## Release

Bump the version in `dtab.py` (`__version__`), `package.json`, and `vscode/package.json` together, run the tests, commit, push.

1. **npm**: `npm publish` from the repo root (prompts for a 2FA code).
2. **PyPI**: `python -m build && twine upload dist/* && rm -rf dist build dtab.egg-info` (username `__token__`, password a PyPI token).
3. **VS Code**: `cd vscode && npx vsce package --no-dependencies`, then upload the `.vsix` at https://marketplace.visualstudio.com/manage/publishers/RyannDaGreat (`⋮` next to dtab, Update).
4. **Vim**: nothing; plugin managers pull from GitHub.
5. If `dtab.js` changed, refresh the demo's copy: `curl https://purge.jsdelivr.net/gh/RyannDaGreat/dtab@main/dtab.js`.

Colors live in three places and change together: `dtab.vim`, `docs/index.html` (`:root` vars), `vscode/package.json` (`tokenColorCustomizations`).

Key punctuation (`_.-/`, the characters allowed in keys besides letters and digits) lives in four places and changes together: `dtab.py`, `dtab.js`, `dtab.vim`, `vscode/make_grammar.py` (then run it to regenerate the grammar).

`vscode/dtab.js` is a symlink to the root `dtab.js` (the extension's JSON preview parses with it); the VSIX packager copies it in.

Never write tokens into this repo.

The language tags a `$` block can carry (`sql`, `python`, `bash`, ...) live in four places and change together: `dtab.vim` (`s:dtab_languages`, `s:dtab_shebangs`), `vscode/make_grammar.py` (`EMBEDDED`, `SHEBANGS`), `docs/index.html` (`TAG_MODES`, `shebangTag`), and the README's table.

## Not yet done

- **A Pygments lexer**, so `pygmentize -l dtab` and rp's string injection (`'''...'''#dtab` in the REPL) work. A `pygments.lexer.Lexer` subclass with a line scanner (a `$` block's extent depends on its line's tabs, which a regex table cannot express), shipped in this package and registered through the `pygments.lexers` entry point in `pyproject.toml`; it imports `KEY_PUNCTUATION` and the tag table from `dtab.py` rather than copying them. Test it like the VS Code grammar: token letters over `test/samples/highlight.dtab` against `test/expected/highlight.txt`. Then two lines in rp's `prompt_toolkit/layout/lexers.py`, in `LanguageInjectionMixin._init_language_lexers`: a `LazyLexer('dtab', 'DtabLexer', **lexer_options)` next to the others and a `'dtab'` key in `self.language_lexers`. Do it after the `$` marker decision, so it is written once.
