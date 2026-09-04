" dtab syntax highlighting for Vim.
" Installed as a plugin (plugin/dtab.vim sources this file), or paste this whole block into your vimrc
" after `syntax on`.
"
" Object keys purple, leaf keys cyan, leaf values blue, comments (entries starting with a space) as
" Comment. Errors: trailing tabs (an empty key that silently swallows the following indented lines)
" and characters a key may not contain (keys are identifiers: letters, digits, underscores, not
" starting with a digit).
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
    call s:DtabHighlight()
    let b:current_syntax = 'dtab'
endfunction

function! s:DtabHighlight() abort
    highlight dtabObjectKey ctermfg=176 guifg=#d787d7   " purple
    highlight dtabLeafKey   ctermfg=81  guifg=#5fd7ff   " cyan
    highlight dtabLeafValue ctermfg=75  guifg=#5fafff   " blue
    highlight default link dtabComment     Comment
    highlight default link dtabComma       Delimiter
    highlight default link dtabTrailingTab Error
    highlight default link dtabBadKey      Error
endfunction
