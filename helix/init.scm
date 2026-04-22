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
(lsp (hash 'display-messages #t 'display-progress-messages #t 'goto-reference-include-declaration #f))
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
        (normal (" " (q ":bc") (o (n ":o .claude/notes")))
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
                (tab "@:pipe hxai -m k2 ")
                (L (r "@:pipe hxai ") (s "@:pipe hxai -m sonnet ") (g "@:pipe hxai -m gpt-5 "))
                (M (f ":toggle-option auto-format")
                   (c ":copy-path")
                   (h ":toggle-option lsp.display-inlay-hints")
                   (i ":toggle-option file-picker.git-ignore")
                   (l ":lsp-restart")))
        (select (Cmd-k "select_line_above")
                (Cmd-j "select_line_below")
                ("{" "goto_prev_paragraph")
                ("}" "goto_next_paragraph"))
        (insert (C-ret "completion")))

; Language-specific keybindings using ' as the minor mode
(keymap (extension "rs") (normal ("'" (d ":wrap-dbg"))))

(keymap (extension "ts") (normal ("'" (l ":wrap-console-log") (d ":wrap-console-dir"))))
(keymap (extension "tsx") (normal ("'" (l ":wrap-console-log") (d ":wrap-console-dir"))))
(keymap (extension "js") (normal ("'" (l ":wrap-console-log") (d ":wrap-console-dir"))))

; format_sql defined in .zshenv
(keymap (extension "sql") (normal ("'" (s ":pipe format_sql"))))

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

; set-lsp-config! merges the given hash into the existing config, only updating fields present
(set-lsp-config! "vscode-eslint-language-server" (hash "config" (hash "run" "onSave")))

; Load project-local extensions from .helix/local.scm if present. Runs after
; the global config, so it can call add-global-keybinding etc. to extend (not
; replace) the global setup. Deliberately not named .helix/init.scm because
; helix's built-in local-config mechanism replaces the global config when both
; .helix/init.scm and .helix/helix.scm exist in a project.
(when (path-exists? ".helix/local.scm")
  (load ".helix/local.scm"))
