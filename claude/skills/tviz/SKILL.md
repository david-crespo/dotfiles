---
description: Todo assistant using tviz to query and work through Things 3 tasks
---

# tviz Todo Assistant

Use the `tviz` CLI to query the user's Things 3 todos and help them work through tasks. The user controls tviz (in `~/repos/things-viz`) and can modify it as needed.

## Task principles

- Tasks must be concrete next actions (not "plan party" but "email guests about date")
- 2-minute rule: do it now if quick, otherwise schedule it
- Today list is primary; review it each morning
- Weekly review: process inbox, check projects have next actions, simplify

## Available commands

### Things views

- `tviz today` - today's tasks (primary working view)
- `tviz inbox` - unprocessed items (empty daily)
- `tviz anytime` - tasks without schedule
- `tviz upcoming` - future scheduled tasks
- `tviz someday` - deferred/low priority

### Other tviz commands

- `tviz areas` - list all areas
- `tviz projects` - list all incomplete projects
- `tviz projects -c` - show only completed projects
- `tviz projects --all` - show all projects regardless of status
- `tviz projects -a <area>` - list projects in a specific area
- `tviz todos` - list all incomplete todos (short format, one line each)
- `tviz todos -a <area>` - filter by area
- `tviz todos -p <project>` - filter by project
- `tviz todos -s <text>` - search title and notes
- `tviz todos -d` - only items with deadlines
- `tviz todos -r <days>` - items modified in last N days
- `tviz todos -c -p <project>` - show completed items from a project
- `tviz todos --all -p <project>` - show all items from a project regardless of status
- `tviz todos -f pretty` - full detail with notes and checklists
- `tviz todos -f json` - JSON with uuid for linking
- `tviz done [area]` - list recently completed items

Default format is `short` (one line per item). Use `-f tsv` for token-efficient output with uuid and created date. Use `-f pretty` when user wants notes/checklists.

### Finding old items

To find the oldest todos (good for cleanup sessions):

```bash
tviz todos -f json | jq -r 'sort_by(.created) | .[0:30] | .[] | "\(.created[0:10]) \(.title)"'
```

### Context management

When analyzing verbose output (`-f pretty` or `-f json`), consider spawning a Task subagent to process the data and return a summary. This avoids consuming main conversation context on large outputs.

## Working with individual items

Get details on a specific item (todo, project, or area) by uuid:

```bash
tviz item <uuid>           # short format
tviz item <uuid> -f pretty # full details with notes/checklist
```

Output a clickable link to open in Things:

```bash
tviz link <uuid>
```

Get uuids from `-f tsv` or `-f json` output.

## GitHub commands

For checking status of issues and PRs referenced in todos:

- `gh issue view <issue> -R <owner>/<repo>` - view issue details
- `gh pr view <pr> -R <owner>/<repo>` - view PR details
- `aipr tracking -R <repo> <issue>` - view tracking issue with subissue status
- `aipr discussion -R <repo> <pr>` - view PR discussion/review status

## Things 3 concepts

**Areas** = ongoing life domains. **Projects** = completable goals with a clear end. If it
never ends (blog, software maintenance), it shouldn't be a project.

## How to evaluate items

Don't just list titles. Use `-f tsv` to get uuid, created date, and metadata, then evaluate based on:

- **Age and modified date**: Old items untouched for years may be stale, or may be important and neglected
- **Notes/checklists**: Use `tviz item <uuid> -f pretty` when you need to see notes or checklist status
- **Clustering**: Spot related items that could be consolidated or worked together
- **Reality check**: Does the thing still exist? Is the service still active? Did someone else handle it?
- **GitHub links**: Check PR/issue status for work items

Give concrete assessments: "this looks done", "these three are related", "still relevant but vague - what's the actual next action?"

Output `tviz link <uuid>` for items to modify so user can click through to Things.

## Workflows

### Daily review

1. Check `tviz today` - what's on the plate?
2. Check `tviz inbox` - process or defer everything
3. If today is light, pull from `tviz anytime`

### Triage session

Review items to decide: close, defer, clarify, or keep. Scope by area, project, age, or search.

1. Find candidates - options include:
   - Stale items: sort by modified date to find items untouched for a long time
   - Old items: sort by created date to find ancient todos
   - By area or project: focus on one domain
   - By search: find items mentioning a specific topic
2. Use `-f tsv` to get uuids and dates, fetch pretty format only when you need notes/checklists
3. Evaluate each item and give a recommendation
4. User makes changes in Things as you go

### Work through tasks

1. Start with `tviz today` or a specific project
2. Fetch full details, check linked issues/PRs
3. Help think through blockers, next actions, relevance
4. Move to the next one

### Deadline planning

1. Identify scope (project, area, or ad-hoc list)
2. Use GitHub commands to check status of referenced PRs/issues
3. Work through items: what needs to happen, in what order, by when?
4. User schedules start dates in Things so items surface in Today/Upcoming
