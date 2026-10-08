import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const run = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const msg = (role: 'user' | 'assistant') => ({ role, text: 'hi', toolUses: [] })

// Records the commands and prompts the mod queues, in order
function world(on: On, messages: ReturnType<typeof msg>[]) {
  const calls: string[] = []
  const clock = mock.clock(on)
  on('session.messages', () => ({ value: messages }))
  on('session.id', () => ({ value: 'abc-123' }))
  on('command.run', { command: 'clear' }, () => {
    calls.push('/clear')
    return { text: '' }
  })
  on('prompt.submit', (_$, e) => {
    calls.push(e.text)
    return { text: e.text }
  })
  return { calls, clock }
}

const instructions = 'Continue a previous chat: follow ~/.claude/skills/cont/instructions.md.'

test('fresh session continues without clearing', async ($, on) => {
  const { calls, clock } = world(on, [])
  await $.command.run({ command: 'cont', args: '', ...run })
  await clock.advance(1)
  expect(calls).toEqual([instructions])
})

test('fresh session passes a topic through', async ($, on) => {
  const { calls, clock } = world(on, [])
  await $.command.run({ command: 'cont', args: 'the jj chat', ...run })
  await clock.advance(1)
  expect(calls).toEqual([`${instructions}\n\nARGUMENTS: the jj chat`])
})

test('session with history clears, then continues it by id', async ($, on) => {
  const { calls, clock } = world(on, [msg('user'), msg('assistant')])
  await $.command.run({ command: 'cont', args: '', ...run })
  await clock.advance(1)
  expect(calls).toEqual(['/clear', `${instructions}\n\nARGUMENTS: abc-123`])
})

test('topic is kept and the cleared id is mentioned', async ($, on) => {
  const { calls, clock } = world(on, [msg('user'), msg('assistant')])
  await $.command.run({ command: 'cont', args: 'the jj chat', ...run })
  await clock.advance(1)
  expect(calls).toEqual([
    '/clear',
    `${instructions}\n\nARGUMENTS: the jj chat (the session just cleared was abc-123)`,
  ])
})
