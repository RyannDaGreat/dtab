"""
dtab (Delta Tab): config files made of tab-separated paths. One line is one path into a tree,
and later lines are deltas on top of earlier ones.

    objects	l1,l2 light                ->  {"objects": {"l1": "light", "l2": "light"}}
    deltas	l1	position	x 1	y .5     ->  {"deltas": {"l1": {"position": {"x": "1", "y": ".5"}}}}
    	z -2                              ->  continues the path of the line above
    	 this entry starts with a space, so it is a comment
    $query sql                            ->  {"query": "SELECT *\nFROM users"}: a multiline value, tagged sql for editors
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
  - `$key` is a multiline leaf: its value is the entries after it on its line plus every line indented
    under it, one line each, with their common indentation removed. A word after the key on the `$` line
    (`$query sql`) is a language tag for editors and is not part of the value.
  - Keys are identifiers (str.isidentifier), so trees are EasyDict-friendly. Every value is a string.

Single pass, one stack, O(total characters).
"""

import json
import re

__version__ = "0.2.0"  # SEMANTIC BINDING: dtab-version (also package.json "version")

KEY_SEPARATOR = ","  # a,b writes the same value under each key
BLOCK_PREFIX = "$"  # $key: a leaf whose value is the lines under it ($ as in string)
KEY_RULE = "keys must be identifiers (letters, digits, underscores, not starting with a digit)"
_TAB_RUN = re.compile(r"\t+")  # Several tabs in a row are one separator, so columns can be aligned


def parse(text):
    """
    Pure function. Parses dtab text into nested dicts of strings. Raises ValueError, with the line
    number, on a key that breaks KEY_RULE.

    Args:
        text (str): dtab source. Whitespace-only lines are ignored.

    Returns:
        dict

    Examples:
        >>> parse('objects\\tl1,l2 light\\ndeltas\\tl1\\tposition\\tx 1\\ty .5\\n\\tz -2')
        {'objects': {'l1': 'light', 'l2': 'light'}, 'deltas': {'l1': {'position': {'x': '1', 'y': '.5', 'z': '-2'}}}}
        >>> parse('a\\tb 1\\n\\t comment\\na\\tb 2')
        {'a': {'b': '2'}}
        >>> parse('$query sql\\n\\tSELECT *\\n\\n\\t\\tFROM users\\n\\nnext 1')
        {'query': 'SELECT *\\n\\n\\tFROM users', 'next': '1'}
        >>> parse('$cmd\\tpip install rp\\tpython train.py')
        {'cmd': 'pip install rp\\npython train.py'}
        >>> parse('a\\tb 1\\nc.d\\te 2')
        Traceback (most recent call last):
        ValueError: dtab line 2: invalid key 'c.d': keys must be identifiers (letters, digits, underscores, not starting with a digit)
    """
    root = {}
    stack = [(-1, [root])]  # (indent, nodes that deeper lines nest into)
    block = None  # while inside a $ block: (indent of the $ line, nodes, names, first lines, raw deeper lines)
    for line_number, line in enumerate(text.split("\n"), 1):
        indent = len(line) - len(line.lstrip("\t"))
        if block is not None:
            if not line.strip() or indent > block[0]:
                block[4].append(line)
                continue
            _finish_block(block)
            block = None
        if not line.strip():
            continue
        while stack[-1][0] >= indent:
            stack.pop()
        nodes = stack[-1][1]
        entries = _TAB_RUN.split(line[indent:])
        for position, entry in enumerate(entries):
            key, space, value = entry.partition(" ")
            if not key:
                if not space:
                    nodes = [{}]  # Empty key (trailing tab): everything under it is discarded
                continue
            if key.startswith(BLOCK_PREFIX):
                names = _key_names(key[len(BLOCK_PREFIX):], line_number, allow_commas=True)
                block = (indent, nodes, names, entries[position + 1:], [])  # rest of the $ line, then deeper lines (raw)
                break
            names = _key_names(key, line_number, allow_commas=True)
            if space:
                for node in nodes:
                    for name in names:
                        node[name] = value
            else:
                nodes = [_child(node, name) for node in nodes for name in names]
        stack.append((indent, nodes))
    if block is not None:
        _finish_block(block)
    return root


def stringify(tree):
    """
    Pure function. Writes nested dicts as dtab, one key per line, tab-indented. Leaves are written
    with str(); a leaf containing a newline or a tab is written as a $ block. Raises ValueError on a key
    that breaks KEY_RULE. parse(stringify(tree)) == tree when every leaf is a str without trailing newlines.

    Args:
        tree (dict): Nested dicts

    Returns:
        str

    Examples:
        >>> stringify({'objects': {'l1': 'light'}, 'deltas': {'l1': {'x': 1, 'name': 'a b'}}}).split('\\n')
        ['objects', '\\tl1 light', 'deltas', '\\tl1', '\\t\\tx 1', '\\t\\tname a b']
        >>> stringify({'query': 'SELECT *\\nFROM t'}).split('\\n')
        ['$query', '\\tSELECT *', '\\tFROM t']
    """
    lines = []
    _stringify_into(tree, 0, lines)
    return "\n".join(lines)


def _key_names(key, line_number, allow_commas):
    """
    Pure function (raises ValueError). The identifiers a key stands for: `a,b` is two while parsing,
    and a stringify key must be a single bare identifier.

    Examples:
        >>> _key_names('l1,l2', 1, True), _key_names('table_bottom', None, False)
        (['l1', 'l2'], ['table_bottom'])
        >>> _key_names('a,b', None, False)
        Traceback (most recent call last):
        ValueError: dtab: invalid key 'a,b': keys must be identifiers (letters, digits, underscores, not starting with a digit)
    """
    names = key.split(KEY_SEPARATOR) if allow_commas else [key]
    for name in names:
        if not name.isidentifier():
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
    Command (mutates the block's nodes). Joins a $ block into its value: the first lines from the $ line
    itself, then the deeper lines with their common indentation removed (so relative indentation inside
    code survives), trailing blank lines dropped. Written under every name the $ key stands for.

    Examples:
        >>> nodes = [{}]; _finish_block((0, nodes, ['q'], [], ['\\t\\tSELECT *', '', '\\t\\t\\tFROM t', '', ''])); nodes
        [{'q': 'SELECT *\\n\\n\\tFROM t'}]
        >>> nodes = [{}]; _finish_block((0, nodes, ['c'], ['pip install rp'], ['\\techo done'])); nodes
        [{'c': 'pip install rp\\necho done'}]
    """
    _, nodes, names, head, deep = block
    while deep and not deep[-1].strip():
        deep.pop()
    common = min((len(line) - len(line.lstrip("\t")) for line in deep if line.strip()), default=0)
    lines = head + [line[common:] if line.strip() else "" for line in deep]
    while lines and not lines[-1].strip():
        lines.pop()
    value = "\n".join(lines)
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
            if "\n" in value or "\t" in value:  # a $ block holds any text; a one-line value cannot hold a tab
                lines.append(indent + BLOCK_PREFIX + key)
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
