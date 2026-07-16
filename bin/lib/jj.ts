import $ from "@david/dax"

const localBookmarkNames =
  `json(self.local_bookmarks().map(|bookmark| bookmark.name())) ++ "\\n"`

/** Local bookmark names on commits in a revset, preserving jj log order. */
export async function bookmarksInLogOrder(revset: string): Promise<string[]> {
  const lines =
    await $`jj log --ignore-working-copy --no-graph --no-pager -r ${revset} -T ${localBookmarkNames}`
      .lines()
  return lines.flatMap((line) => JSON.parse(line) as string[])
}

/**
 * Local bookmarks on the closest bookmarked ancestor commits of `to`.
 * Merge ancestry can produce multiple commits, and a commit can have multiple
 * bookmark names, so the result is intentionally plural.
 */
export function closestBookmarks(to = "@"): Promise<string[]> {
  return bookmarksInLogOrder(`closest_bookmarks(${to})`)
}

/**
 * The first closest ancestor bookmark in jj log order.
 * Throws if `to` has no bookmarked ancestors; use `closestBookmarks()` when
 * merge ancestry or multiple names on one commit need explicit handling.
 */
export async function closestBookmark(to = "@"): Promise<string> {
  const bookmarks = await closestBookmarks(to)
  if (bookmarks.length === 0) throw new Error(`No bookmark found in ancestors of ${to}`)
  return bookmarks[0]
}

/**
 * All local bookmarks on commits reachable from `to` but not already in trunk,
 * in tip-first jj log order. For a linear series of branches, these are the
 * bookmarks in the current stack.
 */
export function stackBookmarks(to = "@"): Promise<string[]> {
  return bookmarksInLogOrder(`stack_bookmarks(${to})`)
}

/**
 * Whether a revset both parses successfully and resolves to at least one
 * commit. A valid revset that matches no commits returns false.
 */
export async function revsetNonEmpty(revset: string): Promise<boolean> {
  const result =
    await $`jj log --ignore-working-copy --no-graph --no-pager -r ${revset} -T ${'"x"'}`
      .noThrow().quiet()
  return result.code === 0 && result.stdout.trim().length > 0
}
