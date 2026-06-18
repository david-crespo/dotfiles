---
name: rfd
description: Read Oxide RFD contents, metadata, and images by number using rfd-cli. Use when an RFD comes up (e.g. "RFD 63", "what does the networking RFD say") and you need the actual text.
---

# RFD

Oxide RFDs live in the `oxidecomputer/rfd` repo, but each RFD's content sits on
its own branch, so the local clone (`~/oxide/rfd`) can't be grepped as a flat
tree. The canonical source is the RFD API, which `rfd-cli` talks to. Prefer
`rfd-cli` over poking at the repo.

`rfd-cli` is installed at `~/.local/bin/rfd-cli` (invoke as `rfd-cli`, not
`rfd`). All commands take `-f json` implicitly when piped; output is JSON.

## Get an RFD's contents

```bash
rfd-cli view --number 63 | jq -r '.content'
```

`.content` is the canonical raw AsciiDoc (the only content field — `view`
returns it once; `meta` is the same record minus `.content`). It begins with the
`:key: value` attribute block and the `= RFD N Title` heading.

Useful metadata fields on the same record: `.title`, `.state`, `.authors`,
`.discussion` (PR URL), `.link` (GitHub tree URL at the rendered commit), and
`.commit` (the commit SHA the content was rendered from — needed for images).

```bash
rfd-cli view --number 63 | jq '{title, state, authors, discussion, link, commit}'
```

## Search

Search hits the RFD index (Meilisearch) and returns section-level results —
reasonable for finding which RFD/section discusses a topic, then `view` it.

```bash
rfd-cli search --q "boundary services" --limit 10 \
  | jq -r '.hits[] | "RFD \(.rfd_number) [#\(.anchor)] \(.hierarchy | map(select(.)) | join(" > "))"' \
  | sort -u
```

Each hit also has `.content` (the matching passage) and `.formatted.content`
(same, with `<em>` around matched terms). It's keyword search, not semantic —
try a few phrasings.

## List

```bash
rfd-cli list | jq -r '.[] | "\(.rfd_number)\t\(.state)\t\(.title)"' | sort -n
```

## Images

RFD AsciiDoc references images with `image::filename[]` (or `image:filename[]`
inline). The files aren't in the API response; they live next to the RFD in the
repo at `rfd/NNNN/filename` (zero-padded to 4 digits). Fetch them from the local
clone at the exact commit the API rendered (`.commit`), then Read the file:

```bash
# find image refs
rfd-cli view --number 63 | jq -r '.content' | rg 'image::?'

# extract one at the rendered commit
sha=$(rfd-cli view --number 63 | jq -r '.commit')
git -C ~/oxide/rfd show "$sha:rfd/0063/l3.png" > /tmp/rfd63-l3.png
```

Then Read `/tmp/rfd63-l3.png` to view it.

If `git show` fails with "bad object", the commit isn't fetched locally yet —
`git -C ~/oxide/rfd fetch origin` and retry. Access to private RFD images is
just the user's normal repo access; there's no separate image auth to deal with
when going through the local clone.
