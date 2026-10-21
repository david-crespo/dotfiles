; (require "helix/editor.scm")
(require (prefix-in helix. "helix/commands.scm"))
(require (prefix-in helix.static. "helix/static.scm"))
(require "helix/misc.scm")
(require (prefix-in helix.editor. "helix/editor.scm"))
(require "ah/ah.scm")

(provide jump-view-left
         jump-view-down
         jump-view-up
         jump-view-right
         close-view-or-pane
         wrap-console-log
         wrap-console-dir
         wrap-dbg
         copy-path
         notes-picker
         ; From ah, re-exported so they're typable commands
         ah-comment
         ah-comment-file)

(define (make-wrapper prefix suffix)
  (lambda ()
    (helix.static.replace-selection-with
     (string-append prefix (helix.static.current-highlighted-text!) suffix))))

; Move to the split in that direction. With none there, move to the Rex pane in
; that direction instead (Rex passes ctrl-hjkl through to helix, see
; ../rex/init.lua).
(define (jump-view jump direction)
  (let ([before (helix.editor.editor-focus)])
    (jump)
    (when (equal? before (helix.editor.editor-focus))
      (helix.run-shell-command
       (string-append "if [ -n \"$REX_SESSION\" ]; then \"$REX_BIN_DIR/rex\" focus -s \"$REX_SESSION\" "
                      direction
                      "; fi")))))

;;@doc
;; Jump to the split on the left, or the Rex pane on the left
(define (jump-view-left) (jump-view helix.static.jump_view_left "left"))
;;@doc
;; Jump to the split below, or the Rex pane below
(define (jump-view-down) (jump-view helix.static.jump_view_down "down"))
;;@doc
;; Jump to the split above, or the Rex pane above
(define (jump-view-up) (jump-view helix.static.jump_view_up "up"))
;;@doc
;; Jump to the split on the right, or the Rex pane on the right
(define (jump-view-right) (jump-view helix.static.jump_view_right "right"))

; True if a jump in some direction lands on another view. Focus is put back.
(define (multiple-views?)
  (let ([start (helix.editor.editor-focus)])
    (let loop ([jumps (list helix.static.jump_view_left
                            helix.static.jump_view_right
                            helix.static.jump_view_up
                            helix.static.jump_view_down)])
      (cond
        [(null? jumps) #f]
        [else
         ((car jumps))
         (if (equal? start (helix.editor.editor-focus))
             (loop (cdr jumps))
             (begin
               (helix.editor.editor-set-focus! start)
               #t))]))))

;;@doc
;; Close this split. In the last one, close the Rex pane helix is in, unless a
;; buffer has unsaved changes.
(define (close-view-or-pane)
  (cond
    [(multiple-views?) (helix.static.wclose)]
    [(not (null? (filter helix.editor.editor-document-dirty? (helix.editor.editor-all-documents))))
     (set-error! "Unsaved changes, not closing the pane")]
    [else
     (helix.run-shell-command
      "if [ -n \"$REX_BLOCK\" ]; then \"$REX_BIN_DIR/rex\" block close -s \"$REX_SESSION\" \"$REX_BLOCK\"; fi")]))

;;@doc
;; Wrap in console.log()
(define wrap-console-log (make-wrapper "console.log(" ")"))

;;@doc
;; Wrap in console.dir()
(define wrap-console-dir (make-wrapper "console.dir(" ")"))

;;@doc
;; Wrap in dbg!()
(define wrap-dbg (make-wrapper "dbg!(" ")"))

;;@doc
;; Copy current buffer path (relative to cwd) to clipboard
(define (copy-path)
  (let* ((abs-path (helix.static.cx->current-file))
         (cwd (helix.static.get-helix-cwd))
         (cwd-with-slash (if (ends-with? cwd "/") cwd (string-append cwd "/")))
         (rel-path (if (starts-with? abs-path cwd-with-slash)
                       (substring abs-path (string-length cwd-with-slash))
                       abs-path)))
    (helix.run-shell-command (string-append "echo -n '" rel-path "' | pbcopy"))))

;;@doc
;; Pick a file in .claude/notes, newest first. Notes start with a date, so
;; reverse name order is newest first.
(define (notes-picker)
  (let ([dir (string-append (helix.static.get-helix-cwd) "/.claude/notes")])
    (if (is-dir? dir)
        (push-component!
         (picker (sort (filter (lambda (f) (not (is-dir? f))) (read-dir dir)) string>?)))
        (set-status! (string-append "No notes directory at " dir)))))
