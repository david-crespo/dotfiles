import { expect, test } from 'claude-code/testing'

const usage = (cost?: { usd: number }) => ({
  value: { startedAt: 0, context: { tokens: 0, window: 200_000 }, rateLimits: [], cost },
})

test('reports the session cost in dollars', async ($, on) => {
  on('session.usage', () => usage({ usd: 1.234 }))
  const r = await $.tool.call({ tool: 'mcp__session-cost__cost' })
  expect(r.result).toBe('$1.23')
})

test('says so when there is no ledger', async ($, on) => {
  on('session.usage', () => usage())
  const r = await $.tool.call({ tool: 'mcp__session-cost__cost' })
  expect(r.result).toBe('No cost ledger in this session.')
})
