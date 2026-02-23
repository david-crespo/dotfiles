This is a dotfiles repo. The files are symlinked to ~. `install.sh` shows what
is covered. When asked to read or change global config (shell, editor, jj,
etc.), look in this repo first and only look in the actual home dir if you can't
find the relevant things here. They should nearly always be here. This repo also
contains claude settings and skills in claude/.

When adding new scripts to `bin/`, add a corresponding symlink entry in
`install.sh` and run `install.sh` to create the symlink. Never run `ln -sf`
directly — `install.sh` is the source of truth for what gets symlinked where.

Prefer the simplest approach that gets the job done well, but don't avoid
dependencies just for the sake of minimalism — a well-known tool like GNU
parallel is better than a hand-rolled shell workaround. Follow approaches
already taken in the repo and favor tools already in use over introducing new
ones. Developer experience with the tools matters most; elegance of the
resulting code is a close second.
