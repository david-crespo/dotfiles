---
description: Todo assistant using tviz to query and work through Things 3 tasks
---

# tviz Todo Assistant

Use the `tviz` CLI to query the user's Things 3 todos and help them work through tasks.

## Available commands

- `tviz areas` - list all areas
- `tviz projects` - list all incomplete projects
- `tviz projects -c` - show only completed projects
- `tviz projects --all` - show all projects regardless of status
- `tviz projects -a <area>` - list projects in a specific area
- `tviz todo` - list all incomplete todos (short format, one line each)
- `tviz todo -a <area>` - filter by area
- `tviz todo -p <project>` - filter by project
- `tviz todo -s <text>` - search title and notes
- `tviz todo -d` - only items with deadlines
- `tviz todo -r <days>` - items modified in last N days
- `tviz todo -c -p <project>` - show completed items from a project
- `tviz todo --all -p <project>` - show all items from a project regardless of status
- `tviz todo -f pretty` - full detail with notes and checklists
- `tviz done [area]` - list recently completed items

Default format is `short` (one line per item). Use `-f pretty` when user wants notes/checklists.

## GitHub commands

For checking status of issues and PRs referenced in todos:

- `gh issue view <issue> -R <owner>/<repo>` - view issue details
- `gh pr view <pr> -R <owner>/<repo>` - view PR details
- `aipr tracking -R <repo> <issue>` - view tracking issue with subissue status
- `aipr discussion -R <repo> <pr>` - view PR discussion/review status

## tviz limitations / potential improvements

- **Read-only**: tviz can only query Things 3 data. To make changes (complete, edit, delete,
  or create todos), direct the user to make the change in the Things 3 app.
- **No task IDs in output**: Would be useful to have task IDs to fetch individual tasks by
  ID (e.g., `tviz todo --id <id>`)

## Things 3 philosophy

**Areas** = ongoing life domains. **Projects** = completable goals with a clear end. If it
never ends (blog, software maintenance), it shouldn't be a project.

**Today/Upcoming views** are meant to be primary. Todos without start dates never surface
there, forcing you into Area views where projects are collapsed. The fix: schedule things.

## Workflows

### Work through tasks

1. Start by getting an overview: run `tviz areas` or `tviz projects`
2. Ask the user which area or project to focus on
3. List todos in that area/project
4. For each todo, help the user think through what needs to be done
5. If a todo needs more detail, use `-f pretty` to see notes and checklists
6. After discussing a task, ask if they want to move on to the next one

### Annotation pass

Go through todos and add context that helps with future assistance. Can be scoped globally,
by area, by project, or more narrowly. The user makes changes in Things 3 as you go.

Types of annotations:

- **Notes**: Add details about what the task involves, why it matters, blockers, or next
  steps
- **Tagging**: Organize by type (e.g., "make-issue", "call", "buy", "research")
- **Other organization**: Restructure into projects, adjust deadlines, etc.

For each todo, consider asking:

- What's the actual next action here?
- Is there context that would help (links, names, details)?
- Is this still relevant? Should it be deleted or deferred?
- Does it belong in a project or different area?

### Deadline planning

Help schedule tasks for a deadline:

1. Identify scope (project, area, or ad-hoc list)
2. Use GitHub commands to check status of referenced PRs/issues
3. Work through items: what needs to happen, in what order, by when?
4. User schedules start dates in Things so items surface in Today/Upcoming
