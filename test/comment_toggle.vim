" Runs comment toggle cases through dtab.vim's gestures the way a user types them: gcc on a caret's line, or a
" characterwise visual selection and gc; then once more (gcc, or gv and gc), which gives the lines back unless
" everything touched was still a comment. Used by test/test_dtab.py:
"     vim ... -c 'source dtab.vim' -c 'edit x.dtab' -c 'source test/comment_toggle.vim' -c "call CommentCases('in.json', 'out.json')"
" CommentTogglePure runs the pure function itself on cases with several selections.
" A case is {lines, selection}: [start line, start column, end line, end column], 0-based characters, the end
" excluded, null for the line's end, start == end for a caret. Writes [lines after the first toggle, after the
" second] per case.

function! s:Position(line, column) abort
    " Query (reads the buffer). getpos() style [0, line, byte column, 0] of the character at a 0-based line and character column.
    return [0, a:line + 1, byteidx(getline(a:line + 1), a:column) + 1, 0]
endfunction

function! s:Visual(selection) abort
    " Query (reads the buffer). The first and last characters an editor's (non-empty) selection covers, as getpos()
    " positions for a characterwise visual selection, or [] when it covers no character: a start at a line's end
    " is the next line's start, an end at a line's start is the previous line's end.
    let [l:sl, l:sc, l:el, l:ec] = a:selection
    let l:ec = l:ec is v:null ? strchars(getline(l:el + 1)) : l:ec
    while l:sl < l:el && l:sc >= strchars(getline(l:sl + 1))
        let [l:sl, l:sc] = [l:sl + 1, 0]
    endwhile
    while l:el > l:sl && l:ec == 0
        let [l:el, l:ec] = [l:el - 1, strchars(getline(l:el))]
    endwhile
    return [l:sl, l:sc] == [l:el, l:ec] || l:sc >= strchars(getline(l:sl + 1)) ? [] : [s:Position(l:sl, l:sc), s:Position(l:el, l:ec - 1)]
endfunction

function! CommentCases(infile, outfile) abort
    " Command (edits the current buffer, writes outfile). Runs every case in infile.
    let l:results = []
    for l:case in json_decode(join(readfile(a:infile), "\n"))
        silent %delete _
        call setline(1, l:case.lines)
        let [l:sl, l:sc, l:el, l:ec] = l:case.selection
        if [l:sl, l:sc] == [l:el, l:ec]
            call cursor(l:sl + 1, 1)
            normal gcc
            let l:first = getline(1, '$')
            normal gcc
        else
            let l:visual = s:Visual(l:case.selection)
            if empty(l:visual)
                call add(l:results, [l:case.lines, l:case.lines])
                continue
            endif
            execute "normal! v\<Esc>"
            call setpos("'<", l:visual[0])
            call setpos("'>", l:visual[1])
            normal gvgc
            let l:first = getline(1, '$')
            normal gvgc
        endif
        call add(l:results, [l:first, getline(1, '$')])
    endfor
    call writefile([json_encode(l:results)], a:outfile)
endfunction

function! CommentTogglePure(infile, outfile) abort
    " Command (writes outfile). dtab.vim's pure s:CommentToggle on every case of infile directly, several selections
    " at once: {lines, selections} with byte columns and v:maxcol ends. Writes the toggled lines per case.
    let l:CommentToggle = function('<SNR>' . getscriptinfo({'name': '/dtab.vim$'})[0].sid . '_CommentToggle')
    let l:results = []
    for l:case in json_decode(join(readfile(a:infile), "\n"))
        let [l:remove, l:at] = l:CommentToggle(l:case.lines, l:case.selections)
        let l:lines = copy(l:case.lines)
        for [l:line, l:column] in reverse(l:at)
            let l:lines[l:line] = strpart(l:lines[l:line], 0, l:column) . (l:remove ? '' : ' ') . strpart(l:lines[l:line], l:remove ? l:column + 1 : l:column)
        endfor
        call add(l:results, l:lines)
    endfor
    call writefile([json_encode(l:results)], a:outfile)
endfunction
