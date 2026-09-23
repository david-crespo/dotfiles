// Starter for a hand-laid 1920×1080 slide figure. Copy next to render.mjs, then:
//   bun gen.ts > fig.svg && node render.mjs $PWD/fig.svg $PWD/fig.png
// Run the pair twice after changing any sans text: the first render writes widths.json,
// the second lays out with real measurements.
//
// Replace the COMPOSITION section. Keep the helpers; they encode the house style.

import { readFileSync } from 'node:fs'

// ---------- stage and grid (OXCON theme) ----------

export const W = 1920
export const H = 1080
export const U = W / 77 // cell width ≈ 24.94 (77-column ASCII grid)
export const CH = H / 22 // cell height ≈ 49.09 (22 rows)
export const MARGIN = 3 * U // ≈ 75, matches the theme's header label position

// ---------- palette (dark theme; see design system tokens) ----------

export const BG = '#080f11'
export const GREEN = '#48d597' // accent, use sparingly
export const GREEN_TEXT_DIM = '#3d9c72' // mono text in a resting box
export const BOX_FILL = '#0b1a18'
export const BOX_FILL_HOT = '#0f2a24'
export const BOX_STROKE = '#183a30'
export const BOX_STROKE_HOT = '#2e7a5c'
export const PANEL_FILL = '#0d1618' // a region, like the "Docs site" group on a pipeline slide
export const PANEL_STROKE = '#1c2628'
export const LINE = '#8a9396' // connectors
export const RAISE = '#e7e9ea' // strongest text
export const SECONDARY = '#a1a6a8'
export const TERTIARY = '#5f6769'

// ---------- type ----------

export const MONO_SIZE = 17
export const MONO_ADV = 0.62 * MONO_SIZE // GT America Mono advance is 620/1000, so mono widths are exact
export const BOX_H = 34
export const PAD_X = 10

// Sans widths are not predictable; render.mjs measures every `.sans[data-key]` element
// into widths.json and this picks them up on the next pass.
let measured: Record<string, number> = {}
try {
  measured = JSON.parse(readFileSync(new URL('./widths.json', import.meta.url), 'utf8'))
} catch {}
export function sansWidth(key: string, text: string, size: number) {
  return measured[key] ?? text.length * 0.5 * size
}

// ---------- primitives ----------

export function monoBoxWidth(term: string) {
  return Math.round(term.length * MONO_ADV + PAD_X * 2)
}

/** A term in a rounded box, mono text, vertically centered. */
export function monoBox(x: number, y: number, term: string, hot = false, opacity = 1) {
  const w = monoBoxWidth(term)
  return [
    `<g opacity="${opacity}">`,
    `<rect x="${x}" y="${y}" width="${w}" height="${BOX_H}" rx="3" fill="${hot ? BOX_FILL_HOT : BOX_FILL}" stroke="${hot ? BOX_STROKE_HOT : BOX_STROKE}" stroke-width="1.25"/>`,
    `<text x="${x + PAD_X}" y="${y + BOX_H / 2}" class="mono" fill="${hot ? GREEN : GREEN_TEXT_DIM}" dominant-baseline="central">${term}</text>`,
    `</g>`,
  ].join('\n')
}

/** Sans phrase on a baseline. data-key lets render.mjs measure it. */
export function sans(key: string, x: number, y: number, text: string, size: number, color: string, weight = 400) {
  return `<text data-key="${key}" x="${x}" y="${y}" class="sans" font-size="${size}" font-weight="${weight}" fill="${color}" letter-spacing="${(-0.015 * size).toFixed(2)}">${text}</text>`
}

export function monoLabel(x: number, y: number, text: string, color: string, anchor: 'start' | 'middle' | 'end' = 'start') {
  return `<text x="${x}" y="${y}" class="mono-label" fill="${color}" text-anchor="${anchor}">${text}</text>`
}

export function dot(x: number, y: number, color = LINE, r = 2.5) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`
}

/** Orthogonal polyline: pass an SVG path `d` built from M/H/V. */
export function ortho(d: string, color = LINE) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>`
}

/** Loose S-curve from (x0,y0) to (x1,y1); for connections into informal content. */
export function curve(x0: number, y0: number, x1: number, y1: number, color = LINE) {
  const dx = x1 - x0
  const c1x = x0 + dx * 0.55
  const c1y = y0 + (y0 < y1 ? 30 : -30)
  const c2x = x1 - dx * 0.25
  const c2y = y1 + (y0 < y1 ? -9 : 9)
  return `<path d="M${x0} ${y0} C${c1x} ${c1y} ${c2x} ${c2y} ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="1.5"/>`
}

/** Deterministic hash in [0,1) for dither and jitter that survives re-renders. */
export function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0
  h = ((h ^ (h >>> 13)) * 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function svg(layers: Record<string, string[]>) {
  const body = Object.entries(layers)
    .map(([id, els]) => `  <g id="${id}">\n    ${els.join('\n    ')}\n  </g>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>
    @font-face { font-family: 'GT America Mono'; src: url('fonts/GT-America-Mono-Regular-OCC.woff2') format('woff2'); }
    @font-face { font-family: 'SuisseIntl'; font-weight: 300; src: url('fonts/SuisseIntl-Light-WebS.woff2') format('woff2'); }
    @font-face { font-family: 'SuisseIntl'; font-weight: 400; src: url('fonts/SuisseIntl-Regular-WebS.woff2') format('woff2'); }
    @font-face { font-family: 'SuisseIntl'; font-weight: 500; src: url('fonts/SuisseIntl-Medium-WebS.woff2') format('woff2'); }
    .mono { font-family: 'GT America Mono', monospace; font-size: ${MONO_SIZE}px; }
    .mono-label { font-family: 'GT America Mono', monospace; font-size: 20px; letter-spacing: 0.8px; }
    .sans { font-family: 'SuisseIntl', 'Inter', sans-serif; }
  </style>
  <rect width="${W}" height="${H}" fill="${BG}"/>
${body}
</svg>
`
}

// ---------- COMPOSITION (replace) ----------

const left: string[] = []
const lines: string[] = []
const right: string[] = []

const rowY = 6 * CH
const a = { x: MARGIN, term: 'sled_agent' }
left.push(monoBox(a.x, rowY - BOX_H / 2, a.term, true))
const aRight = a.x + monoBoxWidth(a.term)

const phrase = { key: 'p1', text: 'need a box for CI by Friday', size: 40, x: 12 * U }
right.push(sans(phrase.key, phrase.x, rowY + 14, phrase.text, phrase.size, RAISE))
const overflow = phrase.x + sansWidth(phrase.key, phrase.text, phrase.size) - (W - MARGIN)
if (overflow > 0) console.error(`"${phrase.text}" overflows the right margin by ${Math.round(overflow)}px`)

const forkX = (aRight + phrase.x - 14) / 2
lines.push(ortho(`M${aRight + 2} ${rowY} H${forkX}`), dot(aRight + 2, rowY))
lines.push(curve(forkX, rowY, phrase.x - 14, rowY), dot(phrase.x - 14, rowY, LINE, 3))

process.stdout.write(svg({ left, lines, right }))
