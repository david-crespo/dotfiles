import type { Register } from 'claude-code'

// The mobile app over remote control has no /cost, so this gives the model a
// tool to report it when asked.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'cost',
      description:
        "What the session has cost so far in US dollars, as /cost totals it. Call it when the user asks about cost.",
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__session-cost__cost' }, async $ => {
    const { cost } = await $.session.usage()
    return { result: cost ? usd.format(cost.usd) : 'No cost ledger in this session.' }
  })
}
