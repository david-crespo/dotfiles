; (require "helix/editor.scm")
(require (prefix-in helix. "helix/commands.scm"))
(require (prefix-in helix.static. "helix/static.scm"))
(require "helix/misc.scm")

(provide wrap-console-log
         wrap-console-dir
         wrap-dbg
         copy-path
         notes-picker)

(define (make-wrapper prefix suffix)
  (lambda ()
    (helix.static.replace-selection-with
     (string-append prefix (helix.static.current-highlighted-text!) suffix))))

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
