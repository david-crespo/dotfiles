---
name: shellout
description: How to delegate a self-contained task to a cheaper pseudo-subagent via `codex exec` (OpenAI models; default gpt-5.6-sol). Use ONLY when the user explicitly invokes /shellout or names codex as the runner — not for general subagent or delegation requests.
---

# shellout: codex as a pseudo-subagent

Anthropic's cheaper models are not cost-effective for subagent work, so this skill
delegates self-contained tasks to a one-shot `codex exec` run: a full agent with
file, search, and shell tools that runs in cwd, takes one prompt, and prints a
final answer. It is the `claude -p` equivalent.

## Invocation

```bash
codex exec -m <model> -s <sandbox> --color never "<task>"
```

- **Sandbox** (`-s`) bounds what the run can do at the OS level (seatbelt on macOS):
  - `read-only`: read, search, run read-only commands. Use for analysis and review.
  - `workspace-write`: also edit files and run commands, writes confined to cwd.
    Use for implementation. The run does not prompt for approval.
  - `danger-full-access`: no sandbox. Avoid unless the task truly needs it.
- Pass a complete, self-contained task. The run shares no context with this
  session: spell out files, goal, constraints, and what to return.
- Add `-C <dir>` to run in another directory, `--skip-git-repo-check` outside a
  git repo, and `--ephemeral` to skip saving the session (not if you may want to
  resume or price it later). Redirect stdin from `/dev/null` so codex does not
  wait on it.
- The user's codex hooks print `hook: ...` lines; ignore them. The final message
  is repeated at the end of stdout. For clean output use `-o <file>` (last
  message only) or `--json` (JSONL events).
- Review the result like any subagent's work.

## Multi-turn: follow up on the same thread

The run is one-shot, but the thread persists. Reuse it to give feedback,
redirect, or ask codex to act on an analysis it just produced, without
re-explaining the task. This is the SendMessage equivalent for codex.

To capture the thread id, run the first turn with `--json` and read it from the
first event, which is `{"type":"thread.started","thread_id":"..."}`:

```bash
codex exec --json -m <model> -s <sandbox> -o "$TMPDIR/codex-last.md" "<task>" \
  > "$TMPDIR/codex-events.jsonl" </dev/null
head -1 "$TMPDIR/codex-events.jsonl" | jq -r .thread_id
cat "$TMPDIR/codex-last.md"
```

Then continue with:

```bash
codex exec resume <THREAD_ID> -m <model> -o "$TMPDIR/codex-last.md" "<follow-up>"
```

Always repeat `-m` on resume. The model is NOT inherited from the thread: without
`-m` it falls back to the config default (`gpt-6-astra`), which is 50x luna's
price. The sandbox is inherited and `resume` has no `-s` flag. `codex exec
resume --last` picks the most recent thread in cwd when the id was not captured.
`codex exec fork <THREAD_ID> "<prompt>"` branches a thread to try an alternative
without disturbing the original.

## Cost

Report the cost after each turn, or at least at the end of the session:

```bash
bun ~/repos/dotfiles/codex/cost.ts <THREAD_ID>
# Token cost ≈ $0.01 this turn · $0.31 session
```

This reads the thread's rollout under `~/.codex/sessions` using the same pricing
table as the user's codex Stop hook (which does not fire for `codex exec`). The
`turn.completed` usage in the `--json` output is cumulative for the thread on
resumed turns, so don't price it per turn by hand.

Nothing meaningful is lost by ending the process between turns: the history is
replayed from disk, so the model sees the same prefix and server-side prompt
caching still applies if the follow-up comes within the cache window.

## Running from Claude Code

`codex` fails inside the Claude Code bash sandbox (it cannot start its app-server),
so run it with the sandbox bypass. Prefer `-s read-only` when the task allows,
since codex's own sandbox is then the only boundary.

## Models

The user usually names the model when invoking the skill. Otherwise use
`gpt-5.6-sol`. Prices per 1M tokens (in / out), as of 2026-09:

| Model | In | Out | Use for |
|-------|----|-----|---------|
| `gpt-5.6-sol` | $4.00 | $20.00 | default; ~40% of Fable's price, clearly strongest of the three |
| `gpt-5.6-terra` | $2.00 | $12.00 | routine code tasks where sol's judgment isn't needed |
| `gpt-5.6-luna` | $0.20 | $1.20 | bulk read-only exploration and summaries |

`gpt-6-astra` ($10 / $50) is the top model and rarely worth it over running the
task in this session.
