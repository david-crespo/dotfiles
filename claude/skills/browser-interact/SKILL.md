---
name: browser-interact
description: Drive a real browser during frontend work — verify a change rendered, click through a flow, fill forms, read console errors, take screenshots, or debug performance/memory/network. Use whenever interacting with a local web app in a browser (Playwright script templates, chrome-devtools tradeoffs, SPA mock-API gotchas).
---

How to interact with a browser during frontend dev work.

## Default: one Playwright script per check

For any multi-step flow (load a page, click around, fill a form, verify a
change), write a Playwright script and run it with `node`. Driving the browser
action-by-action through MCP tools costs a full model round trip per action: a
~25-action flow takes minutes through MCP calls and ~5 seconds as one script.

One-shot scripts are fine — headless chromium launches in ~70ms, so the app's
own load time dominates. Don't set up a persistent browser server
(`launchServer`/`connect` saves CPU, not wall-clock) unless running many
checks in a tight loop.

### Template

```js
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto('http://localhost:4444/projects', { waitUntil: 'domcontentloaded' })
// wait on a real element, never 'networkidle'
await page.getByRole('link', { name: 'New project' }).waitFor()

// interact by accessible role/name; crib selectors from the repo's e2e tests
await page.getByRole('link', { name: 'New project' }).click()
await page.getByRole('textbox', { name: 'Name' }).fill('my-project')
await page.getByRole('button', { name: 'Create project' }).click()
await page.waitForURL('**/projects/my-project/instances')

// verify created state via CLIENT-SIDE nav — see mock-API gotcha below
await page
  .getByRole('navigation', { name: 'Breadcrumbs' })
  .getByRole('link', { name: 'Projects' })
  .click()

console.log(await page.locator('body').ariaSnapshot()) // ~3KB page summary
await page.screenshot({ path: 'check.png' })

// console/errors are readable retroactively (Playwright 1.61+, last 200 msgs;
// filter: 'since-navigation' scopes to after the last full page load)
for (const m of await page.consoleMessages()) console.log(`[${m.type()}] ${m.text()}`)
for (const e of await page.pageErrors()) console.log(`[pageerror] ${e.message}`)
await browser.close()
```

### Gotchas (each of these caused a first-run failure in testing)

- **Module resolution**: ESM ignores `NODE_PATH`. Run the script from inside
  the frontend repo (most already have `@playwright/test`), or symlink the
  repo's `node_modules` next to the script. If chromium isn't cached in
  `~/Library/Caches/ms-playwright`, ask before downloading it.
- **SPA + in-memory mock API (MSW etc.)**: any full page load — `page.goto`,
  reload, URL navigation — reboots the service worker and resets the mock DB,
  wiping state created earlier in the flow. Verify mutations by navigating
  in-app via clicks.
- **Waiting**: wait on a specific element at the destination, not
  `networkidle` (SPAs may never go idle) and not `location.pathname` (URL
  updates before the destination renders). After a mutation, `waitForURL` is
  reliable.
- **Strict mode**: ambiguous selectors throw (e.g. a "Projects" link in both
  breadcrumb and sidebar). Scope through a parent
  (`getByRole('navigation', { name: ... }).getByRole(...)`).
- **Selectors**: prefer role + accessible name. If the repo has e2e tests,
  copy their selectors instead of guessing; otherwise print an
  `ariaSnapshot()` first and pick names from it.
- **Page summary**: `page.locator('body').ariaSnapshot()` (~3KB) instead of
  dumping HTML. Screenshots go to files; Read them after.

## When to use browser MCP tools instead

For a one-off interactive look at a page that's already up — a screenshot,
reading console errors, a single click. Per-call latency is only 1–3s; it's
the per-action round trips that make long flows slow. (The `chrome-devtools`
CLI has the same tradeoff: ~0.2s fixed overhead per invocation, so idiomatic
one-command-per-action scripts run ~2x slower than Playwright; batching
everything into `evaluate_script` blobs matches Playwright's speed but is
worse to write.)

## Debugging: pick by job

chrome-devtools MCP/CLI is uniquely capable where it vendors DevTools' own
analysis code (unreachable via Playwright or raw CDP):

- **Performance traces**: `performance_start_trace` / `performance_analyze_insight`
  run DevTools' trace engine — LCP breakdown, CWV insights.
- **Heap analysis**: CLI with `--memoryDebugging` exposes dominator trees,
  retainer paths, duplicate strings, snapshot comparison.
- **Console stacks**: auto-symbolicated through source maps.
- **The user's real Chrome**: `--autoConnect` (Chrome ≥144) attaches to the
  actual logged-in default-profile browser — useful when the bug needs real
  app state.

Playwright is better for **network debugging**: `request.timing()` gives
per-request DNS/connect/TLS/TTFB/download breakdowns, plus route
interception/mocking and HAR record/replay. The chrome-devtools network tools
are inspection-only, with no per-request timing. (Playwright's
`context.newCDPSession(page)` also reaches any raw CDP domain if needed.)
