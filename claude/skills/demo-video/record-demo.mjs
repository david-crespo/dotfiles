// Demo video recorder: drives a Playwright flow and captures it as an mp4.
//
// Usage: copy this file into the target repo (e.g. .claude/notes/record-demo.mjs),
// edit the CONFIG block and the WALK section, then run from the repo root with
// the dev server up:  node .claude/notes/record-demo.mjs
//
// Why frames + ffmpeg instead of Playwright's recordVideo: recordVideo uses the
// CDP screencast, which is hard-capped at CSS-pixel resolution no matter what
// deviceScaleFactor says, so the video is blurry on hidpi screens.
// page.screenshot() DOES honor deviceScaleFactor, so we capture JPEG frames in
// a loop and let ffmpeg assemble them at the measured frame rate.
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'

import { chromium } from '@playwright/test'

// ── CONFIG ──────────────────────────────────────────────────────────────────
const BASE = process.env.BASE ?? 'http://localhost:4000'
const OUT = process.env.OUT ?? '.claude/notes/demo-video/demo.mp4'
const VIEWPORT = { width: 1280, height: 800 } // phone demos: { width: 400, height: 800 }
const FRAME_INTERVAL_MS = 80 // target ~12fps; actual rate is measured

const FRAME_DIR = `${OUT}.frames`

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  // otherwise macOS "Reduce Motion" suppresses the CSS transitions being demoed
  reducedMotion: 'no-preference',
})

// Fake cursor + caption pill. Injected via addInitScript so they come back
// after any full page load. Headless clicks are otherwise invisible.
await context.addInitScript(() => {
  function ensure(id, style) {
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.style.cssText = style
      document.body.appendChild(el)
    }
    return el
  }
  const cursorStyle = `position:fixed;z-index:99999;width:20px;height:20px;
    border-radius:50%;background:rgba(255,80,80,.85);border:2px solid white;
    pointer-events:none;transform:translate(-50%,-50%);top:-40px;left:-40px;
    transition:width .1s,height .1s;box-shadow:0 0 6px rgba(0,0,0,.5)`
  // deliberately not app-styled so it reads as narration, not UI
  const captionStyle = `position:fixed;z-index:99999;left:50%;bottom:16px;
    transform:translateX(-50%);max-width:92vw;padding:7px 16px;border-radius:999px;
    background:rgba(44,42,66,.66);border:1px solid rgba(170,162,230,.45);
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    color:#edecf7;font:500 13px/1.4 -apple-system,sans-serif;
    box-shadow:0 2px 12px rgba(0,0,0,.35);
    pointer-events:none;white-space:nowrap;display:none`
  document.addEventListener('mousemove', (e) => {
    const c = ensure('demo-cursor', cursorStyle)
    c.style.left = e.clientX + 'px'
    c.style.top = e.clientY + 'px'
  })
  document.addEventListener('mousedown', () => {
    const c = document.getElementById('demo-cursor')
    if (!c) return
    c.style.width = '30px'
    c.style.height = '30px'
    setTimeout(() => {
      c.style.width = '20px'
      c.style.height = '20px'
    }, 150)
  })
  window.__caption = (text) => {
    const el = ensure('demo-caption', captionStyle)
    el.textContent = text
    el.style.display = text ? 'block' : 'none'
  }
})

const page = await context.newPage()

// ── frame capture loop ──────────────────────────────────────────────────────
await rm(FRAME_DIR, { recursive: true, force: true })
await mkdir(FRAME_DIR, { recursive: true })
let frameCount = 0
let capturing = true
let busy = false // a capture can outlast the interval; never overlap them
const captureStart = Date.now()
const captureTimer = setInterval(async () => {
  if (!capturing || busy) return
  busy = true
  try {
    const buf = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      animations: 'allow',
      caret: 'initial',
      timeout: 2000,
    })
    await writeFile(`${FRAME_DIR}/f${String(frameCount++).padStart(5, '0')}.jpg`, buf)
  } catch {
    // page mid-navigation; skip the frame
  }
  busy = false
}, FRAME_INTERVAL_MS)

// ── helpers ─────────────────────────────────────────────────────────────────
const pause = (ms = 1400) => page.waitForTimeout(ms)
// show the caption, then hold so the viewer reads it BEFORE the action happens.
// Captions that change in the same instant as the click are hard to follow.
async function caption(text, holdMs = 1000) {
  await page.evaluate((t) => window.__caption(t), text)
  if (text) await page.waitForTimeout(holdMs)
}
// glide the fake cursor to the target, then click. The travel is what makes
// the video legible; a bare locator.click() teleports.
async function moveClick(locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 })
  await page.waitForTimeout(300)
  await locator.click()
}
// type visibly instead of fill()'s instant paste
const type = (locator, text) => locator.pressSequentially(text, { delay: 40 })

// ── WALK ────────────────────────────────────────────────────────────────────
// goto ONCE, then navigate only by clicking in-app (mock APIs reset on full
// page load). Each beat: caption → action → pause. Clear the caption before
// actions that spawn a toast in the same corner.
await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: 'Projects' }).waitFor()
// park the cursor in dead space so no tooltip is open in the intro frame
// (away from the bottom-center caption; adjust per page)
await page.mouse.move(VIEWPORT.width * 0.6, VIEWPORT.height * 0.75, { steps: 10 })
await caption('First beat: what the viewer is looking at')
await pause(2200)

// ... more beats ...

await caption('')
await pause(1200)

// ── assemble ────────────────────────────────────────────────────────────────
capturing = false
clearInterval(captureTimer)
const elapsedSec = (Date.now() - captureStart) / 1000
await browser.close()
const fps = (frameCount / elapsedSec).toFixed(3)
console.log(`${frameCount} frames over ${elapsedSec.toFixed(1)}s -> ${fps} fps`)
execFileSync('ffmpeg', [
  ...['-v', 'error', '-y'],
  ...['-framerate', fps],
  ...['-i', `${FRAME_DIR}/f%05d.jpg`],
  // yuv420p + faststart so GitHub/Slack/QuickTime all play it inline
  ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20'],
  ...['-movflags', '+faststart'],
  OUT,
])
await rm(FRAME_DIR, { recursive: true })
console.log(`video saved to ${OUT}`)
