call plug#begin('~/.vim/plugged')
  Plug 'easymotion/vim-easymotion'
  Plug 'tomtom/tcomment_vim'
  Plug 'tpope/vim-surround'
  Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
  Plug 'junegunn/fzf.vim'
  Plug 'chriskempson/base16-vim'
call plug#end()

colorscheme base16-tomorrow-night

vnoremap p "0p
vnoremap P "0P
vnoremap y "0y
vnoremap d "0d