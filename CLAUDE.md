This is a dotfiles repo. The files are symlinked to ~. `install.sh` shows what
is covered. When you are asked to make changes to global config, look at the
files in this repo first and only look in the actual home dir if you can't find
the relevant things here. This repo also contains claude settings and skills
in claude/.

When adding new scripts to `bin/`, add a corresponding symlink entry in
`install.sh` and run `install.sh` to create the symlink. Never run `ln -sf`
directly — `install.sh` is the source of truth for what gets symlinked where.
