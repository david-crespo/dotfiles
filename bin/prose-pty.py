#!/usr/bin/env python3
# pty bridge for prose.ts: runs a command in a pseudo-terminal, relaying the
# terminal's output to stdout and framed messages from stdin into it.
# Deno has no pty support of its own (node-pty's native addon doesn't work
# under Deno's Node compat layer), so this stdlib-only script fills the gap.
#
# Usage: prose-pty.py COLSxROWS command [args...]
#
# stdin frames: 1 byte type, 4 byte big-endian payload length, payload.
#   b"i": raw keyboard input for the terminal
#   b"r": resize, payload "COLSxROWS"
# stdout: raw terminal output. EOF on stdin hangs up the terminal (SIGHUP).
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_size(fd, spec):
    cols, rows = (int(n) for n in spec.split("x"))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


size, argv = sys.argv[1], sys.argv[2:]
pid, master = pty.fork()
if pid == 0:
    # Child: set the window size before exec so the program never sees the
    # kernel default; stdin is the pty slave here.
    set_size(0, size)
    os.execvp(argv[0], argv)

stdin = sys.stdin.buffer.raw
stdout = sys.stdout.buffer.raw
inbuf = b""
while True:
    readable, _, _ = select.select([master, stdin], [], [])
    if master in readable:
        try:
            data = os.read(master, 65536)
        except OSError:
            data = b""
        if not data:
            break
        stdout.write(data)
        stdout.flush()
    if stdin in readable:
        chunk = stdin.read(65536)
        if not chunk:
            os.kill(pid, signal.SIGHUP)
            break
        inbuf += chunk
        while len(inbuf) >= 5:
            kind = inbuf[0:1]
            (length,) = struct.unpack(">I", inbuf[1:5])
            if len(inbuf) < 5 + length:
                break
            payload, inbuf = inbuf[5 : 5 + length], inbuf[5 + length :]
            if kind == b"i":
                os.write(master, payload)
            elif kind == b"r":
                set_size(master, payload.decode())
                os.kill(pid, signal.SIGWINCH)

_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
