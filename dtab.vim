" dtab syntax highlighting for Vim.
" Installed as a plugin (plugin/dtab.vim sources this file), or paste this whole block into your vimrc
" after `syntax on`.
"
" Object keys purple, leaf keys cyan, leaf values blue, comments (entries starting with a space) as
" Comment. Errors: trailing tabs (an empty key that silently swallows the following indented lines) and
" characters a key may not contain (letters, digits, _ . - / only). A leaf with lines indented under it is a
" multiline string: the key yellow, the leaf's text (a tag for editors) orange, and the lines colored as text,
" or by the tagged language's own syntax file (sql, python, bash, ...), or by a shebang.
"
" A dtab line is tab-indented, with entries separated by tabs:
"     deltas	l1,l2	position	x 1	y .5	 inline comment
"     object keys ............... leaf  leaf  comment
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
    " :DtabPreview toggles a split showing the tree as JSON, which follows every edit
    autocmd FileType dtab command! -buffer -bar DtabPreview call <SID>TogglePreview()
    autocmd FileType dtab autocmd TextChanged,TextChangedI <buffer> call <SID>RenderPreview()
    autocmd Syntax dtab call s:DtabSyntax()
    autocmd ColorScheme * if &filetype ==# 'dtab' | call s:DtabHighlight() | endif
augroup END

" File icon for NERDTree, airline etc. via vim-devicons: a delta. Only takes effect if devicons is loaded.
let g:WebDevIconsUnicodeDecorateFileNodesExtensionSymbols = get(g:, 'WebDevIconsUnicodeDecorateFileNodesExtensionSymbols', {})
let g:WebDevIconsUnicodeDecorateFileNodesExtensionSymbols['dtab'] = 'Δ'

function! s:DtabSyntax() abort
    " An entry is a run of non-tab characters bounded by tabs or the line's ends.
    " No space in the entry: object key.  Space in the entry: leaf `key value`.  Leading space: comment.
    syntax match dtabObjectKey   /\%(^\t*\|\t\)\zs[^\t ]\+\ze\%(\t\|$\)/ contains=dtabComma,dtabBadKey
    syntax match dtabLeaf        /\%(^\t*\|\t\)\zs[^\t ]\+ [^\t]*/         contains=dtabLeafKey,dtabLeafValue
    syntax match dtabLeafKey     /[^\t ]\+\ze /                              contained contains=dtabComma,dtabBadKey
    syntax match dtabLeafValue   / \zs[^\t]*/                                 contained
    syntax match dtabComment     /\%(^\t*\|\t\)\zs [^\t]*/
    syntax match dtabComma       /,/                                          contained
    syntax match dtabTrailingTab /\t\+$/
    " A character outside the key bag: keyword characters (letters incl. multibyte, digits, _) and
    " s:key_punctuation, plus the , that separates keys
    execute 'syntax match dtabBadKey /\%(\k\|[,' . escape(s:key_punctuation, ']^-\/') . ']\)\@!./ contained'

    " A line of one leaf whose next non-blank line is deeper opens a multiline string. The key match looks ahead
    " for that deeper line (\1 is the line's own tabs), and only from the key can the string's region start,
    " through nextgroup: it begins at the tag, whose lookbehind captures the tabs (\z1) that bound the region,
    " and runs over every following line indented deeper, or blank. Comment entries may precede the key and
    " follow the tag. Defined after the entry matches so the key wins at the same column. keepend: when the
    " string ends, an embedded-language region inside it ends too.
    syntax match  dtabBlockKey /^\(\t*\)\%( [^\t]*\t\+\)*\zs[^\t ]\+\ze [^\t]*\%(\t\+ [^\t]*\)*\n\%(\s*\n\)*\1\t/ contains=dtabComma,dtabBadKey nextgroup=dtabBlock
    syntax region dtabBlock matchgroup=dtabBlockTag start=/\%(^\z(\t*\)\%( [^\t]*\t\+\)*[^\t ]\+\)\@<= [^\t]*/ end=/^\%(\z1\t\|\s*$\)\@!/ contained keepend contains=dtabHeaderComment,@dtabShebangs
    syntax match  dtabHeaderComment /\%(^\t*\%( [^\t]*\t\+\)*[^\t ]\+ [^\t]*\%(\t\+ [^\t]*\)*\t\+\)\@<= [^\t]*/ contained
    call s:DtabEmbedded()
    syntax sync fromstart
    call s:DtabHighlight()
    let b:current_syntax = 'dtab'
endfunction

" Languages a multiline string can be tagged with (the README's table), and the vim syntax file for each.
let s:dtab_languages = {
    \ 'sql': 'sql', 'python': 'python', 'py': 'python', 'javascript': 'javascript', 'js': 'javascript',
    \ 'typescript': 'typescript', 'ts': 'typescript', 'html': 'html', 'css': 'css', 'json': 'json',
    \ 'yaml': 'yaml', 'yml': 'yaml', 'markdown': 'markdown', 'md': 'markdown',
    \ 'bash': 'sh', 'sh': 'sh', 'shell': 'sh', 'zsh': 'zsh',
    \ 'c': 'c', 'cpp': 'cpp', 'rust': 'rust', 'go': 'go', 'java': 'java', 'swift': 'swift',
    \ }
" Interpreters a shebang can name, and the tag each one means
let s:dtab_shebangs = {'bash': 'bash', 'zsh': 'zsh', 'sh': 'sh', 'python': 'python', 'node': 'javascript'}

function! s:DtabEmbedded() abort
    " One region per tag: `key TAG` then the string, colored by that language's own syntax file. These are
    " defined after the plain region, so they win at the same position.
    " One region per shebang, nested in a plain string, from the shebang line to the string's end.
    let l:included = {}
    for [l:tag, l:syntax] in items(s:dtab_languages)
        if !has_key(l:included, l:syntax)
            unlet! b:current_syntax
            execute 'silent! syntax include @dtabLang_' . l:syntax . ' syntax/' . l:syntax . '.vim'
            let l:included[l:syntax] = 1
        endif
        execute 'syntax region dtabBlock matchgroup=dtabBlockTag'
            \ . ' start=/\%(^\z(\t*\)\%( [^\t]*\t\+\)*[^\t ]\+\)\@<= ' . l:tag . '\ze\%(\t\|$\)/'
            \ . ' end=/^\%(\z1\t\|\s*$\)\@!/ contained keepend contains=dtabHeaderComment,@dtabLang_' . l:syntax
    endfor
    for [l:word, l:tag] in items(s:dtab_shebangs)
        execute 'syntax region dtabShebang start=/^\t\+#!.*\<' . l:word . '\d*\>/'
            \ . ' end=/^\%(\t\|\s*$\)\@!/ contained contains=@dtabLang_' . s:dtab_languages[l:tag]
    endfor
    syntax cluster dtabShebangs contains=dtabShebang
    let b:current_syntax = 'dtab'
endfunction

" What the Tab key inserts inside a multiline string: code indents with spaces; tabs are dtab structure.
let s:block_indent = '    '
" Allowed in keys besides letters and digits. SEMANTIC BINDING: dtab-key-punctuation
let s:key_punctuation = '_.-/'

function! s:IsHeaderLine(line) abort
    " Whether a line has the shape that opens a multiline string once a deeper line follows: exactly one leaf
    " and otherwise only comments. The parser's rule.
    return a:line =~ '^\t*\%( [^\t]*\t\+\)*[^\t ]\+ [^\t]*\%(\t\+ [^\t]*\)*$'
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
    " A line's entries after its indentation, tab runs being one separator; a trailing tab gives a last empty entry.
    return split(substitute(a:line, '^\t*', '', ''), '\t\+', 1)
endfunction

function! s:StepsIn(line) abort
    " Whether a structure line steps into something, so that a line joined onto it would nest under it:
    " an entry with no space (an object key, or the empty key of a trailing tab). Comments (entries
    " starting with a space) do not count.
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

function! s:TabJoin(lnum) abort
    " Joins line lnum + 1 onto line lnum with one tab, the lower line's own tabs dropped.
    let l:upper = getline(a:lnum)
    call setline(a:lnum, l:upper . "\t" . substitute(getline(a:lnum + 1), '^\t*', '', ''))
    call deletebufline('%', a:lnum + 1)
    call cursor(a:lnum, len(l:upper) + 1)
endfunction

function! s:Join(first, last) abort
    " Joins lines first..last pairwise from the top. Two structure lines join with one tab, the wide form of
    " the same tree, but only when the tree does stay the same: the lower line is deeper, or at the same
    " depth under a line that steps into nothing (or is a comment that nothing deeper follows), and no
    " later line of the subtree changes parent (s:Reparents). Otherwise nothing happens but a message. A
    " multiline string's header keeps its text below it, and a header joined onto anything would stop being
    " one, so joins involving a header are refused, as is a join whose result would become one (a comment
    " joined onto `v 1` with a deeper line below would turn that line into text). So is an upper line ending
    " in a tab, whose empty key would vanish into the tab run. Two lines inside a string are text and join
    " like vim's J. A blank line is dropped, as vim's J drops it.
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
        elseif s:IsHeader(a:first) || s:IsHeader(a:first + 1) || l:upper =~ '\t$'
            \ || (s:IsHeaderLine(l:upper . "\t" . substitute(l:lower, '^\t*', '', '')) && s:Deeper(a:first + 1, l:upper_depth))
            \ || l:lower_depth < l:upper_depth
            \ || (l:lower_depth == l:upper_depth && s:StepsIn(l:upper) && !s:IsComment(l:lower))
            \ || s:Reparents(a:first + 1, l:upper_depth, s:StepsIn(l:upper))
            echohl WarningMsg | echo 'dtab: not joined: the tree would change' | echohl None
            return
        else
            call s:TabJoin(a:first)
        endif
    endfor
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
    highlight dtabObjectKey ctermfg=176 guifg=#d787d7   " purple
    highlight dtabLeafKey   ctermfg=81  guifg=#5fd7ff   " cyan
    highlight dtabLeafValue ctermfg=75  guifg=#5fafff   " blue
    highlight dtabBlockKey  ctermfg=221 guifg=#ffd75f   " yellow: a multiline string's key is a different thing from a leaf key
    highlight dtabBlockTag  ctermfg=173 guifg=#d7875f cterm=italic gui=italic   " orange italic: the language tag
    highlight dtabBlock     ctermfg=110 guifg=#87afd7 cterm=italic gui=italic   " lighter blue italic: multiline text, not a one-line value
    highlight default link dtabComment     Comment
    highlight default link dtabShebang     dtabBlock
    highlight default link dtabHeaderComment Comment
    highlight default link dtabComma       Delimiter
    highlight default link dtabTrailingTab Error
    highlight default link dtabBadKey      Error
endfunction
