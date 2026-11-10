// Personal Obsidian plugin. Plain JS, no build step, so it also runs on iOS.
// Source lives in dotfiles; install.sh copies it into the vault (Obsidian Sync
// carries it to other devices).
//
// It never interprets note content, unlike Templater's trigger on file
// creation, which runs <% %> code found in any new note.

const { BasesView, Keymap, Menu, Notice, Plugin, TFile, moment, setIcon } = require("obsidian")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Notes in these folders are named after their `date` (one entry per day)
const NAMED_BY_DATE = ["Notes/Moods"]

// A list view for bases of things done on a date (Games, Books, TV and
// Movies), laid out like a Notion list: the title on the left and the view's
// other properties together on the right, formatted by type. Lists are
// colored chips, `hours` gets a unit, and `date` shows `date_end` with it as
// a range. Choose it as "Rich list" in a base's view menu (`type: rich-list`
// in the .base file); the view's properties menu picks what's shown, as in
// the built-in list.
class RichListView extends BasesView {
  type = "rich-list"

  // Makes this view a HoverParent, for page previews
  hoverPopover = null

  constructor(controller, containerEl) {
    super(controller)
    this.el = containerEl.createDiv("vt-rich-list")
  }

  onDataUpdated() {
    const order = this.config.getOrder()
    const props = order.filter((p) =>
      p !== "file.name" && !(p === "note.date_end" && order.includes("note.date"))
    )
    this.el.empty()
    const groups = this.data.groupedData
    for (const group of groups) {
      if (group.hasKey() || groups.length > 1) {
        const text = group.hasKey() ? group.key.toString() : "None"
        this.el.createDiv({ cls: "vt-group", text })
      }
      for (const entry of group.entries) this.renderRow(entry, props)
    }
  }

  // Behaves like a file link: click or Enter opens the note (with modifier
  // keys or middle-click, in a new tab), right-click or long-press shows the
  // file menu, and hovering shows a page preview.
  renderRow(entry, props) {
    const { file } = entry
    const { workspace } = this.app
    const row = this.el.createDiv({ cls: "vt-row", attr: { tabindex: 0 } })
    const open = (evt) => {
      if (evt.target.closest("a")) return
      workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file)
    }
    row.addEventListener("click", open)
    row.addEventListener("auxclick", (evt) => evt.button === 1 && open(evt))
    row.addEventListener("keydown", (evt) => evt.key === "Enter" && open(evt))
    row.addEventListener("contextmenu", (evt) => {
      evt.preventDefault()
      const menu = new Menu()
      const item = (title, icon, section, onClick) =>
        menu.addItem((i) => i.setTitle(title).setIcon(icon).setSection(section).onClick(onClick))
      item("Open in new tab", "file-plus", "open", () => workspace.getLeaf("tab").openFile(file))
      item("Open to the right", "separator-vertical", "open", () =>
        workspace.getLeaf("split").openFile(file))
      item("Delete", "trash-2", "danger", () => this.app.fileManager.promptForDeletion(file))
      // Core plugins add the rest (copy path, reveal, bookmark, move...)
      workspace.trigger("file-menu", menu, file, "bases")
      menu.showAtMouseEvent(evt)
    })
    row.addEventListener("mouseover", (event) => {
      workspace.trigger("hover-link", {
        event,
        source: "bases",
        hoverParent: this,
        targetEl: row,
        linktext: file.path,
      })
    })
    row.createDiv({ cls: "vt-title", text: file.basename })
    const meta = row.createDiv("vt-meta")
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const colors = CHIP_COLORS[file.path.split("/")[0]] ?? {}
    for (const prop of props) {
      const name = prop.slice(prop.indexOf(".") + 1)
      if (prop.startsWith("note.")) {
        renderProperty(meta, name, fm[name], fm, colors)
      } else {
        const value = entry.getValue(prop)
        if (value?.isTruthy()) meta.createSpan({ text: value.toString() })
      }
    }
  }
}

// YAML can give a date property any type, so check before formatting
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)

const formatDate = (s) => moment(s).format("MMM D, YYYY")

function formatRange(start, end) {
  if (!end || end === start) return formatDate(start)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${moment(start).format(sameYear ? "MMM D" : "MMM D, YYYY")} → ${formatDate(end)}`
}

// Genre chip colors by top-level folder, as they were in Notion. Anything not
// listed gets a gray chip.
const CHIP_COLORS = {
  Games: {
    puzzle: "pink", AAA: "gray", action: "brown", mv: "purple", story: "blue",
    procgen: "green", platforming: "red", explore: "yellow", horror: "orange",
    stealth: "purple", card: "pink", board: "green", roguelike: "brown",
    paper: "orange", PuzzleScript: "orange", casual: "gray", strategy: "blue",
  },
  Books: {
    history: "blue", bio: "red", philosophy: "green", math: "brown", computers: "yellow",
    fantasy: "pink", fiction: "green", "sci fi": "gray", society: "green", poetry: "red",
    humor: "green", graphic: "blue", politics: "purple", marxism: "green", kids: "orange",
    short: "purple", design: "brown", science: "orange", classic: "red", art: "brown",
    finance: "blue",
  },
  "TV and Movies": {
    comedy: "orange", fantasy: "pink", kids: "red", action: "brown", drama: "blue",
    reality: "gray", animation: "green", classic: "purple", musical: "yellow",
    documentary: "pink", horror: "green",
  },
}

// Notion's color names in Obsidian's palette, which has no brown or gray
const CHIP_RGB = {
  gray: "var(--mono-rgb-100)",
  brown: "151, 109, 87",
  ...Object.fromEntries(
    ["red", "orange", "yellow", "green", "blue", "purple", "pink"]
      .map((c) => [c, `var(--color-${c}-rgb)`]),
  ),
}

function addChip(cell, text, color) {
  const chip = cell.createSpan({ cls: "vt-chip", text })
  chip.style.setProperty("--vt-chip-rgb", CHIP_RGB[color] ?? CHIP_RGB.gray)
}

function renderProperty(meta, name, value, fm, colors) {
  if (value == null || value === "" || value === false || value.length === 0) return
  const cell = meta.createSpan()
  if (isDate(value)) {
    cell.addClass("vt-date")
    cell.setText(formatRange(value, name === "date" && isDate(fm.date_end) && fm.date_end))
  } else if (Array.isArray(value)) {
    cell.addClass("vt-chips")
    for (const v of value) addChip(cell, String(v), colors[v])
  } else if (value === true) {
    cell.addClass("vt-chips")
    addChip(cell, name)
  } else if (typeof value === "number") {
    cell.addClass("vt-number")
    cell.setText(name === "hours" ? `${value}h` : String(value))
  } else if (/^https?:\/\//.test(value)) {
    const link = cell.createEl("a", {
      cls: "vt-link external-link",
      href: value,
      attr: { "aria-label": value, target: "_blank", rel: "noopener" },
    })
    setIcon(link, "external-link")
  } else {
    cell.addClass("vt-text")
    cell.setText(String(value))
    cell.title = String(value)
  }
}

module.exports = class VaultTweaks extends Plugin {
  onload() {
    this.registerBasesView("rich-list", {
      name: "Rich list",
      icon: "list",
      factory: (controller, containerEl) => new RichListView(controller, containerEl),
    })
    this.registerDomEvent(document, "click", (evt) => this.openBaseFromBreadcrumb(evt), {
      capture: true,
    })
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

  // Clicking a folder in a note's breadcrumbs (above the title) opens the
  // folder's base, if it has one, instead of revealing the folder in the file
  // explorer. The breadcrumbs have no paths in the DOM, so the folder comes
  // from the crumb's position and the open file's path.
  openBaseFromBreadcrumb(evt) {
    const crumb = evt.target.closest?.(".view-header-breadcrumb")
    if (!crumb) return
    let leaf
    this.app.workspace.iterateAllLeaves((l) => {
      if (l.view.containerEl.contains(crumb)) leaf = l
    })
    const file = leaf?.view.file
    if (!file) return
    const crumbs = [...crumb.parentElement.querySelectorAll(".view-header-breadcrumb")]
    const path = file.parent.path.split("/").slice(0, crumbs.indexOf(crumb) + 1).join("/")
    const base = this.app.vault.getFolderByPath(path)?.children
      .find((f) => f instanceof TFile && f.extension === "base")
    if (!base) return
    evt.preventDefault()
    evt.stopPropagation()
    const newLeaf = Keymap.isModEvent(evt)
    ;(newLeaf ? this.app.workspace.getLeaf(newLeaf) : leaf).openFile(base)
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
