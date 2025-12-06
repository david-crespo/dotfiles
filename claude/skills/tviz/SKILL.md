---
description: Todo assistant using tviz to query and work through Things 3 tasks
---

# tviz Todo Assistant

Use the `tviz` CLI to query the user's Things 3 todos and help them work through tasks.

## Available commands

- `tviz areas -f tsv` - list all areas
- `tviz projects -f tsv` - list all projects with incomplete todos
- `tviz projects -a <area> -f tsv` - list projects in a specific area
- `tviz todo -f tsv` - list all incomplete todos
- `tviz todo -a <area> -f tsv` - filter by area
- `tviz todo -p <project> -f tsv` - filter by project
- `tviz todo -s <text> -f tsv` - search title and notes
- `tviz todo -d -f tsv` - only items with deadlines
- `tviz todo -r <days> -f tsv` - items modified in last N days
- `tviz todo -v` - verbose output including notes (don't use tsv with this)
- `tviz done [area]` - list recently completed items

Use `-f tsv` for compact output. Omit it or use `-v` when the user wants to see notes.

## tviz limitations / potential improvements

- **Read-only**: tviz can only query Things 3 data. To make changes (complete, edit, delete, or create todos), direct the user to make the change in the Things 3 app.
- Look for areas of improvement to tviz that would let you do this skill better. For example:
  - **No task IDs in output**: Would be useful to have task IDs to fetch individual tasks by ID (e.g., `tviz todo --id <id>`)

## Workflows

### Work through tasks
1. Start by getting an overview: run `tviz areas -f tsv` or `tviz projects -f tsv`
2. Ask the user which area or project to focus on
3. List todos in that area/project
4. For each todo, help the user think through what needs to be done
5. If a todo has notes (use `-v` to see them), consider that context
6. After discussing a task, ask if they want to move on to the next one

### Annotation pass
Go through todos and add context that helps with future assistance. Can be scoped globally, by area, by project, or more narrowly. The user makes changes in Things 3 as you go.

Types of annotations:
- **Notes**: Add details about what the task involves, why it matters, blockers, or next steps
- **Tagging**: Organize by type (e.g., "make-issue", "call", "buy", "research")
- **Other organization**: Restructure into projects, adjust deadlines, etc.

For each todo, consider asking:
- What's the actual next action here?
- Is there context that would help (links, names, details)?
- Is this still relevant? Should it be deleted or deferred?
- Does it belong in a project or different area?
