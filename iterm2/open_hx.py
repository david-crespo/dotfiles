#!/usr/bin/env python3

import argparse
import iterm2


parser = argparse.ArgumentParser()
parser.add_argument("filename")
parser.add_argument("line_number")
parser.add_argument("working_dir")

args = parser.parse_args()


async def main(conn):
    app = await iterm2.async_get_app(conn)
    window = app.current_window

    if window is None:
        print("No current window")
        return

    sessions = window.tabs[0].sessions
    hx_pane = next(filter(lambda s: s.name == "hx", sessions), None)
    if hx_pane:
        line_number = ":" + args.line_number if args.line_number else ""
        await hx_pane.async_send_text(f":open {args.filename}{line_number}\r")
        await hx_pane.async_activate()


iterm2.run_until_complete(main)
