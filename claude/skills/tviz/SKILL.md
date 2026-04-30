---
name: tviz
description: How to use the tviz CLI to read and write Things 3 tasks
---

# tviz

Reference for using `tviz` to read and write Things 3 tasks.

## Things 3 concepts

**Areas** are ongoing life domains (Career, Health, Home). They never complete.

**Projects** are completable goals with a clear end state. If it never ends, it's not a project—it's an area or ongoing responsibility.

**Someday** is for genuine future possibilities, not a graveyard for items you're afraid to cancel.

Tasks should be concrete next actions. Not "plan party" but "email guests about date." If it's vague, work with the user to break it down.

## Commands

Run `tviz --help` for full reference. Key commands:

```bash
tviz today                    # primary working view
tviz inbox                    # process daily
tviz todos -a <area>          # filter by area
tviz todos -p <project>       # filter by project
tviz todos -f tsv             # uuid + created date + stop_date, token-efficient
tviz todos -f pretty          # full notes and checklists
tviz logbook                  # recently completed items (default 50)
tviz logbook -a Oxide -n 100  # filter by area, increase limit
tviz item <uuid> -f pretty    # details on one item
tviz link <uuid>              # clickable Things link (use this!)
```

Tips:

- Always use `-f tsv` first to get uuids and dates; only fetch `-f pretty` when you need notes
- When referencing a task, output the title and the link separately (markdown links don't render in the terminal): "Task title — things:///show?id=uuid". Use the full original title so the user can search Things for it.
- Find oldest items: `tviz todos -f json | jq -r 'sort_by(.created) | .[0:20] | .[] | "\(.created[0:10]) \(.title)"'`
- Check GitHub status with `gh issue view` / `gh pr view` or `aipr tracking` / `aipr discussion`
- For large outputs, spawn a Task subagent to process and summarize

## Write commands

Create commands are allowlisted. Update commands are in `ask` permission, so
the user will be prompted before each one runs.

```bash
# Create a todo
tviz add todo "Buy groceries" --area Life
tviz add todo "Fix login bug" --project "Auth redesign" --when today
tviz add todo "Review PR" --project "Auth redesign" --heading "Code review" --deadline 2026-04-01
echo "Detailed notes here" | tviz add todo "Research options" --area Oxide

# Create a project
tviz add project "Kitchen renovation" --area Home
tviz add project "Q2 planning" --area Oxide --deadline 2026-04-15

# Update an existing item (todo or project, same command)
tviz update <uuid> --title "New title"
tviz update <uuid> --completed
tviz update <uuid> --canceled
tviz update <uuid> --when today --deadline 2026-04-01
tviz update <uuid> --append-notes "Additional context"
tviz update <uuid> --add-tags "urgent,blocked"
```

Notes for create commands can be piped via stdin. The `--project` flag on
`add todo` selects by project name; if the project doesn't exist, Things
silently puts the item in the inbox. Update works on both todos and projects
— it just needs the UUID.

`--append-notes` and `--prepend-notes` automatically add a blank line of
separation, so just write the new content without leading/trailing newlines.

Use plain URLs in Things item notes, not markdown links — Things 3 doesn't
render markdown, so `[text](url)` shows as raw bracket syntax. A bare URL
like `https://github.com/oxidecomputer/omicron/pull/4669` becomes a
clickable link automatically.
