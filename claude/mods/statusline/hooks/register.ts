import type { On } from 'claude-code'

// The Desktop app doesn't draw the statusLine command (../../statusline.ts),
// so this draws the same tokens | cost | cache line in the band above
// the prompt there. The terminal keeps using statusline.ts, so nothing is
// drawn there.

const kFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const costFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// statusline.ts gets prompt_cache.expires_at from Claude Code, but the mods API
// doesn't expose it, so estimate it from the last main-loop request. Every
// request refreshes the cache's TTL. The engine knows the TTL (5m or 1h) but
// only hands it to hooks on a model switch, so assume 1h, which is what this
// account gets outside usage overage. Show the time a few minutes early so the
// estimate errs toward cold.
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MARGIN_MS = 3 * 60 * 1000

let lastRequestAt: number | undefined

function cacheColdSegment(now: number): string | undefined {
  if (lastRequestAt === undefined) return undefined
  const coldAt = lastRequestAt + CACHE_TTL_MS - CACHE_MARGIN_MS
  if (now >= coldAt) return 'cache cold'
  const time = new Date(coldAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `cache cold ${time}`
}

export function register(on: On) {
  // Nothing else redraws the band when the cache estimate passes
  on('session.start', async ($, e, next) => {
    $.clock.every(60 * 1000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The Desktop app shows the model itself, under the prompt
    const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
    // tokens is absent until the first response reports it
    const tokens = usage.context.tokens ?? 0
    const pct = usage.context.percent ?? Math.floor((tokens * 100) / usage.context.window)
    const segments = [
      `${kFmt.format(tokens / 1000)}k (${pct}%)`,
      costFmt.format(usage.cost?.usd ?? 0),
      cacheColdSegment(now),
    ].filter(Boolean)
    // Keep whatever later mods draw in the band
    return Box({
      flexDirection: 'column',
      children: [await next(e), Text({ dimColor: true, children: [segments.join(' | ')] })],
    })
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    // Subagents have their own cache prefixes, and a request with no usage
    // never reached the API
    if (e.agentId === undefined && result.usage) {
      lastRequestAt = await $.clock.now()
    }
    return result
  })

  // A resumed session's cache is as old as its last response, and a cleared
  // one hasn't sent anything yet
  on('classic.SessionStart', { source: ['resume', 'fork', 'clear'] }, async ($, e, next) => {
    lastRequestAt =
      e.seconds_since_last_response === undefined
        ? undefined
        : (await $.clock.now()) - e.seconds_since_last_response * 1000
    return next(e)
  })

  // Usage changes after each request, not on any render-site prop change
  on('session.measure', async ($, e, next) => {
    $.ui.invalidate('ui.render')
    return next(e)
  })
}
