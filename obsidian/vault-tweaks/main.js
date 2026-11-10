// Personal Obsidian plugin. Plain JS, no build step, so it also runs on iOS.
// Source lives in dotfiles; install.sh copies it into the vault (Obsidian Sync
// carries it to other devices).
//
// It never interprets note content, unlike Templater's trigger on file
// creation, which runs <% %> code found in any new note.

const { Notice, Plugin, TFile, moment } = require("obsidian")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Notes in these folders are named after their `date` (one entry per day)
const NAMED_BY_DATE = ["Notes/Moods"]

module.exports = class VaultTweaks extends Plugin {
  onload() {
    // Obsidian fires "create" for every file while loading the vault
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => this.stampCreated(file)))
    })
    this.registerEvent(this.app.metadataCache.on("changed", (file, _, cache) => this.nameByDate(file, cache)))
    this.scopeValueSuggestions()
    this.addDateCommand("set-date-today", "Set date to today", "date", "calendar-plus")
    this.addDateCommand(
      "set-end-date-today",
      "Set end date to today",
      "date_end",
      "calendar-check",
    )
  }

  // Sets a date property on the note being edited (including a note open in a
  // base's popover) to today. Bind a hotkey, or add it to the mobile toolbar.
  addDateCommand(id, name, key, icon) {
    this.addCommand({
      id,
      name,
      icon, // shown on the mobile toolbar
      checkCallback: (checking) => {
        const file = this.app.workspace.activeEditor?.file ??
          this.app.workspace.getActiveFile()
        if (!(file instanceof TFile) || file.extension !== "md") return false
        if (!checking) {
          this.app.fileManager.processFrontMatter(file, (fm) => {
            fm[key] = moment().format("YYYY-MM-DD")
          })
        }
        return true
      },
    })
  }

  // A note made with a base's New button starts as Untitled. In a
  // NAMED_BY_DATE folder, it's renamed to its date once `date` is set.
  async nameByDate(file, cache) {
    if (!NAMED_BY_DATE.includes(file.parent?.path) || !file.basename.startsWith("Untitled")) return
    const date = cache.frontmatter?.date
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    const path = `${file.parent.path}/${date}.md`
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`vault-tweaks: not renaming ${file.basename}, ${path} already exists`)
      return
    }
    await this.app.fileManager.renameFile(file, path)
  }

  // A new note without `created` gets it, set to the file's creation time.
  // Notes that already have it (imports, notes synced from a device that
  // stamped them) are left alone. An empty note is stamped right away; one
  // created with content (from a base, a template, an agent) gets a moment for
  // its creator to finish writing first.
  async stampCreated(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return
    if ((await this.app.vault.read(file)).trim()) await sleep(1500)
    const text = await this.app.vault.read(file)
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
    if (/^created:[ \t]*\S/m.test(frontmatter)) return
    const created = moment(file.stat.ctime).format("YYYY-MM-DDTHH:mm")
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.created ??= created
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
