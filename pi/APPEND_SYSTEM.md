# pi-specific instructions

These supplement the shared context files and apply only to pi.

## Web search

A `kagi-search` CLI is available for web access (backed by the Kagi API):

- `kagi-search <query>` — web search, prints title / url / snippet per result.
- `kagi-search extract <url...>` — fetch up to 10 pages as markdown.

Use it via the Bash tool when a task needs current information, external docs,
or the contents of a specific page. Prefer it over scraping search engines
directly. Add `--json` for structured output.
