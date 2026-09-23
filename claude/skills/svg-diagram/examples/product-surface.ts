// Generates seam.svg: system vocabulary (left) | product surface band | human activity (right)
// Run: bun gen.ts > seam.svg && node render.mjs $PWD/seam.svg $PWD/seam.png
//
// v3: left side is right-aligned rows pressed against the band. Terms a surface noun
// touches sit at the row's right end; deeper machinery drifts left and dims.

const W = 1920
const H = 1080
const U = W / 77 // cell width ≈ 24.94
const CH = H / 22 // cell height ≈ 49.09
const MARGIN = 3 * U // ≈ 74.8

const BG = '#080f11'
const GREEN = '#48d597'
const GREEN_TEXT_DIM = '#3d9c72'
const BOX_FILL = '#0b1a18'
const BOX_FILL_HOT = '#0f2a24'
const BOX_STROKE = '#183a30'
const BOX_STROKE_HOT = '#2e7a5c'
const BAND_FILL = '#0d1618'
const BAND_STROKE = '#1c2628'
const LINE = '#8a9396'
const LINE_SOFT = '#5c6669'
const RAISE = '#e7e9ea'
const SECONDARY = '#a1a6a8'
const TERTIARY = '#5f6769'

// ---------- geometry ----------

// left pile and right column stay put; the band sits between them with equal gaps (~78px each)
const RIGHT_EDGE = 841 // right edge of the pile
const BAND_W = 150
const BAND_X0 = 919
const BAND_X1 = BAND_X0 + BAND_W // 1069
const BAND_Y0 = 1.25 * CH
const BAND_Y1 = 20 * CH
const TRUNK_X = (RIGHT_EDGE + BAND_X0) / 2 // fork in the middle of the gap

const MONO_SIZE = 17
const MONO_ADV = 0.62 * MONO_SIZE
const BOX_H = 34
const PAD_X = 10
const GAP_X = 1 * U
const ROW_PITCH = (BAND_Y1 - BAND_Y0 - 20 - BOX_H) / 15 // spread 16 rows over the band
const ROW0_CY = BAND_Y0 + 10 + BOX_H / 2

function boxWidth(term: string) {
  return Math.round(term.length * MONO_ADV + PAD_X * 2)
}
function rowCY(i: number) {
  return ROW0_CY + i * ROW_PITCH
}

// ---------- left: rows, listed from the band outward (rightmost term first) ----------

const ROWS: string[][] = [
  ['saga_dag', 'nexus', 'blueprint', 'blueprint_planner', 'reconfigurator'],
  ['sled_agent', 'omicron_zone', 'inventory_collection', 'zone_setup'],
  ['vmm_reservoir', 'propolis', 'saga_recovery', 'instance_manager'],
  ['opte_port', 'opte', 'nat_entry', 'v2p_mappings', 'ddm_reconciler'],
  ['trust_quorum', 'bootstore', 'mgs', 'hubris', 'sp_sim', 'ipcc'],
  ['instance_reincarnation', 'service_processor', 'hardware_monitor'],
  ['abandoned_vmm_reaper', 'sw_caboose', 'installinator', 'tuf_trust_root'],
  ['karmic_state', 'webhook_deliverator', 'wicketd', 'zone_bundle'],
  ['dendrite', 'maghemite', 'rack_setup_service', 'bfd_session'],
  ['oximeter', 'ereport_ingester', 'bgp_peer', 'bgp_announce_set'],
  ['virtual_provisioning_collection', 'uplink', 'metrics_producer_gc'],
  ['clickhouse_keeper', 'timeseries_schema', 'crdb_node_id_collector'],
  ['read_only_parent', 'upstairs', 'downstairs', 'upstairs_repair_progress'],
  ['crucible', 'crucible_pantry', 'phantom_disks', 'physical_disk_adoption'],
  ['volume_construction_request', 'zpool', 'decommissioned_disk_cleaner'],
  ['region_snapshot', 'dataset', 'tuf_repo_pruner', 'fm_sitrep'],
]

type Box = { x: number; y: number; w: number; h: number; term: string; row: number }
const boxes = new Map<string, Box>()
ROWS.forEach((terms, ri) => {
  let right = RIGHT_EDGE
  const cy = rowCY(ri)
  for (const term of terms) {
    const w = boxWidth(term)
    const x = right - w
    if (x < MARGIN) console.error(`row ${ri} runs past the left margin at ${term}`)
    boxes.set(term, { x, y: cy - BOX_H / 2, w, h: BOX_H, term, row: ri })
    right = x - GAP_X
  }
})
const lastBottom = rowCY(ROWS.length - 1) + BOX_H / 2
if (lastBottom > BAND_Y1) console.error(`rows overflow the band: ${Math.round(lastBottom)} > ${Math.round(BAND_Y1)}`)

// ---------- right: human activity ----------
// Left-aligned rows on an even pitch (mirror of the left pile), no rotation; size and
// tone carry the wiggle. Widths come from widths.json, written by render.mjs on the
// previous pass (estimate on the first pass).

import { readFileSync } from 'node:fs'
let measured: Record<string, number> = {}
try {
  measured = JSON.parse(readFileSync(new URL('./widths.json', import.meta.url), 'utf8'))
} catch {}

type Frag = { t: string; size: number; color: string; weight?: number; x?: number; y?: number }
const FRAGS: Record<string, Frag> = {
  ci: { t: 'need a box for CI by Friday', size: 40, color: RAISE },
  reboot: { t: 'just reboot it', size: 28, color: TERTIARY },
  yesterday: { t: 'it worked yesterday', size: 28, color: TERTIARY },
  slow: { t: 'why is this so slow?', size: 32, color: SECONDARY },
  hire: { t: 'give the new hire access', size: 30, color: SECONDARY },
  windows: { t: 'the windows license thing', size: 26, color: TERTIARY },
  ip: { t: 'where did the IP go?', size: 28, color: SECONDARY },
  demo: { t: 'demo at 2', size: 52, color: RAISE, weight: 500 },
  running: { t: 'is that thing still running?', size: 36, color: RAISE },
  backup: { t: 'back it up first', size: 24, color: TERTIARY },
  intern: { t: 'can the intern see prod?', size: 28, color: SECONDARY },
  cost: { t: 'how much is this costing us', size: 26, color: TERTIARY },
  staging: { t: 'who deleted the staging db', size: 38, color: RAISE },
  three: { t: 'spin up three more', size: 28, color: SECONDARY },
  ssh: { t: 'ssh isn\u2019t working', size: 30, color: SECONDARY },
  rack: { t: 'is the rack ok?', size: 28, color: TERTIARY },
  space: { t: 'we\u2019re almost out of space', size: 44, color: RAISE },
  internet: { t: 'does it have internet?', size: 28, color: TERTIARY },
  update: { t: 'did the update finish?', size: 28, color: SECONDARY },
  sshkey: { t: 'the ssh key thing again', size: 26, color: TERTIARY },
  silo: { t: 'wait, what\u2019s a silo', size: 34, color: SECONDARY },
  oncall: { t: 'who\u2019s on call', size: 26, color: TERTIARY },
  testing: { t: 'just a small one for testing', size: 30, color: SECONDARY },
  disk: { t: 'can I just get a bigger disk', size: 34, color: SECONDARY },
  ship: { t: 'it\u2019s fine, ship it', size: 26, color: TERTIARY },
}

const RIGHT_X0 = 46 * U // ≈ 1147, leaves ~110px for the curves
const RIGHT_ROW0 = BAND_Y0 + 72
const RIGHT_PITCH = (BAND_Y1 - 49 - RIGHT_ROW0) / 12 // 13 rows
const RIGHT_GAP = 48
const RIGHT_ROWS: string[][] = [
  ['ci', 'reboot'],
  ['yesterday', 'slow'],
  ['hire', 'windows'],
  ['ip', 'demo'],
  ['running', 'backup'],
  ['intern', 'cost'],
  ['staging', 'rack'],
  ['ssh', 'three'],
  ['space'],
  ['internet', 'update'],
  ['sshkey', 'silo'],
  ['testing', 'oncall'],
  ['disk', 'ship'],
]

function fragWidth(key: string) {
  const f = FRAGS[key]
  return measured[key] ?? f.t.length * 0.5 * f.size
}

const right: string[] = []
RIGHT_ROWS.forEach((keys, ri) => {
  let x = RIGHT_X0
  const y = RIGHT_ROW0 + ri * RIGHT_PITCH
  for (const key of keys) {
    const f = FRAGS[key]
    f.x = x
    f.y = y
    const w = fragWidth(key)
    if (x + w > W - MARGIN) console.error(`right row ${ri} overflows at "${f.t}" (${Math.round(x + w)})`)
    right.push(
      `<text data-key="${key}" x="${x}" y="${y}" class="sans" font-size="${f.size}" font-weight="${f.weight ?? 400}" fill="${f.color}" letter-spacing="${(-0.015 * f.size).toFixed(2)}">${f.t}</text>`,
    )
    x += w + RIGHT_GAP
  }
})

// ---------- band: the product surface ----------

const band: string[] = []
band.push(
  `<rect x="${BAND_X0}" y="${BAND_Y0}" width="${BAND_X1 - BAND_X0}" height="${BAND_Y1 - BAND_Y0}" fill="${BAND_FILL}" stroke="${BAND_STROKE}" stroke-width="1"/>`,
)

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0
  h = ((h ^ (h >>> 13)) * 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const DITHER_CHARS = ['·', '·', ':', '·', '+', '·']
const dcol = U / 2
const drow = CH / 4
for (let i = 0; i < (BAND_X1 - BAND_X0) / dcol; i++) {
  const x = BAND_X0 + dcol / 2 + i * dcol
  const t = (x - BAND_X0) / (BAND_X1 - BAND_X0)
  const p = 0.85 * Math.pow(1 - t, 1.6)
  for (let j = 0; j < (BAND_Y1 - BAND_Y0) / drow; j++) {
    const y = BAND_Y0 + drow / 2 + j * drow
    if (hash(i, j) > p) continue
    const ch = DITHER_CHARS[Math.floor(hash(j, i) * DITHER_CHARS.length)]
    band.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="mono" font-size="11" fill="#2b3b3d" text-anchor="middle" dominant-baseline="central">${ch}</text>`)
  }
}

// ---------- channels ----------

// noun sits at the vertical center of its target rows
type Channel = { noun: string; frag: string; targets: string[]; dir: 'in' | 'out' }
const CHANNELS: Channel[] = [
  { noun: 'instance', frag: 'ci', targets: ['saga_dag', 'sled_agent', 'vmm_reservoir', 'opte_port'], dir: 'in' },
  { noun: 'instance state', frag: 'running', targets: ['instance_reincarnation', 'abandoned_vmm_reaper', 'karmic_state'], dir: 'out' },
  { noun: 'utilization', frag: 'space', targets: ['oximeter', 'virtual_provisioning_collection', 'clickhouse_keeper'], dir: 'in' },
  { noun: 'disk', frag: 'disk', targets: ['crucible', 'volume_construction_request', 'region_snapshot'], dir: 'in' },
]

const hot = new Set<string>()
const chan: string[] = []
const BAND_CX = (BAND_X0 + BAND_X1) / 2

function arrowLeft(x: number, y: number, color: string) {
  return `<path d="M${x + 7} ${y - 4} L${x} ${y} L${x + 7} ${y + 4}" fill="none" stroke="${color}" stroke-width="1.5"/>`
}
function arrowRight(x: number, y: number, color: string) {
  return `<path d="M${x - 7} ${y - 4} L${x} ${y} L${x - 7} ${y + 4}" fill="none" stroke="${color}" stroke-width="1.5"/>`
}

for (const c of CHANNELS) {
  for (const t of c.targets) hot.add(t)
  const color = LINE
  const dash = ''
  const targets = c.targets.map((t) => boxes.get(t)!).filter(Boolean)
  const ys = targets.map((b) => b.y + b.h / 2)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const cy = Math.round((yMin + yMax) / 2)

  // noun box, centered in the band
  const w = Math.round(c.noun.length * MONO_ADV + 22)
  const bx = BAND_CX - w / 2
  chan.push(
    `<rect x="${bx}" y="${cy - BOX_H / 2}" width="${w}" height="${BOX_H}" rx="3" fill="${BG}" stroke="${GREEN}" stroke-width="1.5"/>`,
    `<text x="${BAND_CX}" y="${cy}" class="mono" fill="${RAISE}" text-anchor="middle" dominant-baseline="central">${c.noun}</text>`,
  )

  // system side: short trunk beside the band, stubs straight into each target's right edge
  chan.push(`<path d="M${bx} ${cy} H${TRUNK_X}" fill="none" stroke="${color}" stroke-width="1.5"${dash}/>`)
  chan.push(`<line x1="${TRUNK_X}" y1="${yMin}" x2="${TRUNK_X}" y2="${yMax}" stroke="${color}" stroke-width="1.5"${dash}/>`)
  chan.push(`<circle cx="${TRUNK_X}" cy="${cy}" r="2.5" fill="${color}"/>`)
  for (const b of targets) {
    const y = b.y + b.h / 2
    const xEnd = b.x + b.w
    chan.push(`<line x1="${TRUNK_X}" y1="${y}" x2="${xEnd + 1}" y2="${y}" stroke="${color}" stroke-width="1.5"${dash}/>`)
    chan.push(`<circle cx="${xEnd + 2}" cy="${y}" r="2.5" fill="${color}"/>`)
  }

  // human side: loose curve from the phrase to the band edge
  const f = FRAGS[c.frag]
  const px = f.x! - 14
  const py = f.y! - f.size * 0.33
  const x1 = BAND_X1
  const c1x = px - (px - x1) * 0.45
  const c1y = py + (py < cy ? -30 : 30)
  const c2x = x1 + (px - x1) * 0.25
  const c2y = cy + (py < cy ? 22 : -22) * 0.4
  chan.push(`<path d="M${px} ${py} C${c1x} ${c1y} ${c2x} ${c2y} ${bx + w} ${cy}" fill="none" stroke="${color}" stroke-width="1.5"${dash}/>`)
  chan.push(`<circle cx="${px}" cy="${py}" r="3" fill="${color}"/>`)
}

// ---------- draw the term boxes: hot ones bright, the rest dimming with depth ----------

const left: string[] = []
for (const b of boxes.values()) {
  const isHot = hot.has(b.term)
  const depth = Math.min(1, (RIGHT_EDGE - (b.x + b.w)) / 520) // 0 at the band, 1 far left
  const opacity = isHot ? 1 : (0.95 - 0.45 * depth).toFixed(2)
  left.push(
    `<g opacity="${opacity}">`,
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${isHot ? BOX_FILL_HOT : BOX_FILL}" stroke="${isHot ? BOX_STROKE_HOT : BOX_STROKE}" stroke-width="1.25"/>`,
    `<text x="${b.x + PAD_X}" y="${b.y + b.h / 2}" class="mono" fill="${isHot ? GREEN : GREEN_TEXT_DIM}" dominant-baseline="central">${b.term}</text>`,
    `</g>`,
  )
}

// ---------- labels ----------

const labels = [
  `<text x="${BAND_CX}" y="${21.2 * CH}" class="mono-label" fill="${RAISE}" text-anchor="middle">PRODUCT SURFACE</text>`,
]

const svg = `<?xml version="1.0" encoding="UTF-8"?>
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
  <g id="band">
    ${band.join('\n    ')}
  </g>
  <g id="left">
    ${left.join('\n    ')}
  </g>
  <g id="channels">
    ${chan.join('\n    ')}
  </g>
  <g id="right">
    ${right.join('\n    ')}
  </g>
  <g id="labels">
    ${labels.join('\n    ')}
  </g>
</svg>
`

process.stdout.write(svg)
