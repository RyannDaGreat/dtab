"""
dtab (Delta Tab): config files made of tab-separated paths. One line is one path into a tree,
and later lines are deltas on top of earlier ones.

    objects	l1,l2 light                ->  {"objects": {"l1": "light", "l2": "light"}}
    deltas	l1	position	x 1	y .5     ->  {"deltas": {"l1": {"position": {"x": "1", "y": ".5"}}}}
    	z -2                              ->  continues the path of the line above
    	 this entry starts with a space, so it is a comment

Rules:
  - Tabs indent, and separate the steps of a path (several in a row count as one, for alignment).
    An entry without a space is a key to step into.
  - An entry with a space is `key value`, split at the first space. It sets the key and stays put.
  - An indented line continues the path of the line above it.
  - Writing a key again replaces it; writing into an object merges. Last line wins.
  - `a,b` writes the same value under a and under b.
  - An entry starting with a space is a comment. A trailing tab is an empty key that swallows the lines under it.
  - Keys are identifiers (str.isidentifier), so trees are EasyDict-friendly. Every value is a string.

Single pass, one stack, O(total characters).
"""

import json
import re

__version__ = "0.1.0"  # SEMANTIC BINDING: dtab-version (also package.json "version")

KEY_SEPARATOR = ","  # a,b writes the same value under each key
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
        >>> parse('a\\tb 1\\nc.d\\te 2')
        Traceback (most recent call last):
        ValueError: dtab line 2: invalid key 'c.d': keys must be identifiers (letters, digits, underscores, not starting with a digit)
    """
    root = {}
    stack = [(-1, [root])]  # (indent, nodes that deeper lines nest into)
    for line_number, line in enumerate(text.split("\n"), 1):
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip("\t"))
        while stack[-1][0] >= indent:
            stack.pop()
        nodes = stack[-1][1]
        for entry in _TAB_RUN.split(line[indent:]):
            key, space, value = entry.partition(" ")
            if not key:
                if not space:
                    nodes = [{}]  # Empty key (trailing tab): everything under it is discarded
                continue
            names = _key_names(key, line_number, allow_commas=True)
            if space:
                for node in nodes:
                    for name in names:
                        node[name] = value
            else:
                nodes = [_child(node, name) for node in nodes for name in names]
        stack.append((indent, nodes))
    return root


def stringify(tree):
    """
    Pure function. Writes nested dicts as dtab, one key per line, tab-indented. Leaves are written
    with str(). Raises ValueError on a key that breaks KEY_RULE or a leaf containing a tab or newline,
    which dtab cannot represent. parse(stringify(tree)) == tree when every leaf is a str.

    Args:
        tree (dict): Nested dicts

    Returns:
        str

    Examples:
        >>> stringify({'objects': {'l1': 'light'}, 'deltas': {'l1': {'x': 1, 'name': 'a b'}}}).split('\\n')
        ['objects', '\\tl1 light', 'deltas', '\\tl1', '\\t\\tx 1', '\\t\\tname a b']
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
            if "\t" in value or "\n" in value:
                raise ValueError("dtab: value of %r contains a tab or newline, which dtab cannot represent: %r" % (key, value))
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
