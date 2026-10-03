"""
dtab (Delta Tab): config files made of tab-separated paths. One line is one path into a tree,
and later lines are deltas on top of earlier ones.

    objects	l1,l2 light                ->  {"objects": {"l1": "light", "l2": "light"}}
    deltas	l1	position               ->  {"deltas": {"l1": {"position": {}}}}
    	x 1	y .5	z -2                 ->  continues inside position
    	 this entry starts with a space, so it is a comment
    query sql                             ->  {"query": "SELECT *\nFROM users"}: a multiline string, tagged sql for editors
    	SELECT *
    	FROM users

Rules:
  - Tabs indent, and separate the steps of a path (several in a row count as one, for alignment).
    An entry without a space is a key to step into.
  - An entry with a space is `key value`, split at the first space. It sets the key and stays put.
  - Deeper lines belong to the last non-comment entry: children for a container, text for a leaf.
  - Writing a string key again replaces its value; writing into a container merges. Changing its type is an error.
  - A lone comma key appends a fresh entry. Nonempty containers of only comma entries become lists, in order;
    named and comma keys cannot mix. Empty containers stay dictionaries; there is no distinct empty list.
  - `a,b` writes the same value under a and under b. After the comma, spaces, then tabs or line breaks, are
    skipped, so `a, b` and `a,` at the end of a line with `b` on the next are the same. What follows the comma
    must be a key: a comment there (a space after a tab or a line break), or nothing, is an error. A lone comma is not a continuation.
  - An entry starting with a space is a comment. Trailing tabs outside string bodies are ignored.
  - When the last non-comment entry is a leaf, deeper lines replace its value with a multiline string.
    The body starts one tab past the header line's leading tabs and is verbatim from there, tabs included
    (the only way to put a tab in a value). Earlier entries keep their values. The leaf's own text is a
    tag for editors, `sql` or `python` or `txt` or nothing, not part of the value.
  - Named keys are one or more letters, digits, or KEY_PUNCTUATION (`_.-/`), so `file.json`, `a/b` and `123aa` are keys. Keys that
    are also Python identifiers work as attributes (config.deltas.l1). Every leaf is a string.

One parsing pass, one stack, then linear list conversion. O(total characters).
"""

import json
import math
import re

__version__ = "0.5.8"  # SEMANTIC BINDING: dtab-version (also package.json "version")

KEY_SEPARATOR = ","  # a,b writes the same value under each key
TEXT_TAG = "txt"  # the tag stringify gives a multiline string; any single word is a tag, editors color the ones they know
KEY_PUNCTUATION = "_.-/"  # Allowed in keys besides letters and digits. SEMANTIC BINDING: dtab-key-punctuation
KEY_RULE = "keys may contain only letters, digits and " + " ".join(KEY_PUNCTUATION)
COMMA_RULE = "a comma needs a key on both sides; a comment does not count"
_TAB_RUN = re.compile(r"\t+")  # Several tabs in a row are one separator, so columns can be aligned
_KEY = re.compile(r"[\w" + re.escape(KEY_PUNCTUATION) + "]+")  # \w: letters, digits, _ (Unicode); the rest is reserved for syntax
_SPACED_KEYS = re.compile(r"(?:^|(?<=\t))(?:[^\t\n ,]+, *[\t\n]*)+")  # keys at an entry's start whose commas are followed by whitespace
_DANGLING = re.compile(r"(?:^|\t)[^\t ]+,\n*\Z")  # a key list ending in a comma: it goes on on the next line
_ENTRY = re.compile(r"( *)[^\t ][^\t]*")  # an entry: non-tab characters, not all spaces; group 1, its leading spaces, makes it a comment


def parse(text):
    """
    Pure function. Parses dtab into dicts, lists and string leaves. Rejects invalid keys, type changes
    and mixed named/anonymous keys. Errors identify the offending entry's source line.

    Args:
        text (str): dtab source. Whitespace-only lines are ignored outside multiline strings.

    Returns:
        dict or list

    Examples:
        >>> parse('objects\\tl1,l2 light\\ndeltas\\tl1\\tposition\\n\\tx 1\\ty .5\\tz -2')
        {'objects': {'l1': 'light', 'l2': 'light'}, 'deltas': {'l1': {'position': {'x': '1', 'y': '.5', 'z': '-2'}}}}
        >>> parse('a\\tb 1\\n\\t comment\\na\\tb 2')
        {'a': {'b': '2'}}
        >>> parse('query sql\\n\\tSELECT *\\n\\n\\t\\tFROM users\\n\\nnext 1')
        {'query': 'SELECT *\\n\\n\\tFROM users', 'next': '1'}
        >>> parse('table txt\\n\\tname\\tage\\n\\tryan\\t30\\nprompt \\n\\tLook here.')
        {'table': 'name\\tage\\nryan\\t30', 'prompt': 'Look here.'}
        >>> parse('dialect sql')
        {'dialect': 'sql'}
        >>> parse('A\\tB\\tcode py\\n\\tSome Code Here')
        {'A': {'B': {'code': 'Some Code Here'}}}
        >>> parse('A\\tB\\t\\n\\tcode py\\n\\t\\tSome Code Here')
        {'A': {'B': {'code': 'Some Code Here'}}}
        >>> parse('a\\tb 1\\nfile.json\\tsize 2\\n123aa 3')
        {'a': {'b': '1'}, 'file.json': {'size': '2'}, '123aa': '3'}
        >>> parse('a\\tb 1\\nc|d\\te 2')
        Traceback (most recent call last):
        ValueError: dtab line 2: invalid key 'c|d': keys may contain only letters, digits and _ . - /
        >>> parse('hello big world\\n\\tkey value')
        {'hello': 'key value'}
        >>> parse('hello world\\tmoose meat\\n\\tworld happy')
        {'hello': 'world', 'moose': 'world happy'}
        >>> parse('x, y 1\\nservers\\talpha,\\n\\tbeta,\\tgamma\\tport 80')
        {'x': '1', 'y': '1', 'servers': {'alpha': {'port': '80'}, 'beta': {'port': '80'}, 'gamma': {'port': '80'}}}
        >>> parse(',\\t, 1\\t, 2\\n,\\t, 3\\t, 4')
        [['1', '2'], ['3', '4']]
        >>> parse(',')
        [{}]
        >>> parse(', 1\\nkey 2')
        Traceback (most recent call last):
        ValueError: dtab line 2: cannot mix list entries and named keys
        >>> parse('a,\\n comment\\nb 1')
        Traceback (most recent call last):
        ValueError: dtab line 1: invalid key 'a,': a comma needs a key on both sides; a comment does not count
    """
    root = {}
    stack = [(-1, [root])]  # (indent, nodes that deeper lines nest into)
    block = None  # last entry is a leaf: (header indent, nodes, names, raw lines under it)
    numbered = enumerate(text.split("\n"), 1)
    for line_number, line in numbered:
        indent = len(line) - len(line.lstrip("\t"))
        if block is not None:
            if not line.strip() or indent > block[0]:
                block[3].append(line)
                continue
            _finish_block(block)
            block = None
        if not line.strip():
            continue
        line = _SPACED_KEYS.sub(_close_up, line)
        while _DANGLING.search(line) and (pulled := next(numbered, None)):  # the key list goes on on the next line
            line = _SPACED_KEYS.sub(_close_up, line + "\n" + pulled[1])
        while stack[-1][0] >= indent:
            stack.pop()
        nodes = stack[-1][1]
        for raw_entry in _TAB_RUN.split(line[indent:]):
            entry = raw_entry.replace("\n", "")
            entry_line = line_number
            line_number += len(raw_entry) - len(entry)
            key, space, value = entry.partition(" ")
            if not key:
                continue  # Comment or trailing tabs; neither changes the path
            names = [object()] if key == KEY_SEPARATOR else _key_names(key, entry_line, allow_commas=True)
            for node in nodes:
                if node and isinstance(next(iter(node)), str) != isinstance(names[0], str):
                    raise ValueError("dtab line %d: cannot mix list entries and named keys" % entry_line)
            if space:
                for node in nodes:
                    for name in names:
                        if isinstance(node.get(name), dict):
                            raise ValueError("dtab line %d: cannot replace a container with a string" % entry_line)
                        node[name] = value
                block = (indent, nodes, names, [])
            else:
                nodes = [_child(node, name, entry_line) for node in nodes for name in names]
                block = None
        stack.append((indent, nodes))
    if block is not None:
        _finish_block(block)
    return _resolve_lists(root)


def _resolve_lists(node):
    """
    Pure function. Converts validated anonymous-only dictionaries to lists.

    Args:
        node (dict or str): Validated subtree; anonymous keys are opaque objects, named keys are strings.

    Returns:
        dict, list or str; empty dictionaries remain dictionaries.

    Examples:
        >>> _resolve_lists({'items': {object(): 'red', object(): {}}})
        {'items': ['red', {}]}
        >>> _resolve_lists({'empty': {}})
        {'empty': {}}
    """
    if not isinstance(node, dict):
        return node
    values = [_resolve_lists(value) for value in node.values()]
    return values if node and not isinstance(next(iter(node)), str) else dict(zip(node, values))


def stringify(tree):
    """
    Pure function. Writes dicts and nonempty lists as dtab, one entry per line, tab-indented.
    Leaves use str(); newlines or tabs use multiline strings tagged TEXT_TAG. Raises ValueError on
    invalid keys or empty lists (use {} instead). parse(stringify(tree)) == tree when keys and leaves
    are strings and multiline values end in a nonblank line.

    Args:
        tree (dict or list): Nested containers with scalar leaves.

    Returns:
        str

    Examples:
        >>> stringify({'objects': {'l1': 'light'}, 'deltas': {'l1': {'x': 1, 'name': 'a b'}}}).split('\\n')
        ['objects', '\\tl1 light', 'deltas', '\\tl1', '\\t\\tx 1', '\\t\\tname a b']
        >>> stringify({'query': 'SELECT *\\nFROM t', 'table': 'a\\tb'}).split('\\n')
        ['query txt', '\\tSELECT *', '\\tFROM t', 'table txt', '\\ta\\tb']
        >>> stringify(['red', {}]).split('\\n')
        [', red', ',']
        >>> stringify([])
        Traceback (most recent call last):
        ValueError: dtab: empty lists have no representation; use {}
    """
    lines = []
    _stringify_into(tree, 0, lines)
    return "\n".join(lines)


def comment_toggle(lines, selections):
    """
    Pure function. What an editor's comment toggle does to its selections, the same in every dtab editor. The
    unit is the entry: a run of non-tab characters with something other than spaces in it, which is a comment
    when it starts with a space. A selection touches an entry when it covers some of its text after its
    leading spaces; a caret touches every entry of its line. The touched entries all lose one space when they
    all start with one; otherwise each gains one, so a comment already there becomes a double comment.
    Commenting then toggling the same selections gives the text back, however the editor moves them over the
    new spaces. Tabs, blank lines and runs of only spaces are never touched.

    Args:
        lines (list): The document's lines (str), without line breaks
        selections (list): (start_line, start_column, end_line, end_column) each: 0-based characters, the end
            column excluded (math.inf for the line's end); start and end equal for a caret

    Returns:
        tuple: (remove, at): whether to remove a space or insert one, and where, as the (line, column) of
        each touched entry's first character, in document order

    Examples:
        >>> comment_toggle(['a\\tb 1', '\\tc 2'], [(0, 0, 1, 4)])
        (False, [(0, 0), (0, 2), (1, 1)])
        >>> comment_toggle([' a\\t b 1', 'c 3'], [(0, 5, 0, 5)])  # a caret: its line
        (True, [(0, 0), (0, 3)])
        >>> comment_toggle(['a\\tb\\tc 1'], [(0, 2, 0, 3)])  # only b
        (False, [(0, 2)])
        >>> comment_toggle(['a\\tb 1', 'c 2'], [(0, 0, 1, 0)])  # ends before line 1
        (False, [(0, 0), (0, 2)])
        >>> comment_toggle(['a\\t\\t', ''], [(0, 1, 1, 0)])  # nothing but tabs
        (False, [])
    """
    touched = {}  # (line, column) -> whether the entry starts with a space
    for start_line, start_column, end_line, end_column in selections:
        caret = (start_line, start_column) == (end_line, end_column)
        for line in range(start_line, end_line + 1):
            start = 0 if caret or line > start_line else start_column
            end = math.inf if caret or line < end_line else end_column
            for entry in _ENTRY.finditer(lines[line]):
                if entry.start() + len(entry.group(1)) < end and start < entry.end():
                    touched[(line, entry.start())] = bool(entry.group(1))
    at = sorted(touched)
    return bool(at) and all(touched.values()), at


def toggle_comments(lines, selections):
    """
    Pure function. The lines after an editor's comment toggle (comment_toggle) with the given selections.

    Args:
        lines (list): The document's lines (str)
        selections (list): As for comment_toggle

    Returns:
        list

    Examples:
        >>> toggle_comments(['a\\tb 1', '\\tc 2'], [(0, 0, 1, 4)])
        [' a\\t b 1', '\\t c 2']
        >>> toggle_comments([' a\\t b 1', '\\t c 2'], [(0, 0, 1, 5)])
        ['a\\tb 1', '\\tc 2']
        >>> toggle_comments(['x 1\\t note'], [(0, 0, 0, 0)])  # the comment there becomes a double comment
        [' x 1\\t  note']
        >>> toggle_comments(['a\\tb\\tc 1'], [(0, 2, 0, 3)])
        ['a\\t b\\tc 1']
    """
    remove, at = comment_toggle(lines, selections)
    result = list(lines)
    for line, column in reversed(at):
        result[line] = result[line][:column] + ("" if remove else " ") + result[line][column + 1 if remove else column:]
    return result


def _close_up(match):
    """
    Pure function. Removes key-list spacing, retaining newlines for source-line diagnostics.

    Args:
        match (re.Match): A key-list match from _SPACED_KEYS.

    Returns:
        str

    Examples:
        >>> _close_up(_SPACED_KEYS.search('a, b,\\n\\t'))
        'a,b,\\n'
    """
    return "\n".join("".join(line.split()) for line in match.group().split("\n"))


def _key_names(key, line_number, allow_commas):
    """
    Pure function (raises ValueError). The names a key stands for: `a,b` is two while parsing, and a
    stringify key must be a single name.

    Examples:
        >>> _key_names('l1,l2', 1, True), _key_names('file-thing.json', None, False)
        (['l1', 'l2'], ['file-thing.json'])
        >>> _key_names('a,b', None, False)
        Traceback (most recent call last):
        ValueError: dtab: invalid key 'a,b': keys may contain only letters, digits and _ . - /
        >>> _key_names('a,,b', 3, True)
        Traceback (most recent call last):
        ValueError: dtab line 3: invalid key 'a,,b': a comma needs a key on both sides; a comment does not count
    """
    names = key.split(KEY_SEPARATOR) if allow_commas else [key]
    for name in names:
        if not _KEY.fullmatch(name):
            where = " line %d" % line_number if line_number else ""
            raise ValueError("dtab%s: invalid key %r: %s" % (where, key, COMMA_RULE if allow_commas and not name else KEY_RULE))
    return names


def _child(node, name, line_number):
    """
    Command. Creates a missing child dictionary; rejects replacing a string with a container.

    Args:
        node (dict): Parent to mutate.
        name (str or object): Named or anonymous key.
        line_number (int): Source line for errors.

    Returns:
        dict: Child container.

    Examples:
        >>> n = {}; _child(n, 'a', 1)['x'] = '1'; n
        {'a': {'x': '1'}}
        >>> _child({'a': 'leaf'}, 'a', 2)
        Traceback (most recent call last):
        ValueError: dtab line 2: cannot replace a string with a container
    """
    if name not in node:
        node[name] = {}
    elif not isinstance(node[name], dict):
        raise ValueError("dtab line %d: cannot replace a string with a container" % line_number)
    return node[name]


def _finish_block(block):
    """
    Command (mutates the block's nodes). The lines under a leaf, trailing blank lines dropped, become the
    key's value: each loses the one tab that puts it under the key's line and is verbatim from there, so
    tabs and deeper indentation inside code survive. With no lines, the key keeps the leaf's own text.

    Examples:
        >>> nodes = [{'q': 'sql'}]; _finish_block((0, nodes, ['q'], ['\\tSELECT *', '', '\\t\\tFROM t', '', ''])); nodes
        [{'q': 'SELECT *\\n\\n\\tFROM t'}]
        >>> nodes = [{'q': 'sql'}]; _finish_block((0, nodes, ['q'], ['', ''])); nodes
        [{'q': 'sql'}]
    """
    indent, nodes, names, deep = block
    while deep and not deep[-1].strip():
        deep.pop()
    if not deep:
        return
    base = "\t" * (indent + 1)
    value = "\n".join(line[len(base):] if line.startswith(base) else "" for line in deep)
    for node in nodes:
        for name in names:
            node[name] = value


def _stringify_into(node, depth, lines):
    """
    Command. Appends one dtab entry per child, indented by depth tabs.

    Args:
        node (dict or list): Container to serialize.
        depth (int): Indentation level.
        lines (list): Destination, modified in place.

    Examples:
        >>> lines = []; _stringify_into(['red'], 0, lines); lines
        [', red']
    """
    if isinstance(node, list) and not node:
        raise ValueError("dtab: empty lists have no representation; use {}")
    entries = ((KEY_SEPARATOR, value) for value in node) if isinstance(node, list) else node.items()
    for key, value in entries:
        if not isinstance(node, list):
            [key] = _key_names(str(key), None, allow_commas=False)
        indent = "\t" * depth
        if isinstance(value, (dict, list)):
            lines.append(indent + key)
            _stringify_into(value, depth + 1, lines)
        else:
            value = str(value)
            if "\n" in value or "\t" in value:  # a multiline string holds any text; a one-line value cannot hold a tab
                lines.append(indent + key + " " + TEXT_TAG)
                lines.extend(indent + "\t" + part for part in value.split("\n"))
            else:
                lines.append(indent + key + " " + value)


def _cli(path):
    """Command (reads a file). Parses a dtab file and returns it as a JSON string."""
    with open(path) as file:
        return json.dumps(parse(file.read()), indent=4)


def _main():
    """Command. Console entry point: dtab FILE prints the tree as JSON."""
    import fire

    fire.Fire(_cli)


if __name__ == "__main__":
    _main()
