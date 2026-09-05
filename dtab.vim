" dtab syntax highlighting for Vim.
" Installed as a plugin (plugin/dtab.vim sources this file), or paste this whole block into your vimrc
" after `syntax on`.
"
" Object keys purple, leaf keys cyan, leaf values blue, comments (entries starting with a space) as
" Comment. Errors: trailing tabs (an empty key that silently swallows the following indented lines) and
" characters a key may not contain (keys are identifiers). `$key [tag]` multiline blocks are colored as
" values, or by the tagged language's own syntax file (sql, python, bash, ...), or by a shebang.
"
" A dtab line is tab-indented, with entries separated by tabs:
"     deltas	l1,l2	position	x 1	y .5	 inline comment
"     object keys ............... leaf  leaf  comment
augroup dtab
    autocmd!
    autocmd BufRead,BufNewFile *.dtab setfiletype dtab
    autocmd FileType dtab setlocal noexpandtab tabstop=4 shiftwidth=4 softtabstop=0 commentstring=\ %s
    autocmd FileType dtab setlocal iskeyword=@,48-57,_,192-255
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
    " A character that is neither a keyword character (letters incl. multibyte, digits, _) nor a comma,
    " or a key starting with a digit
    syntax match dtabBadKey      /\%(\k\|,\)\@!./                             contained
    syntax match dtabBadKey      /\%(^\|[\t,]\)\@<=\d/                        contained

    " $key [tag]: a multiline block. The region runs over every following line indented deeper than the $ line
    " (\z1 is the $ line's own tabs) or blank. Defined after the entry matches so it wins at the same column.
    " keepend: when the block ends, an embedded-language region inside it ends too.
    " The $ entry may come after other entries on its line (config	db	$init), so the line's tabs and the
    " entries before the $ sit in a lookbehind: the region starts at the $ itself, and \z1 still holds the tabs.
    syntax match  dtabBlockTag /\%(^\t*\%([^\t]*\t\+\)*\$[^\t ]\+\)\@<= [^\t]*/ contained
    syntax region dtabBlock matchgroup=dtabBlockKey start=/\%(^\z(\t*\)\%([^\t]*\t\+\)*\)\@<=\$[^\t ]\+/ end=/^\%(\z1\t\|\s*$\)\@!/ keepend contains=dtabBlockTag,dtabTrailingTab,@dtabShebangs
    call s:DtabEmbedded()
    syntax sync fromstart
    call s:DtabHighlight()
    let b:current_syntax = 'dtab'
endfunction

" Languages a $ block can be tagged with (the README's table), and the vim syntax file for each.
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
    " One region per tag: `$key TAG` then the block, colored by that language's own syntax file.
    " One region per shebang, nested in a plain block, from the shebang line to the block's end.
    let l:included = {}
    for [l:tag, l:syntax] in items(s:dtab_languages)
        if !has_key(l:included, l:syntax)
            unlet! b:current_syntax
            execute 'silent! syntax include @dtabLang_' . l:syntax . ' syntax/' . l:syntax . '.vim'
            let l:included[l:syntax] = 1
        endif
        execute 'syntax region dtabBlock matchgroup=dtabBlockKey'
            \ . ' start=/\%(^\z(\t*\)\%([^\t]*\t\+\)*\)\@<=\$[^\t ]\+\ze ' . l:tag . '\%(\t\|$\)/'
            \ . ' end=/^\%(\z1\t\|\s*$\)\@!/ keepend contains=dtabBlockTag,dtabTrailingTab,@dtabLang_' . l:syntax
    endfor
    for [l:word, l:tag] in items(s:dtab_shebangs)
        execute 'syntax region dtabShebang start=/^\t\+#!.*\<' . l:word . '\d*\>/'
            \ . ' end=/^\%(\t\|\s*$\)\@!/ contained contains=@dtabLang_' . s:dtab_languages[l:tag]
    endfor
    syntax cluster dtabShebangs contains=dtabShebang
    let b:current_syntax = 'dtab'
endfunction

function! s:DtabHighlight() abort
    highlight dtabObjectKey ctermfg=176 guifg=#d787d7   " purple
    highlight dtabLeafKey   ctermfg=81  guifg=#5fd7ff   " cyan
    highlight dtabLeafValue ctermfg=75  guifg=#5fafff   " blue
    highlight dtabBlockKey  ctermfg=221 guifg=#ffd75f   " yellow: a $key is a different thing from a leaf key
    highlight dtabBlockTag  ctermfg=173 guifg=#d7875f cterm=italic gui=italic   " orange italic: the language tag
    highlight dtabBlock     ctermfg=75  guifg=#5fafff   " blue, like a value
    highlight default link dtabComment     Comment
    highlight default link dtabShebang     dtabBlock
    highlight default link dtabComma       Delimiter
    highlight default link dtabTrailingTab Error
    highlight default link dtabBadKey      Error
endfunction
