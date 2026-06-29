import $ from "@david/dax"
import type { Item, Watcher } from "../types.ts"

const PKG = "@anthropic-ai/claude-code"

/**
 * The "installable now" signal for Claude Code: the latest version published to
 * npm. Emitting just the latest version as one item means the diff stage fires
 * exactly when a new release goes live. Auto-upgrade is already on, so the
 * notification's job is to prompt a restart to pick it up.
 */
export const ccNpm: Watcher = {
  name: "cc-npm",
  async fetch(): Promise<Item[]> {
    const version = (await $`npm view ${PKG} version`.text()).trim()
    return [{
      id: version,
      title: `Claude Code ${version} on npm`,
      body: `${version} is the latest published ${PKG}. ` +
        `Restart Claude Code to pick it up (auto-upgrade applies on restart).`,
      url: `https://www.npmjs.com/package/${PKG}/v/${version}`,
    }]
  },
}
