"""
Tests for dtab. Run with no arguments from the repo root:

    python test/test_dtab.py

Checks:
  1. dtab.py doctests.
  2. dtab.py and dtab.js agree with the ORIGINAL Lab-In-A-Cube djson.js (vendored untouched in
     test/original/, run under node by test/run_original.js with its raw-string leaf option) on every
     sample except deviations.dtab.
  3. dtab.py and dtab.js agree with each other on every sample; the deviating samples match their goldens
     in test/expected/, which were diffed against the original when written. The differences are exactly:
     blank lines are ignored, an object can overwrite a leaf, comma keys respect line order (in game_config
     that is one leaf, deltas.initial.l1.intensity, where the original ignored the later `l1	intensity 1`),
     and `$` multiline blocks, which the original did not have.
  4. parse(stringify(parse(text))) == parse(text) for every sample.
  5. The key rule: bad keys are rejected with a line number in parse and in stringify, and Python's
     str.isidentifier and the JS Unicode regex agree on a set of probes.
  6. node test/test_dtab.js.
  7. Vim: the syntax groups over test/samples/highlight.dtab match test/expected/highlight.txt byte by byte
     (that sample deliberately contains invalid keys, so it is not parsed), and plugin/dtab.vim sets the
     filetype when the repo is on 'runtimepath', which is what Vundle and vim-plug do.
  8. docs/index.html in headless Chrome (test/test_web.js), skipped with a message if puppeteer is not
     installed (`npm install --no-save puppeteer && npx puppeteer browsers install chrome`).
  9. The VS Code extension's TextMate grammar tokenizes the vim highlight sample the same way vim does
     (test/test_vscode.js), skipped if vscode-textmate is not installed
     (`npm install --no-save vscode-textmate vscode-oniguruma`).

Needs: python 3, node, vim.
"""

import doctest
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIGHLIGHT_SAMPLE = ROOT / "test" / "samples" / "highlight.dtab"
SAMPLES = sorted(path for path in (ROOT / "test" / "samples").glob("*.dtab") if path != HIGHLIGHT_SAMPLE)
DEVIATING = {"deviations.dtab", "game_config.dtab", "multiline.dtab"}  # multiline: $ blocks did not exist in the original
IDENTIFIER_PROBES = ["café", "变量", "x²", "_x", "0x", "from", "items", "a-b", "ok_1", "ª", "Ⅻ", "℘", "ℕ", "𝔸", "a.b", "é1", "1é"]

sys.path.insert(0, str(ROOT))
import dtab  # noqa: E402


def run(*command):
    """Query (runs a subprocess). The command's stdout."""
    return subprocess.run(command, capture_output=True, text=True, check=True, cwd=ROOT).stdout


def raises_value_error(function, *fragments):
    """Query (calls function). Asserts function() raises ValueError mentioning every fragment."""
    try:
        function()
    except ValueError as error:
        for fragment in fragments:
            assert fragment in str(error), "error %r does not mention %r" % (str(error), fragment)
        return
    raise AssertionError("expected a ValueError mentioning %r" % (fragments,))


def test_doctests():
    failed, _ = doctest.testmod(dtab)
    assert failed == 0, "dtab.py doctests failed"


def test_readers_agree():
    for path in SAMPLES:
        python_tree = dtab.parse(path.read_text())
        js_tree = json.loads(run("node", "dtab.js", str(path)))
        assert python_tree == js_tree, "%s: dtab.py and dtab.js disagree" % path.name
        if path.name in DEVIATING:
            golden = json.loads((ROOT / "test" / "expected" / (path.stem + ".json")).read_text())
            assert python_tree == golden, "%s: does not match golden" % path.name
        else:
            original = json.loads(run("node", "test/run_original.js", str(path)))
            assert python_tree == original, "%s: does not match the original djson.js" % path.name


def test_round_trips():
    for path in SAMPLES:
        once = dtab.parse(path.read_text())
        assert dtab.parse(dtab.stringify(once)) == once, "%s: did not round trip" % path.name


def test_key_rule():
    for text, fragments in [
        ("a\tcheckpoint.initial 1", ["line 1", "'checkpoint.initial'"]),
        ("ok 1\n\t2nd 2", ["line 2", "'2nd'"]),
        ("a-b 1", ["'a-b'"]),
        ("~scope\n\tx 1", ["'~scope'"]),
        ("log\t@ e", ["'@'"]),
        ("a,b.c\tx 1", ["'a,b.c'"]),
    ]:
        raises_value_error(lambda: dtab.parse(text), *fragments)
    assert dtab.parse("items 1\nfrom 2\n_private 3\ncafé 4") == {"items": "1", "from": "2", "_private": "3", "café": "4"}
    for tree in [{"a b": "1"}, {"a,b": "1"}, {0: "1"}, {"": "1"}]:
        raises_value_error(lambda: dtab.stringify(tree), "dtab")
    for value in ["x\ny", "x\ty", "a\n\n\tb\n  c", "#!/bin/bash\necho hi", ""]:
        assert dtab.parse(dtab.stringify({"a": value})) == {"a": value}, "multiline round trip failed for %r" % value
    python_verdicts = [probe.isidentifier() for probe in IDENTIFIER_PROBES]
    js_verdicts = json.loads(run(
        "node", "-e",
        "const d = require('./dtab.js'); console.log(JSON.stringify(%s.map(p => { try { d.parse(p + ' 1'); return true } catch { return false } })))"
        % json.dumps(IDENTIFIER_PROBES),
    ))
    assert python_verdicts == js_verdicts, "identifier rule differs: %s" % [
        (probe, py, js) for probe, py, js in zip(IDENTIFIER_PROBES, python_verdicts, js_verdicts) if py != js]


def test_js_suite():
    subprocess.run(["node", "test/test_dtab.js"], check=True, cwd=ROOT)


def vim(*commands):
    """Query (runs vim headless). Runs the -c commands in order in a clean vim and returns nothing."""
    arguments = ["vim", "-N", "-u", "NONE", "-i", "NONE", "-n", "-es", "-c", "set shortmess+=A"]  # -n, +=A: no swap files, no ATTENTION prompt
    for command in commands:
        arguments += ["-c", command]
    subprocess.run(arguments + ["-c", "qa!"], check=True, cwd=ROOT)


def test_vim_highlighting():
    with tempfile.TemporaryDirectory() as directory:
        out = Path(directory) / "highlights.txt"
        vim("syntax on", "source dtab.vim", "edit " + str(HIGHLIGHT_SAMPLE),
            "source test/dump_highlights.vim", "call DumpHighlights('%s')" % out)
        got = out.read_text()
    expected = (ROOT / "test" / "expected" / "highlight.txt").read_text()
    assert got == expected, "vim highlighting differs:\nexpected:\n%s\ngot:\n%s" % (expected, got)


def test_vim_embedded_languages():
    """A tagged $ block (at line start or after other entries) and a shebang block get the language's own groups."""
    with tempfile.TemporaryDirectory() as directory:
        sample = Path(directory) / "embedded.dtab"
        sample.write_text("$query sql\n\tSELECT name FROM t\nconfig\tdb\t$init sql\n\t\tCREATE TABLE t\n$s\n\t#!/bin/bash\n\techo hi\nafter 1\n")
        out = Path(directory) / "groups.txt"
        vim("syntax on", "source dtab.vim", "edit " + str(sample),
            "call writefile([synIDattr(synID(2,2,1),'name'), synIDattr(synID(3,12,1),'name'), synIDattr(synID(4,3,1),'name'), synIDattr(synID(7,2,1),'name'), synIDattr(synID(8,1,1),'name')], '%s')" % out)
        groups = out.read_text().split()
    assert groups == ["sqlStatement", "dtabBlockKey", "sqlStatement", "shStatement", "dtabLeafKey"], groups


def test_vim_plugin_shim():
    with tempfile.TemporaryDirectory() as directory:
        out = Path(directory) / "filetype.txt"
        vim("set rtp+=" + str(ROOT), "runtime! plugin/*.vim", "edit " + str(SAMPLES[0]),
            "call writefile([&filetype], '%s')" % out)
        assert out.read_text().strip() == "dtab", "plugin/dtab.vim did not set the filetype"


def test_web_demo():
    if not (ROOT / "node_modules" / "puppeteer").is_dir():
        print("    (skipped: puppeteer not installed)")
        return
    subprocess.run(["node", "test/test_web.js"], check=True, cwd=ROOT)


def test_vscode_grammar():
    if not (ROOT / "node_modules" / "vscode-textmate").is_dir():
        print("    (skipped: vscode-textmate not installed)")
        return
    subprocess.run(["node", "test/test_vscode.js"], check=True, cwd=ROOT)


if __name__ == "__main__":
    for test in [test_doctests, test_readers_agree, test_round_trips, test_key_rule, test_js_suite,
                 test_vim_highlighting, test_vim_embedded_languages, test_vim_plugin_shim, test_web_demo, test_vscode_grammar]:
        test()
        print("ok  " + test.__name__)
    print("All dtab tests passed")
