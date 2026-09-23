import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [svgPath, pngPath] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await page.goto(`file://${svgPath}`, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: pngPath })
// measure every keyed text element so gen.ts can lay them out exactly on the next pass
const widths = await page.evaluate(() =>
  Object.fromEntries(
    [...document.querySelectorAll('text[data-key]')].map((t) => [t.dataset.key, Math.ceil(t.getComputedTextLength())]),
  ),
)
writeFileSync(join(dirname(svgPath), 'widths.json'), JSON.stringify(widths, null, 2))
await browser.close()
