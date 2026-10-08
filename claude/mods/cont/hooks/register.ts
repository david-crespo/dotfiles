import type { Register } from 'claude-code'

// /cont picks up a previous chat in a fresh session from a compact digest
// instead of resending its whole context. In a session that already has
// history, it runs /clear first and continues the session it just cleared.

const prompt = (args: string) =>
  `Continue a previous chat: follow ~/.claude/skills/cont/instructions.md.` +
  (args ? `\n\nARGUMENTS: ${args}` : '')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cont',
      description: 'Continue the previous chat (or one by topic or id) in a fresh session',
      argumentHint: '[topic | session id]',
    })
    return next(e)
  })

  on('command.run', { command: 'cont' }, async ($, e) => {
    let args = e.args.trim()
    const messages = await $.session.messages()
    const used = messages.some(m => m.role === 'assistant')
    if (used) {
      const id = await $.session.id()
      // With a topic the user may mean some other chat, so leave the pick to
      // the instructions and only say which session was cleared
      args = args ? `${args} (the session just cleared was ${id})` : id
    }
    // A command.run hook can't run commands or submit prompts itself (both
    // wait for the session to go idle), so queue them for after it returns
    $.clock.after(0, async () => {
      if (used) await $.command.run({ command: 'clear', args: '' })
      await $.prompt.submit({ text: prompt(args) })
    })
    return { text: used ? 'Clearing, then continuing' : 'Continuing' }
  })
}
