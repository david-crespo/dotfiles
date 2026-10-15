-- Rex config, ported from ../ghostty/config. Appearance (theme, font, cell
-- height, padding, inactive pane fade) lives in the app's Settings, not here.
-- Reload with `rex config reload`.
--
-- Rex's agent SessionStart hooks in claude/settings.json and codex/hooks.json
-- pass --feature-session-naming=false so the agent doesn't rename the Rex
-- session, which would fight ah's titles. Run `rex skill setup` with
-- --session-naming=false so the installed skill and hooks match.

rex.bind("cmd+alt+right", "client.tab.next")
rex.bind("cmd+alt+left", "client.tab.previous")

local function runs_helix(block_id)
  local ok, p = pcall(rex.block.call, "com.superlogical.terminal", "process", { block_id = block_id })
  local fg = ok and p and p.foreground
  return fg and (fg.argv0 == "hx" or fg.name == "hx") or false
end

-- Like Ghostty's performable: move focus if there is a pane in that direction,
-- otherwise let the key through to the terminal (e.g. ctrl+l to clear).
-- Helix always gets the key so it can move between its own splits; at its edge
-- it runs `rex focus` (see jump-view in ../helix/helix.scm).
local function focus_or_pass(direction)
  return function(ctx)
    if runs_helix(ctx and ctx.block_id) then return false end
    local view = rex.session.view{}
    if view == nil then return false end
    local result = rex.session.focus_direction{ direction = direction }
    return result ~= nil and result.revision ~= view.revision
  end
end
rex.bind("ctrl+h", focus_or_pass("left"))
rex.bind("ctrl+j", focus_or_pass("down"))
rex.bind("ctrl+k", focus_or_pass("up"))
rex.bind("ctrl+l", focus_or_pass("right"))

-- Cmd keys bound in ../helix/init.scm that are also app shortcuts: send them
-- to helix as kitty keyboard protocol (modifier 9 is super) and do the app's
-- action everywhere else. A function bound to a key hides the app's shortcut
-- and can't queue client actions, so this has to be an action.
local function helix_or(ctx, args)
  if runs_helix(ctx.block_id) then
    rex.block.call("com.superlogical.terminal", "write", {
      block_id = ctx.block_id,
      data = string.format("\27[%d;9u", string.byte(args.letter)),
    })
  elseif args.fallback then
    rex.client.queue(args.fallback)
  end
end
local helix_or_args = { letter = "string", fallback = "string?" }
rex.action{
  name = "helix_or",
  title = "Send Cmd Key to Helix or Fall Back",
  args = helix_or_args,
  run = helix_or,
}
-- For keys like cmd+k (select_line_above) that should repeat while held.
rex.action{
  name = "helix_or_repeat",
  title = "Send Cmd Key to Helix or Fall Back, Repeating",
  args = helix_or_args,
  repeats = true,
  run = helix_or,
}
rex.bind("cmd+w", "helix_or", { letter = "w", fallback = "client.close" })
rex.bind("cmd+k", "helix_or_repeat", { letter = "k" })

-- auto covers me pretty much all the time
rex.bind("cmd+d", "pane.split.auto")
rex.bind("alt+shift+d", "pane.split.up")

-- Ghostty sent esc:w (alt+w)
rex.bind("cmd+backspace", "pane.send_key", { key = "alt+w" })

-- Ghostty sent \x1b\r (alt+enter) for newline in Claude Code etc.
rex.bind("shift+enter", "pane.send_key", { key = "alt+enter" })

-- Agent layout: claude in a full-height left third, editor over a shell on the
-- right. Commands go in as typed input, so quitting one leaves a shell in its
-- pane.
local function shell_pane(cwd, input)
  return rex.layout.block{
    flavor = "com.superlogical.terminal.shell",
    options = { cwd = cwd, initial_input = input },
  }
end

-- Turns a pane (the current one by default) into the left third by adding the
-- right two panes in its directory, then starts claude in it.
rex.action{
  name = "agent_layout",
  title = "Agent Layout",
  description = "Claude in this pane on the left third, Helix over a shell on the right, in its directory",
  keywords = "layout claude helix three panes",
  args = { block_id = "string?" },
  run = function(ctx, args)
    local block = args and args.block_id or ctx.block_id
    if not block then error("no current pane", 0) end
    local p = rex.block.call("com.superlogical.terminal", "process", { block_id = block })
    local cwd = p and p.foreground and p.foreground.cwd
    local _, err = rex.session.new_split{
      anchor_block_id = block,
      direction = "horizontal",
      side = "after",
      ratio = 1/3,
      layout = rex.layout.vertical(0.6, shell_pane(cwd, "hx\n"), shell_pane(cwd, nil)),
    }
    if err ~= nil then error(err, 0) end
    rex.block.call("com.superlogical.terminal", "write", { block_id = block, data = "claude\n" })
  end,
}
rex.bind("cmd+shift+l", "agent_layout")
