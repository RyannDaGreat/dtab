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

Key punctuation (`_.-/`, the characters allowed in keys besides letters and digits) lives in five places and changes together: `dtab.py`, `dtab.js`, `dtab.vim`, `vscode/make_grammar.py` (then run it to regenerate the grammar), and the key rule bullet of `skills/dtab/SKILL.md`.

The rules are stated in prose in five places and change together: the README (Rules, Multiline strings), the docstring at the top of `dtab.py`, the header comment of `dtab.js`, the demo's starting document in `docs/index.html` (`EXAMPLE`), and `skills/dtab/SKILL.md`. A syntax change also means new samples in `test/samples/` and, in the skill, an example pair showing it: the tests parse every ```dtab fence in the skill and compare it with the ```json fence after it, in Python and in JS, so the skill's examples cannot drift from the parsers.

`skills/dtab/SKILL.md` is the agent skill. One file serves Claude Code, Codex, Cursor, Gemini CLI, Copilot, Amp and OpenCode, which all read the Agent Skills format (a folder with `SKILL.md`, frontmatter `name` and `description`); `npx skills add RyannDaGreat/dtab` finds it under `skills/` and installs it into whichever agents are present. Keep it short: the description is what makes an agent load it, and the body sits in the agent's context afterwards. Its fences hold real tabs; an editor that converts tabs to spaces breaks the test, which is the point.

The whitespace a comma in a key allows (spaces, then tabs or line breaks, then the next key; a comment or nothing there is an error) lives in six places and changes together: `dtab.py` (`_SPACED_KEYS`, `_DANGLING`, the pull of the next line in `parse`), `dtab.js` (`SPACED_KEYS`, `DANGLING`, `closeUp`), `dtab.vim` (`s:keys`, `s:line_keys`, `dtabComma`, `s:Entries`, `s:Dangling`), `vscode/make_grammar.py` (`KEYS` and the object key rule's `,$`), `vscode/extension.js` (`KEYS`), `docs/index.html` (`KEYS`, `continuation`, the key scan in the mode's `token`). The editors are line-based: a key list that goes on to the next line is one match in Vim, but the TextMate grammar paints the dangling line as object keys whatever the list ends as, and none of the editors' header detection (Tab key, `J`, semantic tokens, the demo) sees a multiline string's header that is split over lines unless the continuation keeps the header's indent. The parsers are exact in every case. `test/samples/comma_whitespace.dtab` shows every form; the tail of `test/samples/highlight.dtab` pins the highlighting.

`vscode/dtab.js` is a symlink to the root `dtab.js` (the extension's JSON preview parses with it); the VSIX packager copies it in.

Never write tokens into this repo.

The language tags a multiline string can carry (`sql`, `python`, `bash`, ...) live in four places and change together: `dtab.vim` (`s:dtab_languages`, `s:dtab_shebangs`), `vscode/make_grammar.py` (`EMBEDDED`, `SHEBANGS`), `docs/index.html` (`TAG_MODES`, `shebangTag`), and the README's table.

## Not yet done

- **Claude Code terminal highlighting.** Claude Code colors fenced code in replies and the diffs of Edit/Write with highlight.js, so a ```dtab fence falls back to the markdown grammar and a `.dtab` diff is uncolored. Its plugin manifest (checked in 2.1.266) has an undocumented `syntaxHighlighting.hljsLanguages` list of up to 16 `{id, remote, integrity}` entries, `remote` being `npm:<pkg>[@ver]` or `github:<owner>/<repo>@<ref>#<path>.js` and `integrity` an SRI hash, but this build ignores the field at load time (`claude plugin validate` calls it unknown, `--debug` logs no grammar registration), so it is behind a rollout flag. When it ships: a highlight.js grammar file in this repo, referenced with the github form, since the npm form names no file and would load `dtab.js` itself (the `deltatab` package's main), plus a `.claude-plugin/plugin.json` at the repo root, which also auto-loads `skills/`. Test it like the VS Code grammar, token letters over `test/samples/highlight.dtab`. First check whether a local file in the plugin works without `remote`.

- **A Pygments lexer**, so `pygmentize -l dtab` and rp's string injection (`'''...'''#dtab` in the REPL) work. A `pygments.lexer.Lexer` subclass with a line scanner (a multiline string's extent depends on its header's tabs, which a regex table cannot express), shipped in this package and registered through the `pygments.lexers` entry point in `pyproject.toml`; it imports `KEY_PUNCTUATION` from `dtab.py` rather than copying it, and finds a multiline string's header the way the editors do: a line with one leaf whose value is one word, followed by a deeper line. Test it like the VS Code grammar: token letters over `test/samples/highlight.dtab` against `test/expected/highlight.txt`. Then two lines in rp's `prompt_toolkit/layout/lexers.py`, in `LanguageInjectionMixin._init_language_lexers`: a `LazyLexer('dtab', 'DtabLexer', **lexer_options)` next to the others and a `'dtab'` key in `self.language_lexers`.
