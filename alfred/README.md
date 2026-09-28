# Alfred workflows

The workflows I wrote myself live in `workflows/`. `install.sh` symlinks each directory into
Alfred's workflows folder, so Alfred runs these files directly. Third-party workflows stay
in Alfred's folder and aren't tracked here.

| Directory                | Keyword                       | What it does                                                                       |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| `details-wrap`           | `det`, `details wrap`         | Paste the clipboard wrapped in `<details>`, optional argument for the summary      |
| `github-link`            | `ghl`, `github link`          | Paste a clipboard GitHub issue/PR URL as `[repo#123](url)`                         |
| `google-meet`            | `meet`                        | Open Google Meet                                                                   |
| `say-last-claude-answer` | `say last`                    | Read the newest Claude Code answer aloud via `bin/say-last.ts`. Run again to stop. |
| `transform-text`         | `transform`, `transform text` | Rewrite the clipboard with `ai` per the instructions, then paste                   |

In `github-link`, repos owned by `oxidecomputer` and `david-crespo` get a bare `repo#123`
label, and everything else gets `owner/repo#123`.

Multiple keywords in one keyword field are separated by `||`
([Alfred 5.1+](https://www.alfredapp.com/help/workflows/advanced/keywords/)).

## How the linking works

Alfred keeps workflows in `<prefs folder>/workflows/user.workflow.<UUID>/`, where the prefs
folder is recorded under `current` in `~/Library/Application Support/Alfred/prefs.json`.
Each workflow has a line in `install.sh` that maps a repo directory to the UUID name Alfred
gave it:

```sh
link_alfred_workflow github-link 5A9D3432-44D4-4426-9F07-F1E110B822B8
```

If a real (non-symlink) directory already exists at the destination, `install.sh` skips it
with a warning instead of replacing it, so move it aside first. If Alfred isn't installed or
hasn't created its prefs folder yet, the whole block is skipped.

## Adding a workflow

1. Create it in Alfred Preferences (or write the `info.plist` by hand into a new
   `user.workflow.<UUID>` directory, with a UUID from `uuidgen`).
2. Move that directory into `workflows/<readable-name>`.
3. Add a `link_alfred_workflow <readable-name> <UUID>` line to `install.sh` and run it.

## Things to know

- Editing a workflow in Alfred's GUI writes straight into this repo, including cosmetic
  changes like dragging nodes around the canvas. jj snapshots those into whatever rev is
  checked out, so look at `jj status` after touching Alfred.
- Alfred doesn't notice edits made on the repo side, because it watches its own workflows
  folder and the edits happen behind the symlink. Quit and relaunch Alfred to pick them up:
  `osascript -e 'quit app "Alfred 5"' && sleep 1 && open -a "Alfred 5"`.
- `prefs.plist` (values for a workflow's user configuration fields, which can be secrets) is
  gitignored. Anything secret should go there, never in `info.plist`.
- Checking out a rev from before a workflow existed leaves a dangling link, so that workflow
  disappears from Alfred until you check out a later rev.
