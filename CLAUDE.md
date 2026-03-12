This is a dotfiles repo. The files are symlinked to ~. `install.sh` shows what
is covered. When asked to read or change global config (shell, editor, jj,
etc.), look in this repo first and only look in the actual home dir if you can't
find the relevant things here. They should nearly always be here. This repo also
contains claude settings and skills in claude/ and utilities in bin/.

When adding new scripts to `bin/`, add a corresponding symlink entry in
`install.sh` and run `install.sh` to create the symlink. Never run `ln -sf`
directly — `install.sh` is the source of truth for what gets symlinked where.

When the user asks about their work, productivity, or what they've been up to,
use the `/coach` skill. It knows how to gather context from daily notes, tasks,
GitHub, and sessions. Key utilities live in this repo: `bin/obsidian-notes.ts`
(daily notes and bot notes), `claude/skills/coach/gh-activity.sh`, and
`claude/skills/session-history/claude-sessions.sh`. Use these tools directly —
don't go searching the filesystem for Obsidian vaults or other external state.

Prefer the simplest approach that gets the job done well, but don't avoid
dependencies just for the sake of minimalism — a well-known tool like GNU
parallel is better than a hand-rolled shell workaround. Follow approaches
already taken in the repo and favor tools already in use over introducing new
ones. Developer experience with the tools matters most; elegance of the
resulting code is a close second.
