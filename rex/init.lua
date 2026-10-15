-- Rex config, ported from ../ghostty/config. Appearance (theme, font, cell
-- height, padding, inactive pane fade) lives in the app's Settings, not here.
-- Reload with `rex config reload`.

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

-- Cmd keys bound in ../helix/init.scm that may be app shortcuts (cmd+k and
-- cmd+w are), so send them straight to helix and leave them to Rex everywhere
-- else. pane.send_key doesn't get them there, so write the kitty keyboard
-- protocol encoding (modifier 9 is super) to the pty.
for _, letter in ipairs{ "k", "r", "s", "w" } do
  rex.bind("cmd+" .. letter, function(ctx)
    if not runs_helix(ctx and ctx.block_id) then return false end
    rex.block.call("com.superlogical.terminal", "write", {
      block_id = ctx.block_id,
      data = string.format("\27[%d;9u", string.byte(letter)),
    })
    return true
  end)
end

-- auto covers me pretty much all the time
rex.bind("cmd+d", "pane.split.auto")
rex.bind("alt+shift+d", "pane.split.up")

-- Ghostty sent esc:w (alt+w)
rex.bind("cmd+backspace", "pane.send_key", { key = "alt+w" })

-- Ghostty sent \x1b\r (alt+enter) for newline in Claude Code etc.
rex.bind("shift+enter", "pane.send_key", { key = "alt+enter" })

