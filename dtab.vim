" dtab syntax highlighting for Vim.
" Installed as a plugin (plugin/dtab.vim sources this file), or paste this whole block into your vimrc
" after `syntax on`.
"
" Object keys purple, leaf keys cyan, leaf values blue, comments (entries starting with a space) as
" Comment. Errors: characters a key may not contain (letters, digits, _ . - / only), and a comma with no
" key on one side, except a lone comma: an anonymous list entry. Trailing tabs are harmless separators.
" A leaf with lines indented under it is a multiline string: the key yellow, the leaf's text (a tag for
" editors) orange, and the lines colored as text, or by the tagged language's own syntax file (sql, python,
" bash, ...), or by a shebang. A language item running past a line's end leaves the next line's tabs, dtab's
" indentation, in the string's color.
"
" A dtab line is tab-indented, with entries separated by tabs:
"     deltas	l1,l2	position	x 1	y .5	 inline comment
"     object keys ............... leaf  leaf  comment
" After a comma in a key, spaces, then tabs or line breaks, are skipped, so `l1, l2` and `l1,` at the end of a
" line with `l2` on the next are `l1,l2`; such a key list is colored line by line (s:DtabSyntax).
augroup dtab
    autocmd!
    autocmd BufRead,BufNewFile *.dtab setfiletype dtab
    autocmd FileType dtab setlocal noexpandtab tabstop=4 shiftwidth=4 softtabstop=0 commentstring=\ %s
    autocmd FileType dtab setlocal iskeyword=@,48-57,_,192-255
    autocmd FileType dtab inoremap <buffer> <expr> <Tab> <SID>Tab()
    " >> << (with counts), the > < operators, and visual > <: spaces inside a multiline string, a tab elsewhere
    autocmd FileType dtab nnoremap <buffer> >> :<C-U>call <SID>ShiftLines(line('.'), line('.') + v:count1 - 1, 1)<CR>
    autocmd FileType dtab nnoremap <buffer> << :<C-U>call <SID>ShiftLines(line('.'), line('.') + v:count1 - 1, -1)<CR>
    autocmd FileType dtab nnoremap <buffer> <expr> > <SID>Operator('IndentOperator')
    autocmd FileType dtab nnoremap <buffer> <expr> < <SID>Operator('OutdentOperator')
    autocmd FileType dtab xnoremap <buffer> > :<C-U>call <SID>ShiftLines(line("'<"), line("'>"), 1)<CR>
    autocmd FileType dtab xnoremap <buffer> < :<C-U>call <SID>ShiftLines(line("'<"), line("'>"), -1)<CR>
    " J joins the line below with a tab (deep form to wide form) when the tree stays the same; inside a multiline
    " string it is vim's own J. A count or a visual range joins pairwise from the top.
    autocmd FileType dtab nnoremap <buffer> J :<C-U>call <SID>Join(line('.'), line('.') + max([v:count1 - 1, 1]))<CR>
    autocmd FileType dtab xnoremap <buffer> J :<C-U>call <SID>Join(line("'<"), max([line("'>"), line("'<") + 1]))<CR>
    " gc{motion}, gcc (with a count) and visual gc (also part of a line, or a block) toggle comments on the
    " entries they touch, the same as in the other dtab editors (s:CommentToggle); . repeats gc and gcc.
    " :DtabComment does whole lines. Buffer-local, so they win over tcomment's or commentary's gc.
    autocmd FileType dtab nnoremap <buffer> <expr> gc <SID>Operator('CommentOperator')
    autocmd FileType dtab nnoremap <buffer> <expr> gcc <SID>Operator('CommentOperator') . '_'
    autocmd FileType dtab xnoremap <buffer> gc :<C-U>call <SID>CommentRegion(getpos("'<"), getpos("'>"), visualmode())<CR>
    autocmd FileType dtab command! -buffer -range -bar DtabComment call <SID>ToggleComments([[<line1>, 0, <line2>, v:maxcol]])
    " :DtabPreview toggles a split showing the tree as JSON, which follows every edit
    autocmd FileType dtab command! -buffer -bar DtabPreview call <SID>TogglePreview()
    autocmd FileType dtab autocmd TextChanged,TextChangedI <buffer> call <SID>RenderPreview()
    autocmd Syntax dtab call s:DtabSyntax()
    autocmd ColorScheme * if &filetype ==# 'dtab' | call s:DtabHighlight() | endif
    autocmd TextChanged,InsertLeave * if &filetype ==# 'dtab' | call s:IncludeNewLanguages() | endif
augroup END

" File icon for NERDTree, airline etc. via vim-devicons: a delta. Only takes effect if devicons is loaded.
let g:WebDevIconsUnicodeDecorateFileNodesExtensionSymbols = get(g:, 'WebDevIconsUnicodeDecorateFileNodesExtensionSymbols', {})
let g:WebDevIconsUnicodeDecorateFileNodesExtensionSymbols['dtab'] = 'Δ'

function! s:DtabSyntax() abort
    " Command. Defines syntax highlighting for the buffer.
    " An entry is a run of non-tab characters bounded by tabs or the line's ends, except that a key's comma
    " may be followed by whitespace (s:keys). No space in the entry: object key. Space in the entry: leaf
    " `key value`. Leading space: comment.
    " No match runs past its line's end. Vim does not save its parse state at the start of a line that a match
    " runs into, and in refusing it frees the saved state before it (store_current_state in vim's syntax.c), so
    " a key list going on over a few dozen lines once freed every state back to the file's start, and each
    " scroll up parsed from line 1. A key list that goes on to the next line (it ends its line in a comma) is
    " colored to its line's end, its kind read by a lookahead through the whole list (s:keys or s:closed_keys
    " spanning lines); each later line of it is a continuation item of the same group (below), which nextgroup
    " with skipnl and skipempty carries over the line break in vim's saved state. Each group's dangling item is
    " defined after its one-line item, so it wins where both match, as the longest list did in a single match.
    let l:entry = '\%(^\t*\|\t\)\zs'
    execute 'syntax match dtabObjectKey   /' . l:entry . s:line_keys . '\ze\%(\t\|$\)/ contains=@dtabKeyParts'
    execute 'syntax match dtabObjectKey   /' . l:entry . '\%(' . s:dangling_keys . '\n[\t\n]*' . s:keys . '\%(\t\|$\)\)\@=.*/'
        \ . ' contains=@dtabKeyParts nextgroup=dtabObjectKey skipnl skipempty'
    execute 'syntax match dtabLeaf        /' . l:entry . s:line_closed_keys . ' [^\t]*/ contains=dtabLeafKey,dtabLeafValue'
    execute 'syntax match dtabLeaf        /' . l:entry . '\%(' . s:dangling_keys . '\n[\t\n]*' . s:closed_keys . ' \)\@=.*/'
        \ . ' contains=dtabLeafKey,dtabLeafValue nextgroup=dtabLeaf skipnl skipempty'
    " A leaf's key: up to the space before the value, from a continuation line's start when the list began on
    " an earlier line (its tabs are the list's); or a whole line of a list going on, which starts at the
    " leaf's start (after a tab, or at the line's start) or at a continuation line's start.
    execute 'syntax match dtabLeafKey     /\%(^\t\+\)\=' . s:line_closed_keys . '\ze / contained contains=@dtabKeyParts'
    execute 'syntax match dtabLeafKey     /\%(\t\@1<=\|^\t*\)' . s:dangling_keys . '$\|^\t\+$/ contained contains=@dtabKeyParts'
    syntax match dtabLeafValue   / \zs[^\t]*/                                 contained
    syntax match dtabComment     /\%(^\t*\|\t\)\zs [^\t]*/
    " A comma needs a key on both sides: the one before it right there, the one after it past the whitespace
    " it allows. Any other comma is an error (dtabComma is defined last, so it wins where both match).
    " dtabComma's lookbehind is bounded to 4 bytes, one character: unbounded, vim would try it from every
    " earlier column of the line.
    syntax match dtabBadComma    /,/                                                    contained
    syntax match dtabComma       /[^\t\n ,]\@4<=,\ze *[\t\n]*[^\t\n ,]/                 contained
    syntax match dtabListObjectKey /\%(^\|\t\)\@1<=,\ze\%([ \t]\|$\)/ contained containedin=dtabObjectKey
    syntax match dtabListLeafKey   /\%(^\|\t\)\@1<=,\ze\%([ \t]\|$\)/ contained containedin=dtabLeafKey,dtabBlockKey
    " A character outside the key bag: keyword characters (letters incl. multibyte, digits, _),
    " s:key_punctuation, the , that separates keys and the whitespace a comma allows
    execute 'syntax match dtabBadKey /\%(\k\|[,' . escape(s:key_punctuation, ']^-\/') . ' \t\n]\)\@!./ contained'
    syntax cluster dtabKeyParts contains=dtabBadComma,dtabComma,dtabBadKey

    " The last non-comment leaf opens a multiline string when the next non-blank line is deeper. Its key is
    " read from the line's start (s:from_line_start): the earlier entries (already colored), the key, then
    " comments to the line's end and a deeper line (\1 is the header's tabs). Defined after entries so the
    " key wins. nextgroup lets only that key start the string, which reads the line again to capture its
    " tabs (\z1) and covers deeper or blank lines: its start is the tag, then come the header's comments and
    " trailing tabs, and from the next line the text, a region of its own that ends with the string
    " (keepend), so no header comment is found in the text. A header split over lines is seen when the
    " line of its tag keeps its first line's tabs, which are the tag line's for \1 and \z1 alike.
    let l:header_end = ' [^\t]*\%(\t\+ [^\t]*\)*\t*\n\%(\s*\n\)*\1\t'
    execute 'syntax match  dtabBlockKey /^\(\t*\)' . s:header_prefix . '\zs' . s:line_closed_keys . '\ze' . l:header_end . '/' . s:from_line_start . ' contains=@dtabKeyParts nextgroup=dtabString'
    execute 'syntax match  dtabBlockKey /^\(\t*\)' . s:header_prefix . '\zs\%(' . s:dangling_keys . '\n[\t\n]*' . s:closed_keys . l:header_end . '\)\@=.*/' . s:from_line_start
        \ . ' contains=@dtabKeyParts nextgroup=dtabBlockKey skipnl skipempty'
    " Continuations, reached only by nextgroup at a line's start: the lines after a key list's line that ends in a
    " comma. Their leading tabs are the list's, and so is a line of only tabs. An object key list goes on while a
    " list follows that ends before a tab or at a line's end (the end of a line ending in a comma, too); a leaf's
    " or a header's list was read to its end by its first line's lookahead. Defined after the first-line items of
    " the same group, which nextgroup also tries, so these win at the line's start.
    let l:list_goes_on = '\t*\%(' . s:dangling_keys . '\)\=\n[\t\n]*'
    execute 'syntax match dtabObjectKey   /^\t*' . s:line_keys . '\ze\%(\t\|$\)/ contained contains=@dtabKeyParts'
    execute 'syntax match dtabObjectKey   /^\%(' . l:list_goes_on . s:keys . '\%(\t\|$\)\)\@=.\+/ contained contains=@dtabKeyParts nextgroup=dtabObjectKey skipnl skipempty'
    execute 'syntax match dtabLeaf        /^\t*' . s:line_closed_keys . ' [^\t]*/ contained contains=dtabLeafKey,dtabLeafValue'
    execute 'syntax match dtabLeaf        /^\%(\t\+\|\t*' . s:dangling_keys . '\)$/ contained contains=dtabLeafKey,dtabLeafValue nextgroup=dtabLeaf skipnl skipempty'
    execute 'syntax match dtabBlockKey    /^\t*' . s:line_closed_keys . '\ze / contained contains=@dtabKeyParts nextgroup=dtabString'
    execute 'syntax match dtabBlockKey    /^\%(\t\+\|\t*' . s:dangling_keys . '\)$/ contained contains=@dtabKeyParts nextgroup=dtabBlockKey skipnl skipempty'
    execute 'syntax region dtabString matchgroup=dtabBlockTag start=/^\z(\t*\)' . s:header_prefix . s:line_closed_keys . '\zs [^\t]*\ze\%(\t\+ [^\t]*\)*\t*$/' . s:from_line_start
        \ . ' end=/^\%(\z1\t\|\s*$\)\@!/ contained keepend contains=dtabHeaderComment,dtabBlock'
    syntax match  dtabHeaderComment / [^\t]*/ contained
    " The text: plain from the next line on, or tagged (s:DtabEmbedded). \%$ is the file's end, which the
    " string's end comes before.
    syntax region dtabBlock start=/^/ end=/\%$/ contained contains=@dtabShebangs
    let b:dtab_syntaxes = s:NeededSyntaxes(getline(1, '$'))
    call s:DtabEmbedded(b:dtab_syntaxes)
    syntax sync fromstart
    call s:DtabHighlight()
    let b:current_syntax = 'dtab'
endfunction

" Languages a multiline string can be tagged with (the README's table), and the vim syntax file for each.
" Vim has no syntax file for jsonl; s:DtabEmbedded makes its cluster from json.vim's groups.
let s:dtab_languages = {
    \ 'sql': 'sql', 'python': 'python', 'py': 'python', 'javascript': 'javascript', 'js': 'javascript',
    \ 'typescript': 'typescript', 'ts': 'typescript', 'html': 'html', 'css': 'css', 'json': 'json', 'jsonl': 'jsonl',
    \ 'yaml': 'yaml', 'yml': 'yaml', 'markdown': 'markdown', 'md': 'markdown',
    \ 'bash': 'sh', 'sh': 'sh', 'shell': 'sh', 'zsh': 'zsh',
    \ 'c': 'c', 'cpp': 'cpp', 'rust': 'rust', 'go': 'go', 'java': 'java', 'swift': 'swift',
    \ }
" Interpreters a shebang can name, and the tag each one means
let s:dtab_shebangs = {'bash': 'bash', 'zsh': 'zsh', 'sh': 'sh', 'python': 'python', 'node': 'javascript'}
" The interpreter a shebang line names, as in dtabShebang's start pattern
let s:shebang_word = '^\t\+#!.*\<\zs\%(' . join(keys(s:dtab_shebangs), '\|') . '\)\ze\d*\>'

function! s:NeededSyntaxes(lines) abort
    " Pure function. The syntax files the multiline strings in lines need: the languages of the tags that end a
    " line (a superset of the headers', which costs only an unused include) and of shebangs; jsonl's is json.
    " Args: lines (list of strings). Returns: sorted list of syntax names.
    " Example: s:NeededSyntaxes(["q sql\t note", "\tSELECT 1", "s ", "\t#!/bin/bash", "log jsonl", "x 1"])
    " -> ['json', 'sh', 'sql'].
    let l:needed = {}
    for l:line in a:lines
        let l:word = matchstr(l:line, s:shebang_word)
        let l:tags = [matchstr(l:line, ' \zs[^\t ]\+\ze\%(\t\+ [^\t]*\)*\t*$'), get(s:dtab_shebangs, l:word, '')]
        for l:syntax in map(filter(l:tags, 'has_key(s:dtab_languages, v:val)'), 's:dtab_languages[v:val]')
            let l:needed[l:syntax ==# 'jsonl' ? 'json' : l:syntax] = 1
        endfor
    endfor
    return sort(keys(l:needed))
endfunction

function! s:IncludeNewLanguages() abort
    " Command (may reload the buffer's syntax). After an edit, brings in the syntax file of a language the
    " changed lines started to use (a new tag or shebang) by setting 'syntax' again. Scans only the changed lines.
    if get(b:, 'current_syntax', '') !=# 'dtab'
        return
    endif
    let l:new = filter(s:NeededSyntaxes(getline(line("'["), line("']"))), 'index(b:dtab_syntaxes, v:val) < 0')
    if !empty(l:new)
        let &l:syntax = &l:syntax
    endif
endfunction

function! s:DtabEmbedded(syntaxes) abort
    " Command (defines syntax items). Only the syntax files in syntaxes (s:NeededSyntaxes) come in: vim walks
    " every syntax item at each position where it looks for a match, so including all of them made every line
    " several times slower to parse.
    " One region per tag: the text of a string whose header ends in `key TAG`, colored by that language's own
    " syntax file. These are defined after the plain text, so they win at the same position.
    " One region per shebang, nested in a plain string, from the shebang line to the string's end.
    " The tabs that start a string's line are dtab's. A language item that runs past a line's end (json.vim's
    " missing comma, a block comment) would color the next line's tabs, so dtabBlockIndent takes them inside
    " every language group (dtabLanguageGroups, filled once the languages are in). Defined first, so a
    " language pattern starting at the same column still wins (`^\s*\*` in a Javadoc comment). At a
    " string's top level the tabs are the language's to match, or `^\s*\zs#include` would never match.
    syntax match dtabBlockIndent /^\t\+/ contained containedin=@dtabLanguageGroups
    " jsonl is a json value per line. json.vim looks past a line's end for the comma between an array's
    " values (jsonMissingCommaError, and jsonFold, whose `}` does not close before a `{` on the next line),
    " so a jsonl string gets json.vim's other groups, and brackets of its own.
    if index(a:syntaxes, 'json') >= 0
        syntax match dtabJsonlBracket /[][{}]/ contained
        syntax cluster dtabLang_jsonl contains=jsonNoise,jsonKeywordMatch,jsonStringMatch,jsonStringSQError,jsonNumber,
            \jsonNoQuotesError,jsonTripleQuotesError,jsonNumError,jsonCommentError,jsonSemicolonError,
            \jsonTrailingCommaError,jsonPadding,jsonBoolean,jsonNull,dtabJsonlBracket
    endif
    for l:syntax in a:syntaxes
        unlet! b:current_syntax
        execute 'silent! syntax include @dtabLang_' . l:syntax . ' syntax/' . l:syntax . '.vim'
    endfor
    for [l:tag, l:syntax] in items(s:dtab_languages)
        if index(a:syntaxes, l:syntax ==# 'jsonl' ? 'json' : l:syntax) >= 0   " jsonl has no syntax file of its own
            execute 'syntax region dtabBlock start=/' . s:TextStart(l:tag) . '/ end=/\%$/ contained contains=@dtabLang_' . l:syntax
        endif
    endfor
    for [l:word, l:tag] in items(s:dtab_shebangs)
        if index(a:syntaxes, s:dtab_languages[l:tag]) >= 0
            execute 'syntax region dtabShebang start=/^\t\+#!.*\<' . l:word . '\d*\>/'
                \ . ' end=/^\%(\t\|\s*$\)\@!/ contained contains=@dtabLang_' . s:dtab_languages[l:tag]
        endif
    endfor
    syntax cluster dtabShebangs contains=dtabShebang
    syntax cluster dtabLanguageGroups contains=\%(dtab\)\@!.*
    let b:current_syntax = 'dtab'
endfunction

" What the Tab key inserts inside a multiline string: code indents with spaces; tabs are dtab structure.
let s:block_indent = '    '
" Allowed in keys besides letters and digits. SEMANTIC BINDING: dtab-key-punctuation
let s:key_punctuation = '_.-/'
" A key list: non-blank characters, where a comma may be followed by spaces, then tabs or line breaks, before
" the next non-blank. Any character goes in; dtabBadKey and dtabBadComma flag the wrong ones. Only the commas
" divide the list, so it matches in one way: were `a,b,c` divisible anywhere, vim's backtracking engine would
" try every division.
let s:anonymous = ',\%([ \t]\|$\)\@='
let s:not_anonymous = '\%(' . s:anonymous . '\)\@!'
let s:keys = '\%(' . s:anonymous . '\|' . s:not_anonymous . '[^\t ]\@=[^\t ,]*\%(,\%(\%( \+[\t\n]*\|[\t\n]\+\)[^\t ]\@=\)\=[^\t ,]*\)*\)'
" The same within one line
let s:line_keys = '\%(' . s:anonymous . '\|' . s:not_anonymous . '[^\t ]\@=[^\t ,]*\%(,\%(\%( \+\t*\|\t\+\)[^\t ]\@=\)\=[^\t ,]*\)*\)'
" A line's part of a key list going on to the next line: the keys to a comma ending the line, with the spaces,
" then tabs, a comma allows before the line break. Followed by a line break and the rest of the whitespace
" ([\t\n]*), s:keys or s:closed_keys then match the rest of the list, so together they are those lists spanning
" lines. Only the commas divide it.
let s:dangling_keys = s:not_anonymous . '\%([^\t ,]*,\%( \+\t*\|\t\+\)\=\)\+'
" A key list that does not end in a comma, which a leaf's key and an earlier entry of a header are: a comma
" before the space would take the space in, so `l1, l2, l3` is not the leaf `l1, l2,` with value `l3`. Said
" in the pattern, not by a lookbehind after it, which inside the header's earlier entries fills vim's NFA
" engine's memory on a list of a few hundred keys.
let s:closed_keys = '\%(' . s:anonymous . '\|' . s:not_anonymous . '\%([^\t ,]*,\%( \+[\t\n]*\|[\t\n]\+\)\=\)*[^\t ,]\+\)'
" The same within one line, for patterns and functions that look at a line
let s:line_closed_keys = '\%(' . s:anonymous . '\|' . s:not_anonymous . '\%([^\t ,]*,\%( \+\t*\|\t\+\)\=\)*[^\t ,]\+\)'
" Earlier entries on the line of a multiline string's header, before its last leaf
let s:header_prefix = '\%(\%( [^\t]*\|' . s:line_closed_keys . '\%( [^\t]*\)\=\)\t\+\)*'
" Offsets for a pattern that starts with ^ and marks its item's start with \zs: it reads what comes before the
" item, as a lookbehind would, but once per line. lc steps back to the line's start from whichever column vim
" tries the pattern at (lines are shorter than this many bytes), and ms=s starts the item at \zs rather than
" that far to its right. Each \zs must have one place on a line, since only the first match counts. A
" lookbehind is tried at every column, and on a line a few hundred characters long fills 'maxmempattern'
" (E363), after which vim's backtracking engine takes over and never finishes.
let s:from_line_start = 'ms=s,lc=1000000'

function! s:TextStart(tag) abort
    " Pure function. The start pattern of a multiline string's text when its header's text matches the pattern
    " tag: the start of the line after the header's line, which it looks behind at. The ^ keeps vim to column
    " 0, so the lookbehind runs once.
    " Args: tag (string, a pattern). Returns: string, a pattern.
    " Example: s:TextStart('sql') matches at the start of the line after "A\tquery sql\t note", and not after
    " "A\tquery sqlite".
    return '^\%(^\t*' . s:header_prefix . s:line_closed_keys . ' ' . a:tag . '\%(\t\+ [^\t]*\)*\t*\n\)\@<='
endfunction

function! s:IsHeaderLine(line) abort
    " Pure function. Whether the last non-comment entry is a leaf (trailing tabs allowed).
    " Args: line (string). Returns: boolean. Example: s:IsHeaderLine("A\tB\tcode py\t") -> 1.
    return a:line =~ '^\t*' . s:header_prefix . s:line_closed_keys . ' [^\t]*\%(\t\+ [^\t]*\)*\t*$'
endfunction

function! s:Deeper(lnum, depth) abort
    " Whether the first non-blank line after lnum has more than depth tabs.
    let l:next = nextnonblank(a:lnum + 1)
    return l:next > 0 && len(matchstr(getline(l:next), '^\t*')) > a:depth
endfunction

function! s:IsHeader(lnum) abort
    " Whether a line opens a multiline string: it has the header shape and the next non-blank line is deeper.
    return s:IsHeaderLine(getline(a:lnum)) && s:Deeper(a:lnum, len(matchstr(getline(a:lnum), '^\t*')))
endfunction

function! s:InBlock(lnum) abort
    " Whether a line is inside a multiline string: walking up through its ancestors (each the nearest
    " shallower non-blank line), the first one shaped like a header puts it inside (a deeper line follows it
    " by construction). The line's own tabs are its depth, so a line of only whitespace at the header's
    " depth, or an empty line, is structure: Tab there gives a tab. The same walk as insideBlock in
    " vscode/extension.js.
    let l:depth = len(matchstr(getline(a:lnum), '^\t*'))
    let l:above = prevnonblank(a:lnum - 1)
    while l:above > 0 && l:depth > 0
        let l:indent = len(matchstr(getline(l:above), '^\t*'))
        if l:indent < l:depth
            if s:IsHeaderLine(getline(l:above))
                return 1
            endif
            let l:depth = l:indent
        endif
        let l:above = prevnonblank(l:above - 1)
    endwhile
    return 0
endfunction

function! s:Tab() abort
    " Inside a multiline string and past the line's own tabs, insert spaces; everywhere else a tab.
    let l:col = col('.') - 1
    let l:leading = len(matchstr(getline('.'), '^\t*'))
    return s:InBlock(line('.')) && l:col >= l:leading ? s:block_indent : "\<Tab>"
endfunction

function! s:ShiftLines(first, last, direction) abort
    " A range entirely inside a multiline string is code: add or remove one level of spaces after each
    " line's tabs. A range touching structure (a header, or any line outside a string) is dtab: add or
    " remove one tab on every line, so a string moves with its header. Not vim's own >> and <<, which
    " rewrite the whole indent and would turn a string's spaces into tabs. Blank lines are untouched.
    let l:code = 1
    for l:lnum in range(a:first, a:last)
        if getline(l:lnum) =~ '\S' && !s:InBlock(l:lnum)
            let l:code = 0
        endif
    endfor
    for l:lnum in range(a:first, a:last)
        let l:line = getline(l:lnum)
        if l:line !~ '\S'
            continue
        elseif l:code
            let l:tabs = matchstr(l:line, '^\t*')
            let l:rest = l:line[len(l:tabs):]
            let l:rest = a:direction > 0 ? s:block_indent . l:rest : substitute(l:rest, '^ \{1,' . len(s:block_indent) . '}', '', '')
            call setline(l:lnum, l:tabs . l:rest)
        else
            call setline(l:lnum, a:direction > 0 ? "\t" . l:line : substitute(l:line, '^\t', '', ''))
        endif
    endfor
endfunction

let s:sid = expand('<SID>')

function! s:Operator(name) abort
    " The > and < operators, as an <expr> mapping: a count typed before the operator (2>j) stays with g@.
    let &operatorfunc = s:sid . a:name
    return 'g@'
endfunction

function! s:IndentOperator(type) abort
    call s:ShiftLines(line("'["), line("']"), 1)
endfunction

function! s:OutdentOperator(type) abort
    call s:ShiftLines(line("'["), line("']"), -1)
endfunction

function! s:Entries(line) abort
    " Pure function. Entries after indentation; tab runs separate entries and trailing tabs are ignored.
    " Args: line (string). Returns: list of strings. Example: s:Entries("a, b\tc 1\t") -> ['a,b', 'c 1'].
    let l:line = substitute(a:line, '\%(^\|\t\)\zs' . s:line_keys,
        \ '\=substitute(submatch(0), '',\zs *\t*'', '''', ''g'')', 'g')
    return split(substitute(l:line, '^\t*', '', ''), '\t\+')
endfunction

function! s:Dangling(line) abort
    " Pure function. Whether the last entry continues a named-key list; a lone comma does not.
    " Args: line (string). Returns: boolean. Example: s:Dangling('a,') -> 1; s:Dangling(',') -> 0.
    let l:entries = s:Entries(a:line)
    return !empty(l:entries) && l:entries[-1] =~ '^[^\t ]\+,$'
endfunction

function! s:StepsIn(line) abort
    " Pure function. Whether a structure line steps into an object key. Comments and trailing tabs do not count.
    " Args: line (string). Returns: boolean. Example: s:StepsIn("A\tB\t") -> 1; s:StepsIn("x 1\t") -> 0.
    for l:entry in s:Entries(a:line)
        if l:entry[0] !=# ' ' && l:entry !~ ' '
            return 1
        endif
    endfor
    return 0
endfunction

function! s:IsComment(line) abort
    " Whether a line is only comment entries, which write nothing wherever they land.
    for l:entry in s:Entries(a:line)
        if l:entry[0] !=# ' '
            return 0
        endif
    endfor
    return 1
endfunction

function! s:Reparents(lnum, upper_depth, upper_steps_in) abort
    " Whether joining line lnum onto a line of depth upper_depth would move a later line of the subtree
    " (the lines before the first one at or above upper_depth) under a different key. If the joined line
    " steps into a key, every later line must be deeper than it (a descendant), else it would nest under
    " that key. If the joined line is only a comment at the depth of an upper line that steps into a key,
    " no later line may be deeper than it: those continued the comment's parent and would now continue
    " that key.
    let l:depth = len(matchstr(getline(a:lnum), '^\t*'))
    let l:steps_in = s:StepsIn(getline(a:lnum))
    let l:comment_at_depth = s:IsComment(getline(a:lnum)) && l:depth == a:upper_depth && a:upper_steps_in
    for l:later in range(a:lnum + 1, line('$'))
        if getline(l:later) !~ '\S'
            continue
        endif
        let l:later_depth = len(matchstr(getline(l:later), '^\t*'))
        if l:later_depth <= a:upper_depth && !(l:comment_at_depth && l:later_depth > l:depth)
            return 0
        elseif l:steps_in && l:later_depth <= l:depth
            return 1
        elseif l:comment_at_depth && l:later_depth > l:depth
            return 1
        endif
    endfor
    return 0
endfunction

function! s:JoinWith(lnum, glue) abort
    " Joins line lnum + 1 onto line lnum with glue between, the lower line's own tabs dropped.
    let l:upper = getline(a:lnum)
    call setline(a:lnum, l:upper . a:glue . substitute(getline(a:lnum + 1), '^\t*', '', ''))
    call deletebufline('%', a:lnum + 1)
    call cursor(a:lnum, len(l:upper) + 1)
endfunction

function! s:Join(first, last) abort
    " Joins lines first..last pairwise from the top. Two structure lines join with one tab, the wide form of
    " the same tree, but only when the tree does stay the same: the lower line is deeper, or at the same
    " depth under a line that steps into nothing (or is a comment that nothing deeper follows), and no
    " later line of the subtree changes parent (s:Reparents). Otherwise nothing happens but a message. A
    " multiline string's header keeps its text below it. Header joins are refused to avoid changing the
    " string's indentation baseline, as is a join whose result would become a header (a comment joined
    " onto `v 1` with a deeper line below would turn that line into text). An upper line ending in a comma
    " continues on the lower one already: they join with a space, `a,` and `b` to `a, b`. Two lines inside a string are
    " text and join like vim's J. A blank line is dropped, as vim's J drops it.
    for l:step in range(a:first, a:last - 1)
        if a:first >= line('$')
            return
        endif
        let l:upper = getline(a:first)
        let l:lower = getline(a:first + 1)
        let l:upper_depth = len(matchstr(l:upper, '^\t*'))
        let l:lower_depth = len(matchstr(l:lower, '^\t*'))
        if l:lower !~ '\S'
            call deletebufline('%', a:first + 1)
            call cursor(a:first, max([len(l:upper), 1]))
        elseif l:upper !~ '\S'
            call deletebufline('%', a:first)
            call cursor(a:first, 1)
        elseif s:InBlock(a:first + 1) && s:InBlock(a:first)
            call cursor(a:first, 1)
            normal! J
        elseif s:Dangling(l:upper)
            call s:JoinWith(a:first, ' ')
        elseif s:IsHeader(a:first) || s:IsHeader(a:first + 1)
            \ || (s:IsHeaderLine(l:upper . "\t" . substitute(l:lower, '^\t*', '', '')) && s:Deeper(a:first + 1, l:upper_depth))
            \ || l:lower_depth < l:upper_depth
            \ || (l:lower_depth == l:upper_depth && s:StepsIn(l:upper) && !s:IsComment(l:lower))
            \ || s:Reparents(a:first + 1, l:upper_depth, s:StepsIn(l:upper))
            echohl WarningMsg | echo 'dtab: not joined: the tree would change' | echohl None
            return
        else
            call s:JoinWith(a:first, "\t")
        endif
    endfor
endfunction

" An entry: non-tab characters, not all spaces; group 1, its leading spaces, makes it a comment
let s:entry = '\( *\)[^\t ][^\t]*'

function! s:CommentToggle(lines, selections) abort
    " Pure function. What an editor's comment toggle does to its selections, the same as commentToggle in
    " dtab.js and comment_toggle in dtab.py, whose carets are vim's linewise gcc. A selection touches an entry
    " when it covers some of its text after its leading spaces. The touched entries all lose one space when
    " they all start with one; otherwise each gains one, so a comment already there becomes a double comment.
    " Commenting then toggling the same selections gives the text back.
    " Args: lines (list of strings); selections (list of [start line, start column, end line, end column]:
    " 0-based, byte columns, the end column excluded, v:maxcol for the line's end). Returns: [remove, at], at
    " the sorted [line, column] of each touched entry's first character.
    " Example: s:CommentToggle(["a\tb 1", "\tc 2"], [[0, 0, 1, 4]]) -> [0, [[0, 0], [0, 2], [1, 1]]];
    " s:CommentToggle(["a\tb\tc 1"], [[0, 2, 0, 3]]) -> [0, [[0, 2]]].
    let l:touched = {}   " zero-padded 'line,column' -> [line, column, starts with a space]
    for [l:start_line, l:start_column, l:end_line, l:end_column] in a:selections
        for l:line in range(l:start_line, l:end_line)
            let l:from = l:line > l:start_line ? 0 : l:start_column
            let l:to = l:line < l:end_line ? v:maxcol : l:end_column
            let [l:entry, l:start, l:end] = matchstrpos(a:lines[l:line], s:entry)
            while l:start >= 0
                if l:start + len(matchstr(l:entry, '^ *')) < l:to && l:from < l:end
                    let l:touched[printf('%09d,%09d', l:line, l:start)] = [l:line, l:start, l:entry[0] ==# ' ']
                endif
                let [l:entry, l:start, l:end] = matchstrpos(a:lines[l:line], s:entry, l:end)
            endwhile
        endfor
    endfor
    let l:entries = map(sort(keys(l:touched)), 'l:touched[v:val]')
    let l:remove = !empty(l:entries) && empty(filter(copy(l:entries), '!v:val[2]'))
    return [l:remove, map(l:entries, 'v:val[0 : 1]')]
endfunction

function! s:ToggleComments(selections) abort
    " Toggles comments (s:CommentToggle) for selections in the buffer, their lines 1-based. The visual marks move
    " with the text, so gv selects what was selected and gc on it toggles back.
    if empty(a:selections)
        return
    endif
    let l:first = min(map(copy(a:selections), 'v:val[0]'))
    let l:lines = getline(l:first, max(map(copy(a:selections), 'v:val[2]')))
    let [l:remove, l:at] = s:CommentToggle(l:lines, map(copy(a:selections), '[v:val[0] - l:first, v:val[1], v:val[2] - l:first, v:val[3]]'))
    let l:columns = {}   " line number -> the columns edited on it, in order
    for [l:line, l:column] in l:at
        let l:columns[l:line + l:first] = get(l:columns, l:line + l:first, []) + [l:column]
    endfor
    let l:marks = []
    for l:mark in ["'<", "'>"]
        let l:pos = getpos(l:mark)
        if has_key(l:columns, l:pos[1]) && l:pos[2] <= len(getline(l:pos[1]))
            " The character under the mark moves past a space inserted at or before it, back past one removed before it
            let l:moved = filter(copy(l:columns[l:pos[1]]), l:remove ? 'v:val < l:pos[2] - 1' : 'v:val <= l:pos[2] - 1')
            let l:pos[2] += (l:remove ? -1 : 1) * len(l:moved)
            call add(l:marks, [l:mark, l:pos])
        endif
    endfor
    for [l:lnum, l:edited] in items(l:columns)
        let l:text = getline(str2nr(l:lnum))
        for l:column in reverse(copy(l:edited))
            let l:text = strpart(l:text, 0, l:column) . (l:remove ? '' : ' ') . strpart(l:text, l:remove ? l:column + 1 : l:column)
        endfor
        call setline(str2nr(l:lnum), l:text)
    endfor
    for [l:mark, l:pos] in l:marks
        call setpos(l:mark, l:pos)
    endfor
endfunction

function! s:CommentRegion(start, end, mode) abort
    " Toggles comments on the entries a region touches: a visual selection or an operator's motion, from
    " getpos() positions and a visualmode() mode. Linewise takes whole lines; characterwise runs from the start
    " to the end character; a block is a one-line selection per line, from getregionpos, which knows tabs (a
    " line the block misses comes back as columns 0 to 0, which touches nothing).
    if a:mode ==# 'V'
        call s:ToggleComments([[a:start[1], 0, a:end[1], v:maxcol]])
    elseif a:mode ==# 'v'
        call s:ToggleComments([[a:start[1], a:start[2] - 1, a:end[1], a:end[2]]])
    else
        call s:ToggleComments(map(getregionpos(a:start, a:end, {'type': a:mode}), '[v:val[0][1], v:val[0][2] - 1, v:val[1][1], v:val[1][2]]'))
    endif
endfunction

function! s:CommentOperator(type) abort
    call s:CommentRegion(getpos("'["), getpos("']"), {'char': 'v', 'line': 'V', 'block': "\<C-V>"}[a:type])
endfunction

" The JSON preview parses with the plugin's own dtab.py (next to this file) through vim's python3.
let s:plugin_root = expand('<sfile>:p:h')

function! s:TogglePreview() abort
    " Opens a split to the right showing this buffer's tree as JSON, or closes it if it is open.
    if !has('python3')
        echoerr 'dtab: :DtabPreview needs vim with +python3'
        return
    endif
    if exists('b:dtab_preview') && bufwinnr(b:dtab_preview) > 0
        execute bufwinnr(b:dtab_preview) . 'close'
        return
    endif
    rightbelow vertical new
    setlocal buftype=nofile bufhidden=wipe noswapfile nobuflisted filetype=json
    let l:preview = bufnr('%')
    wincmd p
    let b:dtab_preview = l:preview
    call s:RenderPreview()
endfunction

function! s:RenderPreview() abort
    " Fills the preview window, if this buffer has one open, with the tree as JSON, or with the parser's
    " message (line number included) while the text does not parse.
    if !exists('b:dtab_preview') || bufwinnr(b:dtab_preview) < 0
        return
    endif
python3 << EOF
import json, sys, vim
if vim.eval('s:plugin_root') not in sys.path:
    sys.path.insert(0, vim.eval('s:plugin_root'))
import dtab
try:
    preview = json.dumps(dtab.parse('\n'.join(vim.current.buffer[:])), indent=4, ensure_ascii=False)
except ValueError as error:   # a key mid-edit: the parser's message stands in for the tree
    preview = str(error)
vim.buffers[int(vim.eval('b:dtab_preview'))][:] = preview.split('\n')
EOF
endfunction

function! s:DtabHighlight() abort
    " Command. Applies key colors; anonymous entry keys additionally use bold.
    highlight dtabObjectKey ctermfg=176 guifg=#d787d7   " purple
    highlight dtabLeafKey   ctermfg=81  guifg=#5fd7ff   " cyan
    highlight dtabListObjectKey ctermfg=176 guifg=#d787d7 cterm=bold gui=bold
    highlight dtabListLeafKey   ctermfg=81  guifg=#5fd7ff cterm=bold gui=bold
    highlight dtabLeafValue ctermfg=75  guifg=#5fafff   " blue
    highlight dtabBlockKey  ctermfg=221 guifg=#ffd75f   " yellow: named multiline headers; anonymous string keys stay cyan
    highlight dtabBlockTag  ctermfg=173 guifg=#d7875f cterm=italic gui=italic   " orange italic: the language tag
    highlight dtabBlock     ctermfg=110 guifg=#87afd7 cterm=italic gui=italic   " lighter blue italic: multiline text, not a one-line value
    highlight default link dtabComment     Comment
    highlight default link dtabShebang     dtabBlock
    highlight default link dtabBlockIndent dtabBlock   " as where no language item spans it
    highlight default link dtabJsonlBracket jsonBraces
    highlight default link dtabString      dtabBlock   " the header's tabs after its tag
    highlight default link dtabHeaderComment Comment
    highlight default link dtabComma       Delimiter
    highlight default link dtabBadComma    Error
    highlight default link dtabBadKey      Error
endfunction
