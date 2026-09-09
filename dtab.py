"""
dtab (Delta Tab): config files made of tab-separated paths. One line is one path into a tree,
and later lines are deltas on top of earlier ones.

    objects	l1,l2 light                ->  {"objects": {"l1": "light", "l2": "light"}}
    deltas	l1	position	x 1	y .5     ->  {"deltas": {"l1": {"position": {"x": "1", "y": ".5"}}}}
    	z -2                              ->  continues the path of the line above
    	 this entry starts with a space, so it is a comment
    query sql                             ->  {"query": "SELECT *\nFROM users"}: a multiline string, tagged sql for editors
    	SELECT *
    	FROM users

Rules:
  - Tabs indent, and separate the steps of a path (several in a row count as one, for alignment).
    An entry without a space is a key to step into.
  - An entry with a space is `key value`, split at the first space. It sets the key and stays put.
  - An indented line continues the path of the line above it.
  - Writing a key again replaces it; writing into an object merges. Last line wins.
  - `a,b` writes the same value under a and under b.
  - An entry starting with a space is a comment. A trailing tab is an empty key that swallows the lines under it.
  - A `key word` line with lines indented under it is a multiline string: the word is a language tag for
    editors (empty, or `txt`, for plain text) and the value is those lines, one tab deeper than the key's line
    and verbatim from there, tabs included. The only way to put a tab in a value.
  - A line indented under any other leaf line (a value with spaces, or several leaves) is an error.
  - Keys are one or more letters, digits, or KEY_PUNCTUATION (`_.-/`), so `file.json`, `a/b` and `123aa` are keys. Keys that
    are also Python identifiers work as attributes (config.deltas.l1). Every value is a string.

Single pass, one stack, O(total characters).
"""

import json
import re

__version__ = "0.4.0"  # SEMANTIC BINDING: dtab-version (also package.json "version")

KEY_SEPARATOR = ","  # a,b writes the same value under each key
TEXT_TAG = "txt"  # the tag stringify gives a multiline string; any single word is a tag, editors color the ones they know
KEY_PUNCTUATION = "_.-/"  # Allowed in keys besides letters and digits. SEMANTIC BINDING: dtab-key-punctuation
KEY_RULE = "keys may contain only letters, digits and " + " ".join(KEY_PUNCTUATION)
_TAB_RUN = re.compile(r"\t+")  # Several tabs in a row are one separator, so columns can be aligned
_KEY = re.compile(r"[\w" + re.escape(KEY_PUNCTUATION) + "]+")  # \w: letters, digits, _ (Unicode); the rest is reserved for syntax


def parse(text):
    """
    Pure function. Parses dtab text into nested dicts of strings. Raises ValueError, with the line
    number, on a key that breaks KEY_RULE or on a line indented under a leaf that is not a multiline
    string's header.

    Args:
        text (str): dtab source. Whitespace-only lines are ignored outside multiline strings.

    Returns:
        dict

    Examples:
        >>> parse('objects\\tl1,l2 light\\ndeltas\\tl1\\tposition\\tx 1\\ty .5\\n\\tz -2')
        {'objects': {'l1': 'light', 'l2': 'light'}, 'deltas': {'l1': {'position': {'x': '1', 'y': '.5', 'z': '-2'}}}}
        >>> parse('a\\tb 1\\n\\t comment\\na\\tb 2')
        {'a': {'b': '2'}}
        >>> parse('query sql\\n\\tSELECT *\\n\\n\\t\\tFROM users\\n\\nnext 1')
        {'query': 'SELECT *\\n\\n\\tFROM users', 'next': '1'}
        >>> parse('table txt\\n\\tname\\tage\\n\\tryan\\t30\\nprompt \\n\\tLook here.')
        {'table': 'name\\tage\\nryan\\t30', 'prompt': 'Look here.'}
        >>> parse('dialect sql')
        {'dialect': 'sql'}
        >>> parse('a\\tb 1\\nfile.json\\tsize 2\\n123aa 3')
        {'a': {'b': '1'}, 'file.json': {'size': '2'}, '123aa': '3'}
        >>> parse('a\\tb 1\\nc|d\\te 2')
        Traceback (most recent call last):
        ValueError: dtab line 2: invalid key 'c|d': keys may contain only letters, digits and _ . - /
        >>> parse('hello big world\\n\\tkey value')
        Traceback (most recent call last):
        ValueError: dtab line 2: indented under a value; a multiline string starts with `key word`
    """
    root = {}
    stack = [(-1, [root], False)]  # (indent, nodes that deeper lines nest into, whether the line is only leaves)
    block = None  # after a `key word` line: (its indent, nodes, names, raw lines under it)
    for line_number, line in enumerate(text.split("\n"), 1):
        indent = len(line) - len(line.lstrip("\t"))
        if block is not None:
            if not line.strip() or indent > block[0]:
                block[3].append(line)
                continue
            _finish_block(block)
            block = None
        if not line.strip():
            continue
        while stack[-1][0] >= indent:
            stack.pop()
        if stack[-1][2]:
            raise ValueError("dtab line %d: indented under a value; a multiline string starts with `key word`" % line_number)
        nodes = stack[-1][1]
        leaves = []  # (names, value) of the line's leaves; a header is a line of exactly one, with a one-word value
        steps_in = False
        for entry in _TAB_RUN.split(line[indent:]):
            key, space, value = entry.partition(" ")
            if not key:
                if not space:
                    nodes = [{}]  # Empty key (trailing tab): everything under it is discarded
                    steps_in = True
                continue
            names = _key_names(key, line_number, allow_commas=True)
            if space:
                for node in nodes:
                    for name in names:
                        node[name] = value
                leaves.append((names, value))
            else:
                nodes = [_child(node, name) for node in nodes for name in names]
                steps_in = True
        only_leaves = bool(leaves) and not steps_in
        stack.append((indent, nodes, only_leaves))
        if only_leaves and len(leaves) == 1 and " " not in leaves[0][1]:
            block = (indent, nodes, leaves[0][0], [])
    if block is not None:
        _finish_block(block)
    return root


def stringify(tree):
    """
    Pure function. Writes nested dicts as dtab, one key per line, tab-indented. Leaves are written
    with str(); a leaf containing a newline or a tab is written as a multiline string tagged TEXT_TAG.
    Raises ValueError on a key that breaks KEY_RULE. parse(stringify(tree)) == tree when every leaf is a
    str without trailing newlines.

    Args:
        tree (dict): Nested dicts

    Returns:
        str

    Examples:
        >>> stringify({'objects': {'l1': 'light'}, 'deltas': {'l1': {'x': 1, 'name': 'a b'}}}).split('\\n')
        ['objects', '\\tl1 light', 'deltas', '\\tl1', '\\t\\tx 1', '\\t\\tname a b']
        >>> stringify({'query': 'SELECT *\\nFROM t', 'table': 'a\\tb'}).split('\\n')
        ['query txt', '\\tSELECT *', '\\tFROM t', 'table txt', '\\ta\\tb']
    """
    lines = []
    _stringify_into(tree, 0, lines)
    return "\n".join(lines)


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
    """
    names = key.split(KEY_SEPARATOR) if allow_commas else [key]
    for name in names:
        if not _KEY.fullmatch(name):
            where = " line %d" % line_number if line_number else ""
            raise ValueError("dtab%s: invalid key %r: %s" % (where, key, KEY_RULE))
    return names


def _child(node, name):
    """
    Command (may mutate node). node[name] as a dict to step into, replacing a string value if there is one.

    Examples:
        >>> n = {'a': 'leaf'}; _child(n, 'a')['x'] = '1'; _child(n, 'b') is n['b']; n
        True
        {'a': {'x': '1'}, 'b': {}}
    """
    child = node.get(name)
    if not isinstance(child, dict):
        child = node[name] = {}
    return child


def _finish_block(block):
    """
    Command (mutates the block's nodes). The lines under a `key word` line, trailing blank lines dropped,
    become the key's value: each loses the one tab that puts it under the key's line and is verbatim from
    there, so tabs and deeper indentation inside code survive. With no lines, the key keeps the word.

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
    """Command (appends to lines). One dtab line per key of node, indented by depth tabs."""
    for key, value in node.items():
        [key] = _key_names(str(key), None, allow_commas=False)
        indent = "\t" * depth
        if isinstance(value, dict):
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
