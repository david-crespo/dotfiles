" neovim config

" would like to use leap in VS Code but it seems to cause problems

if exists('g:vscode')
  call plug#begin('~/.vim/plugged')
    Plug 'ggandor/leap.nvim'
  call plug#end()
  lua require('leap').add_default_mappings()
else 
  " things to only do in regular Neovim
  call plug#begin('~/.vim/plugged')
    Plug 'tpope/vim-repeat'
    Plug 'ggandor/leap.nvim'

    Plug 'tpope/vim-surround'
    Plug 'chriskempson/base16-vim'
    Plug 'nvim-lua/plenary.nvim'
    Plug 'nvim-telescope/telescope.nvim', { 'tag': '0.1.1' }
    " recommended by telescope readme to improve sort perf
    Plug 'nvim-telescope/telescope-fzf-native.nvim', { 'do': 'cmake -S. -Bbuild -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release && cmake --install build --prefix build' }
  call plug#end()
    
  colorscheme base16-tomorrow-night

  " vnoremap p "0p
  " vnoremap P "0P
  " vnoremap y "0y
  " vnoremap d "0d

  " Telescope
  nnoremap <leader>ff <cmd>Telescope find_files<cr>
  nnoremap <leader>fg <cmd>Telescope live_grep<cr>
  nnoremap <leader>fb <cmd>Telescope buffers<cr>
  nnoremap <leader>fh <cmd>Telescope help_tags<cr>

  set number
  lua require('leap').add_default_mappings()
endif

" Global things

" Leap
" make it so j/k work on the fake "lines" of a wrapped line
map k gk
map j gj

" Helix-like keymap

" Map 'x/X' to start visual line mode and select more lines on subsequent presses
" nnoremap x V
" nnoremap X V
" vnoremap x j
" vnoremap X k

" Map 'd' to delete a single character in normal mode
" nnoremap d x
