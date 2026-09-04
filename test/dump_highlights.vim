" Writes one line per buffer line with one code letter per byte column naming its syntax group.
" Used by test/test_dtab.py:  vim -N -u NONE -i NONE -es -c 'syntax on' -c 'source dtab.vim'
"     -c 'edit test/samples/highlight.dtab' -c 'source test/dump_highlights.vim' -c 'call DumpHighlights("out.txt")' -c 'qa!'
let s:codes = {
    \ 'dtabObjectKey': 'O', 'dtabLeafKey': 'K', 'dtabLeafValue': 'V', 'dtabComment': 'C',
    \ 'dtabComma': ',', 'dtabTrailingTab': 'E', 'dtabBadKey': 'X',
    \ 'dtabLeaf': ' ', '': '.',
    \ }

function! DumpHighlights(outfile) abort
    let l:rows = []
    for l:lnum in range(1, line('$'))
        let l:row = ''
        for l:col in range(1, col([l:lnum, '$']) - 1)
            let l:row .= get(s:codes, synIDattr(synID(l:lnum, l:col, 1), 'name'), '?')
        endfor
        call add(l:rows, l:row)
    endfor
    call writefile(l:rows, a:outfile)
endfunction
