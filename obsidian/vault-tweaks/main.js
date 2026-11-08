// Personal Obsidian plugin. Plain JS, no build step, so it also runs on iOS.
// Source lives in dotfiles; install.sh copies it into the vault (Obsidian Sync
// carries it to other devices).
//
// It never interprets note content, unlike Templater's trigger on file
// creation, which runs <% %> code found in any new note.

const { Notice, Plugin, TFile, moment } = require("obsidian")

module.exports = class VaultTweaks extends Plugin {
  onload() {
    // Obsidian fires "create" for every file while loading the vault
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => this.stampCreated(file)))
    })
    this.scopeValueSuggestions()
  }

  // A new, empty note gets `created`. Notes that arrive with content (Sync,
  // agents, imports) are left alone; whatever writes them sets `created`.
  async stampCreated(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return
    if ((await this.app.vault.read(file)).trim()) return
    const now = moment().format("YYYY-MM-DDTHH:mm")
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.created ??= now
    })
  }

  // Property value suggestions come only from notes in the active file's
  // top-level folder, so `genre` in Games/ suggests game genres, not book ones.
  // In a base, the active file is the .base, so its folder applies. Notes at
  // the vault root keep vault-wide suggestions.
  //
  // This replaces an undocumented internal (checked in Obsidian 1.14.4), so it
  // checks that the internal still looks the same and warns loudly if not. It
  // can't detect Obsidian ceasing to call it; suggestions would just go back to
  // vault-wide.
  scopeValueSuggestions() {
    const cache = this.app.metadataCache
    const name = "getFrontmatterPropertyValuesForKey"
    const original = cache[name]
    let probe
    try {
      probe = typeof original === "function" && original.call(cache, "created")
    } catch (e) {
      console.error(e)
    }
    if (!Array.isArray(probe) || probe.some((v) => typeof v !== "string")) {
      const message = `vault-tweaks: folder-scoped property suggestions are off. ` +
        `Obsidian's internal metadataCache.${name} changed.`
      console.error(message, { original, probe })
      new Notice(message, 0)
      return
    }

    const app = this.app
    const wasOwn = Object.hasOwn(cache, name)
    this.register(() => wasOwn ? (cache[name] = original) : delete cache[name])
    cache[name] = function (key) {
      const folder = app.workspace.getActiveFile()?.path.split("/").slice(0, -1)[0]
      if (!key || !folder) return original.call(this, key)
      const values = new Set()
      for (const file of app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(folder + "/")) continue
        const value = app.metadataCache.getFileCache(file)?.frontmatter?.[key]
        for (const v of Array.isArray(value) ? value : [value]) {
          if (typeof v === "string" && v) values.add(v)
        }
      }
      return [...values].sort((a, b) => a.localeCompare(b))
    }
  }
}
