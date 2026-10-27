- The user is an experienced product engineer who mostly works in TypeScript and Rust
- Instructions belong in files the user can review and edit: CLAUDE.md for general guidelines, skills for task instructions. Don't create memory files automatically, since they change your behavior where the user won't see it. At most, propose a memory update for the user to approve.
- Avoid LLM-isms in prose: formulaic rhetorical gestures that perform insight, sincerity, or gravity. Common forms:
  - "that's X, not Y" / "that's not X, it's Y"
  - "That's the spine", "Fair hit", "A real observation", "That's the whole thing", "That's doing real work", "the part that matters most", "say the word", "the moment earned it"
  - "load-bearing", "round-trip" as a verb
  - "Genuinely.", "Quietly.", "Honestly."
  - "One honest caveat:", "Uncertainty flag:", "Worth naming:", "worth stating clearly", "worth holding onto"
  - Fake-therapy imperatives: "That's something to sit with", "Sharpen that", "Notice the arc of what just happened", "a signal to slow down, not a verdict"
- Before sending a chat reply, consider how much of it the user would actually want to read. Length should fit the question: a quick exchange gets a short, conversational answer; a real report can be long, but detail the user will only skim belongs in a file or note.
- When estimating how long a task will take, assume a SOTA coding agent is doing it. Effort intuitions come from humans doing the work and run far too high: work that feels like an hour or two usually takes an agent a few minutes. Recheck any estimate that comes out in hours.

Some information about the user's coding environment:

- OS: macOS
- Terminal: Ghostty
- Text editor: Helix
- Shell: zsh
- Non-standard bash commands available:
  - `sg` (ast-grep): structural code search/transform using AST patterns
  - `tokei`: lines-of-code statistics by language
  - `gh`: GitHub CLI for PRs, issues, repos
  - `jq`: JSON processing and transformation
  - `yq`: YAML/TOML processing (mikefarah v4; jq-like syntax but not identical — Go regex, different function set; check docs for unfamiliar functions)

### jj (Jujutsu)

When working on a set of unpushed revs, we generally treat the stack as a whole as the unit of work rather than one commit at a time. The goal is the most logical, coherent and reviewable set of commits to end up pushed. That doesn't mean we want a bunch of tiny commits.

- Within a turn, squash, split, rebase, describe and abandon the revs you've made freely to get the clearest result.
- While the user is still giving feedback on a rev, put follow-up edits in that same rev, not a new one; they're reviewing it as a whole. Once they've moved on, it's settled, and a later change to it goes on top: make the change, let the user review it as its own diff, and squash it in when they say to. Keep the working copy at the tip: the user may have a dev server running there or want to see later revs.
- Pushed revs are outside the stack. Rewriting them means a force-push, which makes it hard for others to follow along on GitHub, so a change to a pushed rev becomes a new rev on top instead. Squash into pushed revs only when the user decides to force-push.
- A squash or rebase can conflict with later revs that touch the same lines. Resolve conflicts that are straightforward and follow from what the user asked for. Mention a resolution when the user would want to know, such as when it changed a later rev in a way they didn't ask for.
- Undoing your own edits with `jj restore` is routine. Ask before a restore that would discard edits the user made.
- In auto mode, these points decide whether a squash, rebase, abandon or restore is fine. The subcommand alone isn't a reason to stop; what matters is whether it rewrites pushed revs, changes a settled rev without the user saying so, or discards the user's edits.

Commands and conventions:

- When you start work that changes versioned files in this repo and you're on an empty commit with no description, describe it before you start editing. A rev meant to be squashed into another can be left undescribed. Descriptions are how the user reads the stack in `jj log`: one imperative line, under about 50 chars, saying what changed. A few words of why are fine if they fit ("Drop file count, index too large"); a sentence of rationale is not. Longer reasoning goes in a body after a blank line, or in the PR. Update it as the work changes. Leave off a topic prefix like "Audit log: " that a series of commits would share; the PR covers the theme.
- To trace the origin of a line: `jj file annotate <file> | grep '<pattern>'`, then `jj log -r <id>` for context. If that rev is a refactor/move, repeat with `-r <id>-` (and the old path if renamed) until you find the substantive change.
- In jj repos, use jj for everything git would do (`jj status`, `jj diff`, `jj diff -r @-`, `jj log`, `jj file annotate`, ...). Fall back to git only when jj has no way to do the thing.
- To view a file at a revision, use `jj file show <path> -r <rev>` (not `jj cat`).
- To exclude paths from a jj command, use fileset syntax: `jj diff '~dir1 & ~dir2'` or `jj restore '~package-lock.json'`
- for parallel approaches, use `jj new <base>` to create siblings from a common base, implement each approach, then compare. bookmarks are unnecessary for this workflow
- use `jjw` to manage jj workspaces: `jjw create` (or `jjw c`) creates a workspace and cds into it, `jjw ls` lists workspaces, `jjw rm` interactively removes one
- Non-destructive jj operations are generally allowlisted. Check `jj log` immediately before any `jj new`: the working copy may have changed since you last looked, and if you're already on an empty undescribed commit, use it instead of stacking another.
- when using `jj squash`, avoid the editor popup with `-m 'msg'` or `-u` to keep the destination message. These flags are mutually exclusive.
- The user may squash your work into the previous commit while you're working. This is normal — check `@-` (e.g., `jj diff -r @-`) if you need to confirm your changes landed.
- `--ignore-immutable` may be needed when abandoning divergent commits from other authors, e.g., after rebasing on their branch and force pushing
- `jj dt` and `jj dts` are custom aliases that diff a rev against its fork point from trunk (like a GitHub PR diff). `jj dt` shows the full diff, `jj dts` shows `--stat`. Both default to `@` but accept an optional rev argument.

### Rust projects

- Always use nextest for running tests (e.g., `cargo nextest run` instead of `cargo test`).
- When testing something in a single Rust file (a quick experiment, reproducing a bug, checking an API), use cargo script rather than scaffolding a project: `cargo +nightly -Zscript foo.rs`. Declare any deps in a frontmatter block at the top of the file (`---\n[dependencies]\n...\n---`). Still nightly-only as of mid-2026 but on track to stabilize.

### Skills

- Place project-specific skills in-repo at `.claude/skills/<skill-name>/SKILL.md`.

### Subagents

- When delegating to a subagent, pass a `model` explicitly as appropriate to the task: a cheaper model for read-only or lookup work (e.g. `claude-code-guide`, doc/API lookups, simple `Explore` searches), and the session model only for real implementation or hard reasoning. Left unset, a subagent inherits the session model, which costs several times more per token.
- When the user asks for a fresh read or outside perspective, don't use a subagent: subagents always get CLAUDE.md and an SDK preamble. Run a bare `claude -p` from an empty dir instead. In the sandbox, the Bash tool call needs `allowed_domains: ["api.anthropic.com"]`. The reader starts with no context: give it what it needs, in the system prompt or the prompt, but not your own conclusions.

  ```bash
  cd "$(mktemp -d)" && claude -p --model sonnet --tools "" \
    --system-prompt "<framing for the task>" \
    --setting-sources "" --strict-mcp-config < /abs/path/prompt.txt
  ```

- `claude` calls you start, in any directory, use this session's account because they inherit `CLAUDE_CONFIG_DIR`. Don't run them with a stripped environment (`env -i`, clean-env wrappers), which falls back to the default config. `claude auth status` shows which account a call will use.

### Browser interaction (frontend dev work)

- To interact with a browser (verify a change rendered, click through a flow, fill forms, read console errors, debug perf/memory/network), use the `browser-interact` skill — it has the Playwright script template and the first-run gotchas (SPA mock-state resets, waiting, module resolution).
- Core principle: for multi-step flows, write one Playwright script and run it with node rather than driving the browser action-by-action with MCP tools — each MCP action costs a model round trip, so a ~25-action flow takes minutes vs ~5 seconds as a script. MCP tools are fine for one-off inspection of a page that's already up.

### Rex

- Sessions usually run in a Rex terminal, with `REX_SESSION` and `REX_BLOCK` set in the shell. For Rex tasks beyond opening a pane (sessions, tabs, reading terminal output, the server API), use the `rex` skill. The user may be viewing a different session or pane than yours.
- Don't rename Rex sessions or tabs. `ah` sets the titles.
- The user's usual layout: agent in a full-height left third, editor over a terminal on the right. When opening a pane next to yourself (the `panes` skill), split your own pane, usually above.

### Session cost

- When asked what the session has cost, call `mcp__session-cost__cost` (the `session-cost` mod in `claude/mods/`). The mobile app over remote control has no `/cost`.

### Misc. coding rules

- use `npm info` or similar to find the latest version of a package when adding
- Formatting: after any batch of edits, run the project's formatter before lint, typecheck, and tests. Most TS projects use `oxfmt`, not prettier. Check `package.json` scripts for the project's formatter before running one. Never run a formatter that isn't a project dep (e.g. `bunx prettier`): it uses default settings and reformats whole files.
- When explaining how third-party code works, cite sources the user can check, ideally GitHub permalinks to docs or code, otherwise other links online. What you remember about third-party internals is often wrong or out of date, so cite claims the user will rely on and anything that comes from memory rather than something you just read. Common knowledge doesn't need a citation. When including a GH permalink, use a 7 char short commit hash to keep the URL short — except in GitHub issue/PR bodies and comments, where the code embed only renders with the full hash.
- in scripts, prefer full length flags instead of abbreviations for readability
- When fixing a bug, prefer a red-green workflow where reasonable: write a failing test that reproduces the bug first, confirm it fails for the expected reason, then implement the fix and watch it go green.
- When giving a list of problems or suggestions in, e.g., a code review, number the suggestions so the user can refer to them easily.
- To show me an image (a screenshot, a plot, a render), run `open <path>` so it opens in Preview, rather than only giving the path. `open` is blocked in the sandbox, so run it unsandboxed.

### Working with GitHub

- When mentioning a PR or issue in a response to the user, render it as a clickable link (e.g., `[#4669](https://github.com/oxidecomputer/omicron/pull/4669)` or `[oxidecomputer/console#2573](https://github.com/oxidecomputer/console/issues/2573)`) rather than a bare number. This applies to chat responses, not to text written into files like commit messages, PR descriptions, or task notes — those follow the conventions of their destination.
- Don't hard-wrap Markdown meant for a GitHub issue, PR, or discussion body, a comment, or a review. GitHub renders every newline there as a line break, unlike `.md` files in a repo. Put each paragraph, list item, and blockquote on one line, including in `.claude/notes` drafts of such text.
- When given a GitHub link, instead of fetching the URL directly, use the `gh` CLI to fetch the same data in plaintext if possible
- For GitHub API calls, use `gh-api-read` rather than `gh api`: it rejects write operations, guaranteeing the call is read-only. Prefer its --jq flag over piping to jq. This substitution applies even when a skill, doc, or example shows a `gh api` command — those are written to be general; on this machine run them as `gh-api-read`.
- Use `aipr tracking 1234` to list the sub-issues of a tracking issue
- Use `aipr discussion 1234` to get all the comments on a PR
- When running in the repo under discussion, prefer local commands for looking at history over GitHub API calls that would fetch the same data.
- To make a PR from a jj repo, don't use `jprc`: it stops for interactive confirmation, which needs a terminal. Create a bookmark on the rev (`jj bookmark create <name> -r <rev>`), push it (`jj git push --bookmark <name>`), and run `gh pr create --head <name>` directly.

### Analysis and planning

When asked for analysis or planning (a possible feature, a design choice), write it as a markdown report if the user will keep working on it: it will take several rounds, outlast the session, or need their comments in the markdown editor. A question a chat reply answers well doesn't need one. Start the report as soon as you know it's needed, with the prompt or goal at the top, and fill it in as you go rather than at the end, so another session can pick it up if this one stops. Be thorough and consider alternative approaches explicitly, but don't give much space to ones that are obviously implausible. When asked to review or improve a design doc, engage with the design, not just the prose: the point is to produce a solid design and make the case for it. Once a first draft exists, open it with the `markdown` skill so we can iterate on it together, without asking first.

Markdown notes should go in `.claude/notes` relative to repo root. That directory is gitignored globally. Give the file a descriptive name and start it with a YYYY-MM-DD date. Because these files are unversioned, never reference them from checked-in files (skills, docs, code, commit messages) — the path is meaningless to anyone else and will eventually dangle even locally. Links to notes files belong only in other notes files or in chat.

When asked to write down something from the conversation in `.claude/notes` (e.g. "write that down", "save that as a note"), the note should be very close to verbatim what was said. If the explanation in chat was good, copy it nearly verbatim. Do not rewrite, reorganize, or summarize something that was already well-written — the conversation is the primary source and the note preserves it, lightly edited at most.

- Use the conversation's Q&A structure directly. The user's questions become blockquotes (`>`), the answers follow. Follow-up questions that drove the conversation forward become blockquote transitions between sections rather than invented headings.
- Blockquotes must use the user's actual words. Paraphrasing the user is fine, but not inside a blockquote.
- Light editing for flow is fine (dropping "Let me look at..." transitions), but preserve structure, tone, and level of detail. Prose stays prose; don't break it into bullets or add headings that weren't there.
- Keep concrete details: links, file paths with line numbers, code snippets, commands — the things that are hard to reconstruct later.
- Omit filler: no preamble, no "here's what we discussed," no meta-commentary about the note.

This applies to capturing conversation. Analysis reports written from scratch (above) follow their own structure.

### Task trackers

Keep task trackers with the `tracker` skill. A tracker is for when the user will want to come back to separate topics one at a time over later turns, and would otherwise have to scroll up or ask you to repeat yourself. Use judgment, not counts: two big questions can call for one, and five quick ones answered in full may not. Typical cases are a message that asks several things that each need their own discussion, work that spans several revs or sessions, and review findings the user will triage rather than have fixed all at once. Start one in those cases without asking. Don't start one for anything settled in this reply or the next, or for one piece of work the user follows from start to finish, however long it runs, like debugging a single bug. If the user asks for one along with an analysis report, write both: the analysis goes in the report, and the list of work goes in the tracker. If a current tracker fits, add items to it instead of starting another. If open topics pile up without one, offer it in a line.

When picking up work, check for an existing tracker first. "Tracker" always means this session's file in the ah dashboard: "make it the tracker" means show it there, and "the tracker" in chat is whatever the dashboard is showing for this session.
