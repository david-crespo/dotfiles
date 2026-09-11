// Counts React renders per component, per commit. Answers "does this `memo`
// actually do anything?"
//
// React hands every commit to window.__REACT_DEVTOOLS_GLOBAL_HOOK__ if it
// exists before react-dom loads. This is a stand-in for DevTools: it walks
// the committed fiber tree and tallies components that did work in each
// commit, using the same PerformedWork flag the DevTools profiler uses.
//
// Usage (Playwright): install as an init script, reset the tally right before
// the interaction, read it after.
//
//   await page.addInitScript({ path: '/path/to/skills/browser-interact/react-render-hook.js' })
//   await page.goto(url)
//   await page.getByRole('table').getByRole('row').nth(1).waitFor()
//   await page.evaluate(() => { window.__commits = [] })
//   await page.getByRole('table').getByRole('row').nth(1).click()
//   await page.getByRole('dialog').waitFor()
//   await page.waitForTimeout(500) // let animations/effects commit
//   const commits = await page.evaluate(() => window.__commits) // [{ Name: count }, ...]
//
// Sum across commits and sort to see who rendered. For an A/B (with and
// without a `memo`, say): measure, edit the source (the dev server
// hot-reloads), `sleep 2`, measure again, then restore the file from a backup
// taken up front (`cp` + a shell `trap` so a failed run still restores).
//
// This answers WHO rendered and HOW MANY times. Two adjacent questions need
// other tools (tested 2026-09 on React 19 + Vite; see SKILL.md):
// - "Does it matter?" -> wrap the root in <Profiler onRender> and compare
//   actualDuration vs baseDuration. Their gap is what memoization saved.
// - "Why did this memo'd thing re-render?" -> why-did-you-render, which names
//   the offending prop. Needs `jsxImportSource` pointed at it in the Vite
//   react plugin on React 19, plus an init import.
// react-scan's programmatic onRender gives the same names/counts as this hook
// plus self time, but its `changes`/`unnecessary` fields are dead code in
// 0.5.7 (trackChanges hardcoded false), so it can't explain renders either.
//
// Gotchas:
// - Zero commits means the hook broke, not that nothing rendered. React
//   swallows hook errors. Runtime errors are recorded into __commits, but a
//   syntax error in this file is still silent, so `node --check` it after
//   editing. Pass the hook by `path`, not as an inline template literal:
//   backslashes in the regexes below get eaten.
// - Names: memo(() => ...) has no name and shows as `anon<FirstJsxTag>`.
//   memo(function Name() {}) fixes that, and is worth suggesting in the repo.
// - Semantics match DevTools: a component counts if its fiber was cloned this
//   commit and rendered. Memo bailouts and untouched subtrees don't count, so
//   a child protected by its own `memo` + stable props shows 0 even when its
//   parent re-renders. That is how you tell which layer of memoization is
//   doing the work.
;(() => {
  const PerformedWork = 0b1
  // FunctionComponent, ClassComponent, ForwardRef, MemoComponent, SimpleMemoComponent
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15])
  let prevFibers = new WeakSet()

  const nameOf = (f) => {
    const t = f.type
    if (!t || typeof t === 'string') return null
    const inner = t.render || t.type
    let n = t.displayName || t.name || (inner && (inner.displayName || inner.name)) || ''
    // memo(arrow) has no name (or a compiler-mangled one like _c3); fall back
    // to the first JSX tag in its source so it can still be recognized
    if (!n || /^_c\d*$/.test(n)) {
      const src = (typeof inner === 'function' ? inner : t).toString()
      const m = src.match(/jsx(?:DEV)?\(\s*[\"']?([A-Za-z0-9_.$-]+)/)
      n = 'anon<' + (m ? m[1] : src.slice(0, 40).replace(/\s+/g, ' ')) + '>'
    }
    return n
  }

  window.__commits = []
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    _id: 0,
    inject(r) {
      const id = ++this._id
      this.renderers.set(id, r)
      return id
    },
    on() {}, off() {}, emit() {}, sub() { return () => {} },
    checkDCE() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, setStrictMode() {},
    onCommitFiberRoot(_id, root) {
      const counts = {}
      const next = new WeakSet()
      const walk = (f) => {
        for (; f; f = f.sibling) {
          next.add(f)
          // a fiber object absent from the previous committed tree was cloned
          // this commit; bailed-out subtrees keep the same fiber objects
          if (!prevFibers.has(f) && f.flags & PerformedWork && COMPONENT_TAGS.has(f.tag)) {
            const n = nameOf(f) ?? '?'
            counts[n] = (counts[n] || 0) + 1
          }
          if (f.child) walk(f.child)
        }
      }
      try {
        walk(root.current)
        prevFibers = next
        window.__commits.push(counts)
      } catch (e) {
        window.__commits.push({ ['ERROR ' + String((e && e.stack) || e)]: 1 })
      }
    },
  }
})()
