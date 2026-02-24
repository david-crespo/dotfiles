---
name: alfred-workflow
description: Create or modify Alfred workflows by writing info.plist files directly
---

## Workflow location

Alfred workflows live in `~/Library/Application Support/Alfred/Alfred.alfredpreferences/workflows/`.
Each workflow is a directory named `user.workflow.<UUID>` containing an `info.plist`.

## Creating a workflow

1. Generate a UUID for the directory name: `uuidgen`
2. Generate a UUID for each object (keyword input, script action, notification output, etc.)
3. Write `info.plist` with the structure below
4. Validate with `plutil -lint <path>`
5. Alfred picks up new workflows automatically (may need to close/reopen preferences)

## Plist structure

An `info.plist` defines:

- **`objects`**: Array of workflow nodes, each with a `type`, `uid`, `config`, and `version`
- **`connections`**: Dict mapping source UIDs to arrays of `{destinationuid, modifiers, modifiersubtext, vitoclose}` dicts
- **`uidata`**: Dict mapping UIDs to `{xpos, ypos}` for canvas layout (space nodes ~230px apart horizontally)
- **`name`**, **`description`**, **`bundleid`**: Workflow metadata

## Common object types

**Keyword input** (`alfred.workflow.input.keyword`, version 1):
- `keyword`: the trigger word
- `argumenttype`: 0 = required, 1 = optional, 2 = none
- `text`: display title in Alfred results
- `subtext`: subtitle text
- `withspace`: true to allow space before argument

**Run Script** (`alfred.workflow.action.script`, version 2):
- `script`: the script body (XML-escaped)
- `type`: 0 = bash, 5 = zsh
- `scriptargtype`: 0 = input as `{query}` in script, 1 = input as argv (`$1` in bash, `$argv` in zsh)
- `escaping`: bitmask (102 = spaces+tilde+backslashes+double quotes, does not escape `$`)
- `concurrently`: false for sequential execution
- `scriptfile`: empty string for inline scripts

**Post Notification** (`alfred.workflow.output.notification`, version 1):
- `title`: notification title
- `text`: notification body (use `{query}` for script output)
- `lastpathcomponent`: false
- `removeextension`: false

**Clipboard** (`alfred.workflow.output.clipboard`, version 3):
- `clipboardtext`: text to copy (use `{query}`)
- `autopaste`: true to paste immediately
- `transient`: true to not save in clipboard history

**Open URL** (`alfred.workflow.action.openurl`, version 1):
- `url`: the URL to open
- `browser`: bundle ID (e.g., `com.google.Chrome`) or empty for default

## Reference workflows

Existing workflows to study for patterns:
- `user.workflow.CF67E427-2764-4E80-8A14-50E9E23CAC2A` — Google Meet (simple keyword → open URL)
- `user.workflow.A0DC9B64-8694-4A42-B13B-15D6EEDD9691` — Transform selected text (hotkey + keyword → script → clipboard, uses variables)
- `user.workflow.FE496108-4453-4225-87DD-C457FD27420C` — Details Wrap (keyword → script → notification)

## Tips

- List existing workflows: `for d in ~/Library/Application\ Support/Alfred/Alfred.alfredpreferences/workflows/*/; do /usr/libexec/PlistBuddy -c "Print :name" "$d/info.plist" 2>/dev/null; done`
- Read a workflow's script: `/usr/libexec/PlistBuddy` or just `Read` the info.plist
- XML-escape `<` and `>` in script bodies as `&lt;` and `&gt;`
