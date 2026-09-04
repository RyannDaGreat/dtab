" Vim plugin entry point (Vundle, vim-plug, packadd): the real plugin is ../dtab.vim so it can also be pasted into a vimrc.
execute 'source' fnameescape(expand('<sfile>:p:h:h') . '/dtab.vim')
