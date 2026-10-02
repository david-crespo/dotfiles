import { expect, mock, test, type Engine, type TestBody } from 'claude-code/testing'

// The test kit's on, for registering stubs; it isn't exported by name
type On = Parameters<TestBody>[1]

const BAND = {
  plugin: 'statusline',
  component: 'AbovePrompt',
  requestId: 'AbovePrompt',
  viewport: { columns: 100, rows: 30 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 5,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const LINE = '45.3k (22%) | $1.23'
const START = Date.UTC(2026, 9, 1, 12, 0)
const MINUTE = 60 * 1000

function stubSession(
  on: On,
  context: { tokens?: number; window: number; percent?: number } = { tokens: 45_300, window: 200_000, percent: 22 },
) {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context,
      rateLimits: [],
      cost: { usd: 1.234 },
    },
  }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
}

// Raise one model request and read its stream to the end
async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1, agentId })
  let s = await stream.next()
  while (s.done !== true) s = await stream.next()
}

function stubStep(on: On) {
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'claude-test',
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1,
      },
    }
  })
}

const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

async function bandText($: Engine) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const text = await ui.find({ type: 'Text', text: /\$/ })
  await ui.unmount()
  return text?.children.join('')
}

test('draws tokens and cost in Desktop', async ($, on) => {
  mock.clock(on, { now: START })
  stubSession(on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: LINE })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('shows 0k before the first response', async ($, on) => {
  mock.clock(on, { now: START })
  stubSession(on, { window: 200_000 })

  expect(await bandText($)).toBe('0k (0%) | $1.23')
})

test('leaves the terminal to statusline.ts', async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: LINE })).toBeUndefined()
})

test('estimates cache expiry a few minutes early', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  stubSession(on)
  stubStep(on)

  await step($)
  expect(await bandText($)).toBe(`${LINE} | cache cold ${timeOf(START + 57 * MINUTE)}`)

  // A later request pushes the expiry out
  await clock.advance(10 * MINUTE)
  await step($)
  expect(await bandText($)).toBe(`${LINE} | cache cold ${timeOf(START + 67 * MINUTE)}`)

  await clock.advance(57 * MINUTE)
  expect(await bandText($)).toBe(`${LINE} | cache cold`)
})

test('ignores subagent requests', async ($, on) => {
  mock.clock(on, { now: START })
  stubSession(on)
  stubStep(on)

  await step($, 'agent-1')
  expect(await bandText($)).toBe(LINE)
})

test('a resumed session starts from its last response', async ($, on) => {
  mock.clock(on, { now: START })
  stubSession(on)
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 30 * 60 })
  expect(await bandText($)).toBe(`${LINE} | cache cold ${timeOf(START + 27 * MINUTE)}`)
})
