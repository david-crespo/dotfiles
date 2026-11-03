/**
 * A list picker where Enter and letter keys each submit the highlighted row
 * with an action, plus helpers for fitting columns to the terminal. Adapted
 * from the history picker in llm-cli.
 */
import process from "node:process"
import { stripVTControlCharacters } from "node:util"
import {
  createPrompt,
  ExitPromptError,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePagination,
  useState,
} from "@inquirer/core"
import confirm from "@inquirer/confirm"
import { unicodeWidth } from "@std/cli/unicode-width"
import { dim } from "@std/fmt/colors"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Display width in terminal cells, ignoring color codes */
export function textWidth(text: string): number {
  return unicodeWidth(stripVTControlCharacters(text))
}

/** Cut plain text to `maxWidth` cells, ending in … if anything was cut */
export function truncateWidth(text: string, maxWidth: number): string {
  if (textWidth(text) <= maxWidth) return text
  if (maxWidth <= 0) return ""
  let result = ""
  let width = 0
  for (const { segment } of graphemes.segment(text)) {
    const segmentWidth = unicodeWidth(segment)
    if (width + segmentWidth >= maxWidth) break
    result += segment
    width += segmentWidth
  }
  return result.trimEnd() + "…"
}

export function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - textWidth(text)))
}

export function terminalColumns(): number {
  return process.stdout.columns ?? 120
}

/** A barely-there blue background for the active row */
const TINT = "\x1b[48;2;28;38;60m"

/**
 * Give a line the tint across the terminal width without touching its text
 * colors. A full reset (jj's colored change IDs use one) or a background
 * reset inside the line would end the tint, so the tint goes back on after
 * each.
 */
function tint(line: string): string {
  // one short of the width so the line can't wrap
  const padded = padEnd(line, terminalColumns() - 1)
  // deno-lint-ignore no-control-regex
  return TINT + padded.replace(/\x1b\[(?:0|49)?m/g, `$&${TINT}`) + "\x1b[0m"
}

/** Keys in a light gray so they stand apart from their dim labels */
function formatHints(hints: [key: string, label: string][]): string {
  const key = (k: string) => `\x1b[38;5;250m${k}\x1b[39m`
  return hints.map(([k, label]) => `${key(k)} ${dim(label)}`).join(dim(" · "))
}

type Picked<A> = { index: number; action: A | "quit" }

interface PickerConfig<A> {
  message: string
  options: string[]
  initialIndex?: number
  /** Action for Enter */
  enter: A
  /** Letter keys to actions. Uppercase letters mean shift. */
  keys: Record<string, A>
  /** Key and what it does, for the line under the list */
  hints: [key: string, label: string][]
  pageSize: number
}

const actionSelect = createPrompt<Picked<string>, PickerConfig<string>>(
  (config, done) => {
    const theme = makeTheme()
    const [active, setActive] = useState(config.initialIndex ?? 0)
    const [picked, setPicked] = useState<Picked<string> | undefined>(undefined)
    const last = config.options.length - 1

    useKeypress((key) => {
      let action: string | undefined
      if (isEnterKey(key)) action = config.enter
      else if (key.name === "q" || key.name === "escape") action = "quit"
      else if (!key.ctrl) {
        action = config.keys[key.shift ? key.name.toUpperCase() : key.name]
      }
      if (action !== undefined) {
        const result = { index: active, action }
        setPicked(result)
        done(result)
      } else if (isUpKey(key, ["vim"])) setActive(Math.max(0, active - 1))
      else if (isDownKey(key, ["vim"])) setActive(Math.min(last, active + 1))
      else if (key.name === "pageup") setActive(Math.max(0, active - config.pageSize))
      else if (key.name === "pagedown") setActive(Math.min(last, active + config.pageSize))
    })

    const page = usePagination({
      items: config.options,
      active,
      pageSize: config.pageSize,
      loop: false,
      renderItem: ({ item, isActive }) =>
        isActive ? tint(`${theme.style.highlight("❯")} ${item}`) : `  ${item}`,
    })

    // Whatever the action, leave no trace of the picker
    if (picked) return ""
    const message = theme.style.message(config.message, "idle")
    // Hide the cursor, which would otherwise sit at the end of the list, as
    // inquirer's select does. Inquirer shows it again when the prompt ends.
    const hideCursor = "\x1b[?25l"
    return [`${message}\n${page}${hideCursor}`, formatHints(config.hints)]
  },
)

/**
 * Pick a row and an action for it. Enter and the letter keys in `keys` pick
 * an action; q, Esc and Ctrl+C return undefined.
 */
export async function pickWithAction<A extends string>(
  opts: Omit<PickerConfig<A>, "pageSize">,
): Promise<{ index: number; action: A } | undefined> {
  try {
    const { index, action } = await actionSelect({
      ...opts,
      // leave room for the message and hint lines
      pageSize: Math.max(3, (process.stdout.rows ?? 24) - 3),
    })
    return action === "quit" ? undefined : { index, action: action as A }
  } catch (e) {
    if (e instanceof ExitPromptError) return undefined
    throw e
  }
}

/** A yes/no question that defaults to no. Ctrl+C also counts as no. */
export async function confirmed(message: string): Promise<boolean> {
  try {
    return await confirm({ message, default: false }, { clearPromptOnDone: true })
  } catch (e) {
    if (e instanceof ExitPromptError) return false
    throw e
  }
}
