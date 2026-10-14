-- Rex config, ported from ../ghostty/config. Appearance (theme, font, cell
-- height, padding, inactive pane fade) lives in the app's Settings, not here.
-- Reload with `rex config reload`.

rex.bind("cmd+alt+right", "client.tab.next")
rex.bind("cmd+alt+left", "client.tab.previous")

-- Like Ghostty's performable: move focus if there is a pane in that direction,
-- otherwise let the key through to the terminal (e.g. ctrl+l to clear).
local function focus_or_pass(direction)
  return function()
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

-- auto covers me pretty much all the time
rex.bind("cmd+d", "pane.split.auto")
rex.bind("alt+shift+d", "pane.split.up")

-- Ghostty sent esc:w (alt+w)
rex.bind("cmd+backspace", "pane.send_key", { key = "alt+w" })

-- Ghostty sent \x1b\r (alt+enter) for newline in Claude Code etc.
rex.bind("shift+enter", "pane.send_key", { key = "alt+enter" })

