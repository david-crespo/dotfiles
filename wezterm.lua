local wezterm = require 'wezterm'
local config = wezterm.config_builder()

-- https://alexplescan.com/posts/2024/08/10/wezterm/

config.font = wezterm.font({ family = 'Berkeley Mono' })
config.font_size = 13

-- Removes the title bar, leaving only the tab bar. Keeps
-- the ability to resize by dragging the window's edges.
-- On macOS, 'RESIZE|INTEGRATED_BUTTONS' also looks nice if
-- you want to keep the window controls visible and integrate
-- them into the tab bar.
config.window_decorations = 'RESIZE'
-- Sets the font for the window frame (tab bar)
config.window_frame = {
  font = wezterm.font({ family = 'Berkeley Mono', weight = 'Bold' }),
  font_size = 11,
}

return config
