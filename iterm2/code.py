#!/usr/bin/env python3

import iterm2
import argparse
import os

parser = argparse.ArgumentParser()
parser.add_argument("dir")

args = parser.parse_args()


async def main(conn):
    abs_dir = os.path.abspath(args.dir)

    app = await iterm2.async_get_app(conn)
    window = app.current_window

    if window:
        new_window = await window.async_create(conn)
        await new_window.async_set_title(abs_dir.split("/")[-1])
        tab = new_window.tabs[0]

        await tab.current_session.async_split_pane(vertical=True)
        # split left pane again horizontally
        await tab.sessions[0].async_split_pane()

        for session in tab.sessions:
            await session.async_send_text(f"cd {abs_dir}\n")
        await tab.sessions[2].async_send_text("hx .\n")
    else:
        print("No current window")


iterm2.run_until_complete(main)
