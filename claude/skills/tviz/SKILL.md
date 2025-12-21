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

Default format is `short` (one line per item). Use `-f pretty` when user wants notes/checklists.

## GitHub commands

For checking status of issues and PRs referenced in todos:

- `gh issue view <issue> -R <owner>/<repo>` - view issue details
- `gh pr view <pr> -R <owner>/<repo>` - view PR details
- `aipr tracking -R <repo> <issue>` - view tracking issue with subissue status
- `aipr discussion -R <repo> <pr>` - view PR discussion/review status

## Things 3 concepts

**Areas** = ongoing life domains. **Projects** = completable goals with a clear end. If it
never ends (blog, software maintenance), it shouldn't be a project.

## Workflows

### Daily review

1. Check `tviz today` - what's on the plate?
2. Check `tviz inbox` - process or defer everything
3. If today is light, pull from `tviz anytime`

### Work through tasks

1. Start with `tviz today`
2. For each task, check linked issues/PRs with GitHub commands
3. If a todo needs more detail, use `tviz todos -s <text> -f pretty`
4. Help user think through blockers, next actions, whether it's still relevant
5. After discussing, ask if they want to move on to the next one

### Annotation pass

Go through todos and add context. Can be scoped by area, project, or more narrowly.
The user makes changes in Things 3 as you go. For each todo, consider:

- What's the actual next action here?
- Is there context that would help (links, names, details)?
- Is this still relevant? Should it be deleted or deferred?
- Does it belong in a project or different area?

### Deadline planning

1. Identify scope (project, area, or ad-hoc list)
2. Use GitHub commands to check status of referenced PRs/issues
3. Work through items: what needs to happen, in what order, by when?
4. User schedules start dates in Things so items surface in Today/Upcoming
