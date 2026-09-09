---
name: cont
description: Cheaply continue a previous Claude Code chat in a fresh session. Use when the user says /cont, "continue the last chat", or "pick up where we left off" after a /clear or /new — instead of sending another message into a huge, now-uncached context. Finds the previous session in this project (or by topic), reads a compact digest, and carries on.
---

# cont

The user ended a long chat (often 100k+ tokens) and wants to keep going without
paying to re-read the whole thing. Do not `--resume` and do not read the whole
transcript. Get a digest, orient, and act on whatever the user asked.

## Steps

1. Run the finder. It prints the recap (every user message, truncated) plus the
   last few user messages and assistant replies in full-ish:

   ```
   ~/.claude/skills/cont/prev-session.sh
   ```

   - `ARGUMENTS` mentions a topic ("the chat about X"): pass `--topic "X"`.
   - `ARGUMENTS` contains a session id or transcript path: pass it positionally.
   - Otherwise no arguments: it takes the most recent transcript in this
     project directory that is not the current session.

2. Sanity-check the pick against `ARGUMENTS` and the last user message. If it
   looks like the wrong chat, say so in one line and rerun with `--topic` or the
   id from `~/.claude/skills/session-history/claude-sessions.sh list`. Do not
   silently continue the wrong conversation.

3. If the tail is not enough to act (e.g. the ending refers to a decision or a
   file you cannot see), pull just that piece with
   `claude-sessions.sh tail <path> assistant N` or `extract <path> assistant`
   piped through `grep`. Stay well under a few thousand tokens of digest;
   the whole point is to not reload the context.

4. State in one or two lines what the previous chat was doing and where it
   stopped, then do what `ARGUMENTS` asks (or, with no arguments, the obvious
   next step from the tail). If the previous chat ended with the assistant
   asking the user something, re-ask it briefly rather than guessing.

## Notes

- The helper skips the current session and sessions with no real user messages
  (a bare `/clear` creates one of those).
- Files edited in the previous chat are on disk and in `jj status` / `jj diff`;
  check those before assuming state from the transcript.
- For an end-of-chat note in the daily notes, use `/bot-note` after the digest;
  do not re-read the transcript for it.
