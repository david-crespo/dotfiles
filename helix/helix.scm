; (require "helix/editor.scm")
(require (prefix-in helix. "helix/commands.scm"))
(require (prefix-in helix.static. "helix/static.scm"))
(require "helix/misc.scm")
(require (prefix-in helix.editor. "helix/editor.scm"))
(require "ah/ah.scm")

(provide close-view-or-pane
         split-right
         split-below
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

(define (env-set? name)
  (let ([v (maybe-get-env-var name)])
    (and (Ok? v) (not (equal? (Ok->value v) "")))))

; In Rex, open a new Rex pane in that direction with hx on this buffer at the
; cursor; with editor.session = "auto" that hx joins this editor. A buffer
; with no file, like the scratch buffer of a bare hx, gets a bare hx, since a
; joining hx can't open an existing scratch buffer. Elsewhere, a helix split.
; None in ah's editor pane, which sets AH_PANE.
(define (split direction native)
  (let ([file (helix.static.cx->current-file)])
    (cond
      [(env-set? "AH_PANE") (set-error! "Splitting not allowed in ah editor pane")]
      [(env-set? "REX_BLOCK")
       (helix.run-shell-command
        (string-append "\"$REX_BIN_DIR/rex\" split -s \"$REX_SESSION\" -b \"$REX_BLOCK\" --split "
                       direction
                       " --cwd \"$PWD\" -- hx"
                       (if file
                           (string-append " '"
                                          file
                                          ":"
                                          (number->string (+ 1 (helix.static.get-current-line-number)))
                                          ":"
                                          (number->string (+ 1 (helix.static.get-current-column-number)))
                                          "'")
                           "")
                       " > /dev/null"))]
      [else (native)])))

;;@doc
;; Split right: a new Rex pane in Rex, else a helix split
(define (split-right) (split "right" helix.static.vsplit))
;;@doc
;; Split below: a new Rex pane in Rex, else a helix split
(define (split-below) (split "below" helix.static.hsplit))

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
