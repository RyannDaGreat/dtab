# dtab

Test everything: `python test/test_dtab.py` (needs node, vim; puppeteer and vscode-textmate via `npm install --no-save`).

## Release

Bump the version in `dtab.py` (`__version__`), `package.json`, and `vscode/package.json` together, run the tests, commit, push.

1. **npm**: `npm publish` from the repo root (prompts for a 2FA code).
2. **PyPI**: `python -m build && twine upload dist/* && rm -rf dist build dtab.egg-info` (username `__token__`, password a PyPI token).
3. **VS Code**: `cd vscode && npx vsce package --no-dependencies`, then upload the `.vsix` at https://marketplace.visualstudio.com/manage/publishers/RyannDaGreat (`⋮` next to dtab, Update).
4. **Vim**: nothing; plugin managers pull from GitHub.
5. If `dtab.js` changed, refresh the demo's copy: `curl https://purge.jsdelivr.net/gh/RyannDaGreat/dtab@main/dtab.js`.

Never write tokens into this repo.
