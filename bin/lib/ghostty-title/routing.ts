// Ghostty AppleScript discovery and stable tab-targeting primitives.
import $ from "@david/dax"
import { errorMessage, logEvent } from "./events.ts"

const FIELD_SEPARATOR = "|||"
const ITEM_SEPARATOR = "~~~"

export interface TabSnapshot {
  tabId: string
  terminalIds: string[]
}

export interface InitialTerminalInfo {
  terminalId: string
  terminalCount: number
  titleSet: boolean
}

export type TitleWriteResult = "set" | "moved" | "not-found"

export interface GhosttyRouting {
  snapshotForTerminal(terminalId: string): Promise<TabSnapshot | undefined>
  snapshotForTab(tabId: string): Promise<TabSnapshot | undefined>
  setTitle(snapshot: TabSnapshot, title: string): Promise<TitleWriteResult>
}

export class AppleScriptGhosttyRouting implements GhosttyRouting {
  async snapshotForTerminal(terminalId: string): Promise<TabSnapshot | undefined> {
    return parseSnapshot(
      await runAppleScript("snapshot_for_terminal", snapshotScript("terminal"), [
        terminalId,
      ]),
    )
  }

  async snapshotForTab(tabId: string): Promise<TabSnapshot | undefined> {
    return parseSnapshot(
      await runAppleScript("snapshot_for_tab", snapshotScript("tab"), [tabId]),
    )
  }

  async setTitle(snapshot: TabSnapshot, title: string): Promise<TitleWriteResult> {
    const stableTerminalId = snapshot.terminalIds[0]
    if (!stableTerminalId) return "not-found"
    const script = `
on run argv
  set targetTabId to item 1 of argv
  set targetTerminalId to item 2 of argv
  set newTitle to item 3 of argv
  tell application "Ghostty"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        repeat with targetTerminal in terminals of targetTab
          if (id of targetTerminal as text) is targetTerminalId then
            if (id of targetTab as text) is not targetTabId then return "moved"
            perform action ("set_tab_title:" & newTitle) on targetTerminal
            return "set"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "not-found"
end run
`
    const raw = await runAppleScript("set_title", script, [
      snapshot.tabId,
      stableTerminalId,
      title,
    ])
    const result = raw === "set" || raw === "moved" ? raw : "not-found"
    await logEvent(
      result === "set"
        ? "title_set"
        : result === "moved"
        ? "title_target_moved"
        : "terminal_not_found",
      { tabId: snapshot.tabId, terminalId: stableTerminalId, title },
    )
    return result
  }
}

function snapshotScript(target: "terminal" | "tab"): string {
  const predicate = target === "terminal"
    ? `
        set foundTarget to false
        repeat with targetTerminal in terminals of targetTab
          if (id of targetTerminal as text) is targetId then set foundTarget to true
        end repeat`
    : `set foundTarget to ((id of targetTab as text) is targetId)`
  return `
on run argv
  set targetId to item 1 of argv
  tell application "Ghostty"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        ${predicate}
        if foundTarget then
          set terminalIds to ""
          repeat with targetTerminal in terminals of targetTab
            if terminalIds is not "" then set terminalIds to terminalIds & "${ITEM_SEPARATOR}"
            set terminalIds to terminalIds & (id of targetTerminal as text)
          end repeat
          return (id of targetTab as text) & "${FIELD_SEPARATOR}" & terminalIds
        end if
      end repeat
    end repeat
  end tell
  return ""
end run
`
}

function parseSnapshot(raw: string): TabSnapshot | undefined {
  const [tabId, terminalList] = raw.trim().split(FIELD_SEPARATOR)
  if (!tabId || !terminalList) return undefined
  return { tabId, terminalIds: terminalList.split(ITEM_SEPARATOR).filter(Boolean) }
}

export async function frontTerminalId(): Promise<string | undefined> {
  const script = `
tell application "Ghostty"
  if (count of windows) is 0 then return ""
  return (id of focused terminal of selected tab of front window as text)
end tell
`
  return (await runAppleScript("front_terminal_lookup", script, [])) || undefined
}

export async function initializeTerminalForTty(
  tty: string,
  title: string,
): Promise<InitialTerminalInfo | undefined> {
  const script = `
on run argv
  set targetTty to item 1 of argv
  set newTitle to item 2 of argv
  tell application "Ghostty"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        repeat with targetTerminal in terminals of targetTab
          if (tty of targetTerminal as text) is targetTty then
            set terminalCount to count of terminals of targetTab
            set didSet to "skipped"
            if terminalCount is equal to 1 then
              perform action ("set_tab_title:" & newTitle) on targetTerminal
              set didSet to "set"
            end if
            return (id of targetTerminal as text) & "${FIELD_SEPARATOR}" & (terminalCount as text) & "${FIELD_SEPARATOR}" & didSet
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return ""
end run
`
  const [terminalId, count, status] = (
    await runAppleScript("initialize_terminal_for_tty", script, [tty, title])
  ).split(FIELD_SEPARATOR)
  const terminalCount = Number(count)
  const result = terminalId && Number.isInteger(terminalCount)
    ? { terminalId, terminalCount, titleSet: status === "set" }
    : undefined
  await logEvent(result?.titleSet ? "title_set" : "shell_initialized", {
    tty,
    title,
    terminalId: result?.terminalId,
    terminalCount: result?.terminalCount,
    titleSet: result?.titleSet,
  })
  return result
}

export async function paneCountForTerminal(
  terminalId: string,
): Promise<number | undefined> {
  const routing = new AppleScriptGhosttyRouting()
  return (await routing.snapshotForTerminal(terminalId))?.terminalIds.length
}

async function runAppleScript(
  operation: string,
  script: string,
  args: string[],
): Promise<string> {
  return (await $`osascript -e ${script} ${args}`.quiet().text().catch(async (error) => {
    await logEvent("applescript_failed", { operation, error: errorMessage(error) })
    return ""
  })).trim()
}
