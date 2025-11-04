; (require "helix/editor.scm")
(require (prefix-in helix. "helix/commands.scm"))
(require (prefix-in helix.static. "helix/static.scm"))

(provide wrap-console-log
         wrap-console-dir
         wrap-dbg
         copy-path)

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
;; Copy current buffer path to clipboard
(define (copy-path)
  (helix.run-shell-command (string-append "echo -n '" (helix.static.cx->current-file) "' | pbcopy")))
