// Task and state-variant definitions for the release-notes curation eval.
//
// A Task is one question asked about one dataset row. The same criteria text
// feeds both runners: Typesafe gets it as `instructions` + `criteria`, `ai`
// gets it rendered into a system prompt by `renderSystemPrompt`. Keep the
// wording in one place so the model is the only variable.

export type Placement =
  | "dropped"
  | "own_bullet"
  | "consolidated"
  | "small_ui_fixes"
  | "prose"

export interface Row {
  release: number
  tag_range: string
  sha: string
  date: string
  subject: string
  title: string
  pr: number | null
  prefix: string | null
  placement: Placement
  kept: boolean
  bullet_text: string | null
  bullet_prs: number[] | null
  bullet_pr_count: number | null
  body: string | null
  labels: string[]
  files_changed: number | null
  additions: number | null
  deletions: number | null
  pr_title: string | null
  /** Git-derived, see build-release-notes-dataset.ts. Absent on old datasets. */
  changed_files?: string[]
  path_mix?: {
    app: number
    generated: number
    infra: number
    other: number
    total_lines: number
  }
  diff_comments?: string[]
}

export type QuestionKind = "choice" | "noul"

export interface Task {
  name: string
  kind: QuestionKind
  /** The question. Shared verbatim by both runners. */
  instructions: string
  /** Option name -> description. For noul the keys are "true" and "false". */
  criteria: Record<string, string>
  /** Ground-truth option name for a row. */
  label: (row: Row) => string
  /** Optional collapse of fine labels to keep / drop, for derived binary metrics. */
  collapse?: (label: string) => "keep" | "drop"
  /** ArkType schema string for `ai -o`. */
  aiSchema: string
}

const CONTEXT = `You are curating the web console section of an Oxide system release note. \
The state describes one commit (a squash-merged pull request) to the \
oxidecomputer/console repo, landed between two console release tags. The \
audience is rack operators and console users; the changelog lists what changed \
for them.`

const DROP = `Not mentioned in the release notes at all. Internal-only work: \
dependency bumps and npm audit fixes; chore, refactor, trivial, or cleanup \
commits; tooling and scripts; CI; test infrastructure, flaky-test fixes, \
visual-regression cleanup, mock API helpers; linter, formatter, or test-framework \
migrations with no visible UX change; API version bumps that only keep up with \
the backend; CLAUDE.md, AGENTS.md, or README edits; design-system version bumps \
with no visible change.`

const SMALL_UI_FIX = `A user-visible fix too small for its own bullet, grouped \
into a single "Many small UI fixes" line: badge colors, header borders, spacing, \
form copy tweaks, animation fixes, tooltip wording, minor layout glitches. The \
test is that a user might notice the change but it does not merit a headline.`

const NOTABLE = `Gets its own bullet, or is one part of a named feature bullet: \
new pages or features, user-visible behavior changes, notable bug fixes, config \
or limit changes that affect users (max CPUs, max disks), changes to what users \
can see or do in the console.`

const KEEP = `Mentioned in the release notes, either as its own bullet, as part of \
a named feature bullet, or grouped into a "Many small UI fixes" line. ${NOTABLE} \
Also: ${SMALL_UI_FIX}`

// Revised criteria (the "b" tasks). Each clause targets a category from the
// 2026-09-17 error taxonomy: API shape adaptations and mock-only changes with
// feature-shaped titles; UI hidden "for now" (and the commit that added it);
// sweeping copy changes that got their own bullet.
const DROP_B = `${DROP} Also internal: adapting the console to a backend API \
shape change or a new API field with no user-visible result; changes only to \
the mock API, test fixtures, or e2e tests; and commits that remove, hide, \
disable, or comment out UI "for now" or pending a backend fix. When a later \
commit in the same release removes or hides UI that this commit added, the \
feature did not ship and this commit is also dropped.`

const SMALL_UI_FIX_B = `${SMALL_UI_FIX} A small fix is confined to one spot; \
copy, wording, or layout changes applied across many screens at once are \
notable rather than small.`

const NOTABLE_B = `${NOTABLE} Also notable: a copy, wording, or layout change \
applied consistently across many screens; a fix for a bug users would have hit \
in production even if the fix itself is a one-line config or path change.`

const KEEP_B = `Mentioned in the release notes, either as its own bullet, as part of \
a named feature bullet, or grouped into a "Many small UI fixes" line. ${NOTABLE_B} \
Also: ${SMALL_UI_FIX_B}`

// "c": same as "b" but the hidden-UI clause no longer says "remove" or
// "disable". On the b runs those words dropped real features ("Turn read-only
// disks back on", "Disable ephemeral IP attach button instead of hiding").
const DROP_C = `${DROP} Also internal: adapting the console to a backend API \
shape change or a new API field with no user-visible result; changes only to \
the mock API, test fixtures, or e2e tests; and hiding or commenting out UI \
"for now" because the backend feature is not ready. When a later commit in the \
same release hides UI that this commit added, the feature did not ship and \
this commit is also dropped.`

const KEEP_C = `Mentioned in the release notes, either as its own bullet, as part of \
a named feature bullet, or grouped into a "Many small UI fixes" line. ${NOTABLE_B} \
Also: ${SMALL_UI_FIX_B}`

export const TASKS: Record<string, Task> = {
  keep3c: {
    name: "keep3c",
    kind: "choice",
    instructions: `${CONTEXT} How should this commit be treated in the changelog?`,
    criteria: { drop: DROP_C, small_ui_fix: SMALL_UI_FIX_B, notable: NOTABLE_B },
    label: (row) =>
      row.placement === "dropped"
        ? "drop"
        : row.placement === "small_ui_fixes"
        ? "small_ui_fix"
        : "notable",
    collapse: (label) => (label === "drop" ? "drop" : "keep"),
    aiSchema: "'drop'|'small_ui_fix'|'notable'",
  },
  keep2c: {
    name: "keep2c",
    kind: "choice",
    instructions: `${CONTEXT} Should this commit be mentioned in the changelog?`,
    criteria: { drop: DROP_C, keep: KEEP_C },
    label: (row) => (row.kept ? "keep" : "drop"),
    collapse: (label) => (label === "drop" ? "drop" : "keep"),
    aiSchema: "'drop'|'keep'",
  },
  keep3b: {
    name: "keep3b",
    kind: "choice",
    instructions: `${CONTEXT} How should this commit be treated in the changelog?`,
    criteria: { drop: DROP_B, small_ui_fix: SMALL_UI_FIX_B, notable: NOTABLE_B },
    label: (row) =>
      row.placement === "dropped"
        ? "drop"
        : row.placement === "small_ui_fixes"
        ? "small_ui_fix"
        : "notable",
    collapse: (label) => (label === "drop" ? "drop" : "keep"),
    aiSchema: "'drop'|'small_ui_fix'|'notable'",
  },
  keep2b: {
    name: "keep2b",
    kind: "choice",
    instructions: `${CONTEXT} Should this commit be mentioned in the changelog?`,
    criteria: { drop: DROP_B, keep: KEEP_B },
    label: (row) => (row.kept ? "keep" : "drop"),
    collapse: (label) => (label === "drop" ? "drop" : "keep"),
    aiSchema: "'drop'|'keep'",
  },
  keep3: {
    name: "keep3",
    kind: "choice",
    instructions: `${CONTEXT} How should this commit be treated in the changelog?`,
    criteria: { drop: DROP, small_ui_fix: SMALL_UI_FIX, notable: NOTABLE },
    label: (row) =>
      row.placement === "dropped"
        ? "drop"
        : row.placement === "small_ui_fixes"
        ? "small_ui_fix"
        : "notable",
    collapse: (label) => (label === "drop" ? "drop" : "keep"),
    aiSchema: "'drop'|'small_ui_fix'|'notable'",
  },
  keep2: {
    name: "keep2",
    kind: "choice",
    instructions: `${CONTEXT} Should this commit be mentioned in the changelog?`,
    criteria: { drop: DROP, keep: KEEP },
    label: (row) => (row.kept ? "keep" : "drop"),
    collapse: (label) => (label === "drop" ? "drop" : "keep"),
    aiSchema: "'drop'|'keep'",
  },
  keep_noul: {
    name: "keep_noul",
    kind: "noul",
    instructions: `${CONTEXT} Should this commit be mentioned in the changelog?`,
    criteria: { true: KEEP, false: DROP },
    label: (row) => (row.kept ? "true" : "false"),
    collapse: (label) => (label === "true" ? "keep" : "drop"),
    aiSchema: "boolean",
  },
}

/** Render the task as a system prompt for `ai`, using the same wording. */
export function renderSystemPrompt(task: Task): string {
  const options = Object.entries(task.criteria)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join("\n")
  const answerLine = task.kind === "noul"
    ? "Answer true or false."
    : `Answer with exactly one option name: ${Object.keys(task.criteria).join(", ")}.`
  return `${task.instructions}\n\nThe user message is a JSON object describing the commit.\n\nOptions:\n${options}\n\n${answerLine}`
}

// --- state variants ---------------------------------------------------------

export type StateFn = (row: Row, all: Row[]) => unknown

const MAX_BODY = 1500

/** Strip the noisy HTML that PR bodies carry (screenshots, dependabot details). */
function cleanBody(body: string | null): string | null {
  if (!body) return null
  const cleaned = body
    .replace(/<details>[\s\S]*?<\/details>/gi, "")
    .replace(/<img[^>]*>/gi, "[screenshot]")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return cleaned.length > MAX_BODY ? cleaned.slice(0, MAX_BODY) + "…" : cleaned
}

/** Words worth matching between titles: lowercased, 4+ letters, not a stopword. */
const STOP = new Set(
  "with from that this into when only also more some them then than make sure fix fixes fixed remove add adds added update updates updated page pages form forms table tables list button modal minor tools chore trivial refactor bump bumps create delete show hide switch tweak change changes field fields view allow should where after before"
    .split(" "),
)
const keywords = (title: string) =>
  new Set(
    title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) =>
      w.length >= 4 && !STOP.has(w)
    ),
  )

/** Titles of commits that landed after `row` in the same release and share a
 * keyword with it. Rows are in git log order (newest first) within a release,
 * so "later" means a smaller index. This is what lets a model see "Remove read
 * only disk checkbox" while judging "Read only disks". */
function laterRelated(row: Row, all: Row[]): string[] {
  const kw = keywords(row.title)
  if (kw.size === 0) return []
  const idx = all.findIndex((r) => r.sha === row.sha)
  return all
    .slice(0, idx)
    .filter((r) => r.release === row.release)
    .filter((r) => [...keywords(r.title)].some((w) => kw.has(w)))
    .map((r) => r.title)
    .slice(0, 10)
}

/** How the previous release's commits were treated, as calibration. The vN-1
 * notes exist when vN is being written, so this is available for real. */
function previousRelease(row: Row, all: Row[]) {
  const prev = all.filter((r) => r.release === row.release - 1)
  if (prev.length === 0) return null
  const label = (r: Row) => r.placement === "small_ui_fixes" ? "small_ui_fix" : "notable"
  return {
    note: `How every commit in the previous release (console v${
      row.release - 1
    }) was treated in its release notes; use it to calibrate the threshold.`,
    kept_notable: prev.filter((r) => r.kept && label(r) === "notable").map((r) => r.title),
    kept_small_ui_fix: prev.filter((r) => r.kept && label(r) === "small_ui_fix").map((r) =>
      r.title
    ),
    dropped: prev.filter((r) => !r.kept).map((r) => r.title),
  }
}

const titleBody = (row: Row) => ({
  commit_title: row.title,
  pr_body: cleanBody(row.body),
  labels: row.labels,
  files_changed: row.files_changed,
  additions: row.additions,
  deletions: row.deletions,
})

const diffPart = (row: Row) => ({
  comment_lines_added_in_diff: row.diff_comments ?? [],
})

const pathsPart = (row: Row) => ({
  changed_files: (row.changed_files ?? []).slice(0, 25),
  changed_lines_share: row.path_mix
    ? {
      app_code: row.path_mix.app,
      generated_api_client: row.path_mix.generated,
      mock_test_tooling: row.path_mix.infra,
      other: row.path_mix.other,
    }
    : null,
})

const laterPart = (row: Row, all: Row[]) => ({
  later_commits_in_same_release_on_same_topic: laterRelated(row, all),
})

const prevPart = (row: Row, all: Row[]) => ({
  previous_release: previousRelease(row, all),
})

export const STATES: Record<string, StateFn> = {
  /** title_body plus added comment lines from the diff. */
  title_body_diff: (row) => ({ ...titleBody(row), ...diffPart(row) }),

  /** title_body plus changed file paths and the app/generated/infra line split. */
  title_body_paths: (row) => ({ ...titleBody(row), ...pathsPart(row) }),

  /** title_body plus later same-release commits sharing a keyword. */
  title_body_later: (row, all) => ({ ...titleBody(row), ...laterPart(row, all) }),

  /** title_body plus how the previous release's commits were treated. */
  title_body_prev: (row, all) => ({ ...titleBody(row), ...prevPart(row, all) }),

  /** Everything a local pre-pass could have: body, diff comments, paths,
   * later related commits, previous release. */
  full: (row, all) => ({
    ...titleBody(row),
    ...diffPart(row),
    ...pathsPart(row),
    ...laterPart(row, all),
    ...prevPart(row, all),
  }),

  /** Commit title only. The cheapest variant and the baseline. */
  title: (row) => ({ commit_title: row.title }),

  /** Title plus PR body, labels, and size. Tests whether PR content closes the
   * gap on ambiguous titles ("Bump API to latest, ...") without release context. */
  title_body: (row) => ({
    commit_title: row.title,
    pr_body: cleanBody(row.body),
    labels: row.labels,
    files_changed: row.files_changed,
    additions: row.additions,
    deletions: row.deletions,
  }),

  /** Title plus every other commit title in the same release. Tests whether
   * seeing siblings changes the per-item decision. */
  release: (row, all) => ({
    commit_title: row.title,
    release: `console v${row.release} (${row.tag_range})`,
    other_commits_in_release: all
      .filter((r) => r.release === row.release && r.sha !== row.sha)
      .map((r) => r.title),
  }),
}
