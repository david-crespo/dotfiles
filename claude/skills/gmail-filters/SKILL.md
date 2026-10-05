---
name: gmail-filters
description: Audit, test, and consolidate Gmail filters (especially for GitHub notification noise) against the user's real mail history, then produce an importable mailFilters.xml. Use when the user wants new filters, wants to clean up existing ones, or worries a filter hides mail they need. Requires the Gmail MCP.
---

# Gmail filters

The approach: treat the user's mail archive as a test set. A Gmail search with
a candidate filter's criteria shows exactly what the filter would have caught,
so every proposed filter can be measured before it exists: how much it removes,
and whether it would have hidden anything that mattered.

## Requirements and caveats

- **Gmail MCP** (the claude.ai Gmail connector). It provides
  `search_threads` and `get_thread`. It can't read or write filter settings, so
  existing filters come in from the user, and new ones go out as an XML file
  for the user to import.
- **History.** Testing works best when the user archives instead of deleting,
  so search covers everything they ever received. Ask about this. If they
  delete a lot, counts undercount and the false-positive check misses things.
  Say how reliable the results are.
- Everything here is read-only. Never label, archive, trash, or send.

## Keep context small

`search_threads` returns full JSON for every message in every thread. A page of
50 threads is 60–90k characters, and a few of those fill the context fast.

- Delegate per-filter measurement (run the query, page through it, sum
  `messageCount`, run the guarded query) to **subagents on a cheaper model**
  (e.g. `model: "sonnet"`), 10–15 queries each, run in parallel. Have each one
  return only a one-row-per-query markdown table. Tell them to use small page
  sizes and `THREAD_VIEW_METADATA_ONLY` except when subjects are needed.
- Keep judgment in the main session: choosing candidates, deciding whether a
  flagged thread is a real false positive, and writing the final filters.
- When doing it inline, `pageSize: 1` + `THREAD_VIEW_METADATA_ONLY` is cheap
  when a rough count is enough.
- `resultCountEstimate` is unreliable. It caps at 201, and near-identical
  queries have returned 201 vs. ~15. For exact numbers, page through.

Start a notes file early (goal, method, result tables, decisions) so the work
can be resumed after the context fills up.

## 1. Get the current filters

Offer both options. Either is quick:

- **Copy and paste:** Settings → Filters and Blocked Addresses, select the
  list, and paste it into chat. Each filter shows as `Matches: <criteria>` /
  `Do this: <actions>`.
- **Export:** select all → Export, then give the path to `mailFilters.xml`.
  The criteria are in each entry's `apps:property` values.

Understand each filter: what it targets, whether it's scoped to a list or
sender, and its actions. Flag filters with no scope, like a bare `subject:ntp`,
since they apply to all mail.

## 2. Audit existing filters

For each filter, have subagents report:

- **Last fired:** the date of the newest match. Results come newest first, so
  `pageSize: 1` is enough.
- **Volume:** matching threads in the last year (`newer_than:1y`).
- **Involved matches:** the same query plus the involvement check below, with
  subjects listed.
- For unscoped filters, any matches outside the intended list.

That gives the cleanup list:
- **Dead:** no matches in a year or more.
- **Redundant:** a subset of another filter, or a near-duplicate.
- **Mergeable:** many subject filters on the same list can become one
  `list:… subject:(a OR b OR …)`.
- **Harmful:** filters that hid threads the user was involved in.

## 3. The involvement guard (GitHub notifications)

GitHub cc's a reason address on each notification. When the user is
personally involved, it's one of these:

```
review_requested@ mention@ author@ comment@ assign@ team_mention@   (all @noreply.github.com)
```

Routine traffic carries `subscribed@`, `push@`, `ci_activity@` and so on.

- **To find false positives:** add
  `{cc:review_requested@noreply.github.com cc:mention@noreply.github.com …}`
  to a candidate query.
- **To prevent them:** append `-cc:…` for each reason to the filter. Filters
  run per message, so a review request or mention still reaches the inbox even
  when earlier messages in the thread were filtered, and it brings the thread
  back with it.
- **Exception:** bot and dependency-bump filters usually shouldn't be
  guarded. The user's own bump PRs carry `author@`, and they probably still
  want those filtered. Ask.

## 4. Find and test new candidates

- Find noise: sample recent threads on the noisy list
  (`list:<repo>.<org>.github.com newer_than:21d`). Have the user say which areas
  they never read, or infer from subject prefixes like `[subsystem]` and from
  what is still reaching the inbox.
- For each candidate, measure threads, messages, and involved matches over the
  last year. Show a table, and recommend against any candidate with recent
  involved hits (for example, an area the user actively works on).

Gmail search gotchas:
- Punctuation is dropped in subject search: `[fm]` matches the bare word `fm`
  anywhere in the subject. Sample subjects for short or common words.
- Prefer phrases that pin down bot-generated subjects (`"digest to"`, not
  `digest`). Check whether an existing sender filter already covers them, as
  `from:renovate[bot]` covers renovate's digest PRs.
- Watch for words with a second meaning in the user's area. For example,
  `gateway` hits both a hardware management service and "internet gateway" API
  work.

Some topics can't be settled by subject alone, such as "only if it affects
the external API". Leave those out of filters and note them for an
LLM-classification layer instead.

## 5. Verify for false positives

Before building the file, run one more pass over the final queries, looking
for threads each filter would hide that the user would want. Earlier steps
measured volume and involvement; this pass reads subjects.

- Fan out to cheaper-model subagents, a handful of terms or filters each. For
  each one, search `<query> newer_than:1y` and page through distinct subjects
  (cap ~75 threads per term), then return only a table (term, threads seen,
  suspicious count) plus one line per suspicious thread (date, subject, why).
- Tell them what counts as suspicious for this user: incidental word matches,
  threads in the user's area (e.g. anything touching the external API), human
  PRs or advisories caught by a bot filter, `[SECURITY]` dependency PRs.
- Check every filter in the final set, not just new ones. Old filters carried
  over unchanged can be the worst offenders, for example a body phrase like
  `"Rack update"` or a bare `bump` subject word that hits human PRs.
- Correct for search semantics when judging results. Search matches whole
  threads, but filters act on single messages. A `from:vercel[bot]` filter
  doesn't hide human comments on the same PR, and a guarded thread still
  delivers the message that mentions the user. A subject-based filter does
  hide every message in the thread, since replies share the subject.
- Say how much of each result set was read. Agents usually see a fraction of
  200+ results, so the counts are lower bounds.

Fixes, roughly in order of preference: drop terms whose matches are mostly
wrong, add exclusions (`-subject:SECURITY`, `-"external API"`), or move a
body-phrase match to `subject:`. A body exclusion only applies to messages
that include the phrase, which in GitHub notifications is usually the opening
one, but that's enough to keep the thread in the inbox.

## 6. Build the import file

Write `mailFilters.xml` next to the notes in the format Gmail exports. Put
each filter's whole query in `hasTheWord`, and escape `"` as `&quot;` (and `&`,
`<`):

```xml
<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
  <title>Mail Filters</title>
  <entry>
    <category term='filter'></category>
    <title>Mail Filter</title>
    <content></content>
    <apps:property name='hasTheWord' value='list:repo.org.github.com subject:(foo OR &quot;bar baz&quot;) -cc:mention@noreply.github.com ...'/>
    <apps:property name='shouldArchive' value='true'/>
    <apps:property name='shouldMarkAsRead' value='true'/>
  </entry>
</feed>
```

Other actions include `label`, `shouldStar`, `shouldNeverSpam` and
`shouldTrash`; copy them from the user's export if they use any. Check that the
file parses as XML.

Before handing it over, run each new or merged query through `search_threads`
(`pageSize` small) to confirm Gmail parses it. Use a `newer_than` only for that
test search, never in the filter itself.

The file should hold the **full** consolidated set: kept filters, merged
filters, and new ones. Dead filters are left out.

## 7. Install

Gmail import only adds filters; it never replaces existing ones. Tell the
user:

1. Settings → Filters and Blocked Addresses → select all → **Export** (backup).
2. With everything still selected, **Delete**.
3. **Import filters** → choose `mailFilters.xml` → create all. Leave "apply to
   existing conversations" unticked unless they want old mail re-marked.
