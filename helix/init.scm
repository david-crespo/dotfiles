(require "helix/configuration.scm")
(require "helix/keymaps.scm")
(require (prefix-in helix. "helix/commands.scm"))

(helix.theme "ayu_evolve2")

(file-picker (fp-hidden #f))
(cursorline #t)
(cursor-shape #:insert "bar")
(soft-wrap (sw-enable #t))
(jump-label-alphabet "fjsdghklertyuiqoaw;pzxcvbnm")
(shell '("zsh" "-c"))
(popup-border "all")
(continue-comments #f)
(lsp (hash 'display-messages #t 'display-progress-messages #t))
(whitespace (ws-render (hash "nbsp" #t)))
(auto-pairs #f)

; See https://github.com/helix-editor/helix/pull/11700
(set-option! 'search (hash 'max-matches 1000))

(set-option! 'statusline
             (hash "right"
                   (list "register"
                         "position"
                         "search-position"
                         "diagnostics"
                         "workspace-diagnostics"
                         "total-line-numbers"
                         "selections")))

; Handle array-valued keybindings separately, doesn't seem like the keymap macro can
; handle them
(add-global-keybinding (hash "normal" (hash "%" (list "save_selection" "select_all"))))
(add-global-keybinding (hash "insert" (hash "Cmd-s" (list "normal_mode" ":w"))))

(keymap
 (global)
 (normal
  ; open current line on github.com
  (C-b ":sh gh browse %{buffer_name}:%{cursor_line} -c=%sh{latest_pushed_commit}")
  ; show blame for current line
  (C-B
   ":sh git blame --date=short -L %{cursor_line},+1 %{buffer_name} | sed -E 's/[0-9]+).*//' | sed 's/(//g'")))

(keymap (global)
        (normal (" " (q ":bc"))
                (A-w ":bc")
                ("=" ":reflow")
                (Cmd-k "select_line_above")
                (Cmd-j "select_line_below")
                ("{" "goto_prev_paragraph")
                ("}" "goto_next_paragraph")
                (C-r ":rla")
                (Cmd-s ":w")
                (Cmd-r ":config-reload")
                ; Cmd-h only works if you override the macOS default by binding Hide Ghostty to
                ; ⌘I in Keyboard > Keyboard shortcuts > App shortcuts
                (Cmd-C-h "jump_view_left")
                (Cmd-C-j "jump_view_down")
                (Cmd-C-k "jump_view_up")
                (Cmd-C-l "jump_view_right")
                (C-h "jump_view_left")
                (C-j "jump_view_down")
                (C-k "jump_view_up")
                (C-l "jump_view_right")
                ; hxai is bin/hxai.ts. Add -f %{buffer_name} to include the whole file.
                (tab "@:pipe hxai -m glm ")
                (L (r "@:pipe hxai ") (s "@:pipe hxai -m sonnet ") (g "@:pipe hxai -m gpt-5 "))
                (M (f ":toggle-option auto-format")
                   (c ":copy-path")
                   (h ":toggle-option lsp.display-inlay-hints")))
        (select (Cmd-k "select_line_above")
                (Cmd-j "select_line_below")
                ("{" "goto_prev_paragraph")
                ("}" "goto_next_paragraph"))
        (insert (C-ret "completion")))

(keymap (extension "rs") (normal (M (d ":wrap-dbg"))))

(define (ecma-keymap ext)
  (keymap (extension ext) (normal (M (l ":wrap-console-log") (d ":wrap-console-dir")))))

(map ecma-keymap '("ts" "tsx" "js"))

; format_sql defined in .zshenv
(keymap (extension "sql") (normal (M (s ":pipe format_sql"))))

; remove from space menu since I don't use them
(define (space-noop key)
  (add-global-keybinding (hash "normal" (hash " " (hash key "no_op")))))

(map space-noop '(F G p P R Y A-c))

(keymap (global) (insert (up "no_op") (down "no_op") (left "no_op") (right "no_op")))

(define-lsp "steel-language-server" (command "steel-language-server") (args '()))
(define-language "scheme"
                 (formatter (command "raco") (args '("fmt" "-i")))
                 (auto-format #true)
                 (language-servers '("steel-language-server")))

; brew install --cask racket
; raco pkg install --auto fmt

(define eslint-config (get-lsp-config "vscode-eslint-language-server"))

;; Functionally updates a hash map
(define (nested-hash-insert map keys value)
  (if (null? keys)
      value
      (hash-insert map
                   (car keys)
                   (nested-hash-insert (if (hash-contains? map (car keys))
                                           (hash-get map (car keys))
                                           (hash))
                                       (cdr keys)
                                       value))))

(define new-config (nested-hash-insert eslint-config (list 'config 'run) "onSave"))

; (displayln eslint-config)
; (displayln new-config)

(set-lsp-config! "vscode-eslint-language-server" new-config)
