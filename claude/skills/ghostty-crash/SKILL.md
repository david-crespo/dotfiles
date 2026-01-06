---
description: Debugging a ghostty crash
---

List dumps with `ghostty +crash-report`.

Crash dumps live in `~/.local/state/ghostty/crash/`.

## Crash file format

A `.ghosttycrash` file has two parts:
1. **JSON header** - Sentry event data with build info, OS version, session duration
2. **Minidump** - Binary starting with `MDMP` magic

Read JSON metadata (everything before `MDMP`). The header contains multiple JSON lines; the last line is the main Sentry event:

```bash
OFFSET=$(LC_ALL=C grep -ob 'MDMP' <crashfile> | head -1 | cut -d: -f1)
head -c $OFFSET <crashfile> | tail -1 | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))"

This replaces the current "Read JSON metadata" section. The key change is adding `| tail -1` to grab only the last JSON line (the main Sentry event), avoiding the `Extra data` parse error from the multi-line format.

Extract the minidump:
```bash
tail -c +`LC_ALL=C grep -ob 'MDMP' <crashfile> | head -1 | cut -d: -f1 | xargs -I{} expr {} + 1` <crashfile> > /tmp/crash.dmp
```

## Analysis

Analyze with minidump-stackwalk (install via `cargo install minidump-stackwalk`):
```bash
minidump-stackwalk /tmp/crash.dmp
```

Symbolicate addresses with atos. Get base address from minidump output (look for "ghostty" module):
```bash
atos -o /Applications/Ghostty.app/Contents/MacOS/ghostty -l <base_addr> <crash_addr>
```

## Key context

**Threads**: Thread 0 is main/UI. Renderer runs on its own thread. Terminal I/O (termio) uses worker threads for processing input and running child processes.

**Key source paths** (in ghostty repo):
- `src/terminal/` - terminal emulation, pages, reflow
- `src/renderer/` - Metal/OpenGL rendering
- `src/termio/` - PTY and input handling
- `macos/Sources/` - Swift UI layer

**Crash patterns**:
- `EXC_BAD_ACCESS` with address like `0xffffffff????????` usually indicates corrupted pointer arithmetic (e.g., bad offset added to valid base)
- `EXC_BREAKPOINT` in Swift code indicates runtime assertion failure
- Check if multiple crashes share register patterns (e.g., same suspicious capacity value) to identify related bugs

**When comparing crashes**: Look at uptime (session duration in JSON), thread ID, and register values. Same crash in same function with different addresses but similar register patterns suggests same root cause.

## Exploring the codebase

Ghostty is written in Zig with platform-specific layers (Swift for macOS, GTK for Linux).

**Build and test**:
```bash
zig build              # debug build
zig build -Doptimize=ReleaseFast  # release build
zig build test         # run tests
zig build test -Dtest-filter="PageList"  # filter tests by name
```

**Threading model**: Terminal state is protected by `renderer_state.mutex` (defined in `src/renderer/State.zig`). The renderer locks it during frame updates; termio locks it during resize and input processing. Look for `renderer_state.mutex.lock()` to trace critical sections.

**Finding callers**: Use grep for function names. Zig uses `foo.bar()` method syntax but defines as `fn bar(self: *Foo)`, so search for both the method name and struct type.

## Report

Record findings in CRASH.md, including the dump filename and the commands required to reproduce the analysis.
