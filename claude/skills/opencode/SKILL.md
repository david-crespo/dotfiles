---
name: opencode
description: How to delegate a task to an opencode pseudo-subagent (default model Kimi K2.6). Use ONLY when the user explicitly invokes /opencode or names opencode by name — not for general subagent or delegation requests.
---

# opencode

`opencode run` is the `claude -p` equivalent: a one-shot prompt to a full agent
(file/bash/grep tools, runs in cwd). Use it to delegate self-contained tasks to a
cheaper model. Default model is always `opencode/kimi-k2.6` (OpenCode Zen-hosted,
cheap and capable) unless the user specifies another.

## Invocation

```bash
opencode run -m opencode/kimi-k2.6 --dangerously-skip-permissions "<task>"
```

- `--dangerously-skip-permissions` is required: the run is non-interactive, so any
  `ask` permission would hang forever waiting for approval.
- Pass a complete, self-contained task — the subagent shares no context with this
  session. Spell out files, goal, and what to return.
- This default (no `--agent`) is the **full** tier: read, edit, bash, everything.

## Tiers (capability control)

Restricted tiers are named agents that pin the model to kimi-k2.6 and remove tools.
Select with `--agent`:

| Tier | Invoke | Can | Cannot |
|------|--------|-----|--------|
| full | (no `--agent`) | read, edit, bash, spawn subagents | — |
| edit | `--agent oc-edit` | read, search, edit files, webfetch | run shell, spawn subagents |
| explore | `--agent oc-explore` | read, search, browse the web | edit, run shell, spawn subagents |

```bash
opencode run --agent oc-explore --dangerously-skip-permissions "<read-only task>"
opencode run --agent oc-edit    --dangerously-skip-permissions "<edit task, no shell>"
```

The tier files live in `opencode/agent/*.md` in the dotfiles repo (symlinked to
`~/.config/opencode/agent/` by install.sh). To add/change a tier, edit those and
rerun install.sh. Note: locking down a tier requires denying `task` too — otherwise
the agent escapes its sandbox by spawning a default subagent that has the tools back.

## Other models

Override the model with `-m <provider>/<model>` (e.g. `-m google/…`, `-m openai/…`).
`opencode models` lists options; `opencode auth list` shows authed providers. `-m`
overrides a tier's baked-in model.

## Notes

- Default output prepends a `> <agent> · <model>` banner. For machine-readable
  output add `--format json`.
- Review the subagent's work like any subagent's — it's a separate, cheaper model.
