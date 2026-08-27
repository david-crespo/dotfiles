#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net=x.com --allow-run=open

// Read-only viewer for a Twitter/X list using your web session cookies.
// Renders in the terminal by default, or as a local HTML page with --html.
//
// Setup: create ~/.config/x-list/config.json with cookies from a logged-in browser
// session (devtools > Application > Cookies > x.com):
//
//   {
//     "auth_token": "...",
//     "ct0": "...",
//     "lists": { "ai": "1234567890123456789" }
//   }
//
// The list ID is the number in the list URL: x.com/i/lists/<id>.
// Last-read position per list is tracked in ~/.local/state/x-list/state.json.
//
// The GraphQL query ID and feature flags are pinned from twscrape (see
// QUERY_ID below). Feature-flag drift self-corrects at request time; if the
// query ID itself ever dies (404), grab the current one from
// https://github.com/vladkens/twscrape/blob/main/twscrape/api.py

import { Command } from "@cliffy/command"
import { bold, cyan, dim, green, yellow } from "@std/fmt/colors"

const home = Deno.env.get("HOME")!
const configPath = `${home}/.config/x-list/config.json`
const cachePath = `${home}/.cache/x-list/features.json`
const statePath = `${home}/.local/state/x-list/state.json`

// How long fetched tweets are served from cache before refetching.
const CACHE_TTL_MS = 5 * 60_000

// ListLatestTweetsTimeline persisted-query ID, pinned from twscrape.
const QUERY_ID = "1LE3u14FJjPZUHKFGzos2g"

// Feature flags the endpoint requires, pinned from twscrape. When X adds or
// removes flags, fetchTimeline self-corrects from the API's error messages
// and the corrected set is cached in ~/.cache/x-list/.
const DEFAULT_FEATURES: Record<string, boolean> = {
  articles_preview_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  premium_content_api_read_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_grok_analysis_button_from_backend: false,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_grok_image_annotation_enabled: false,
  responsive_web_grok_imagine_annotation_enabled: false,
  responsive_web_grok_share_attachment_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_jetfuel_frame: false,
  responsive_web_media_download_video_enabled: false,
  responsive_web_profile_redirect_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  rweb_video_screen_enabled: true,
  rweb_video_timestamps_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_awards_web_tipping_enabled: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  tweet_with_visibility_results_prefer_gql_media_interstitial_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  verified_phone_label_enabled: false,
  view_counts_everywhere_api_enabled: true,
}

// The "Twitter Web App" client token, hardcoded in x.com's public JS bundle
// and identical for all users. It identifies the client application; the
// cookies from the config file are what authenticate the user.
const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"

interface Config {
  auth_token: string
  ct0: string
  lists: Record<string, string>
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path))
  } catch {
    return null
  }
}

async function writeJson(path: string, value: unknown) {
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n")
}

function headers(config: Config): HeadersInit {
  return {
    authorization: `Bearer ${BEARER}`,
    cookie: `auth_token=${config.auth_token}; ct0=${config.ct0}`,
    "x-csrf-token": config.ct0,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  }
}

/** Call the GraphQL endpoint, self-correcting the feature flags: the API
 * names missing/unknown features in its 400 errors. Mutates `features` so
 * the caller can cache the corrected set. */
async function fetchTimeline(
  config: Config,
  features: Record<string, boolean>,
  listId: string,
  count: number,
  cursor?: string,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = `https://x.com/i/api/graphql/${QUERY_ID}/ListLatestTweetsTimeline?` +
      new URLSearchParams({
        variables: JSON.stringify({ listId, count, ...(cursor && { cursor }) }),
        features: JSON.stringify(features),
        fieldToggles: JSON.stringify({ withArticleRichContentState: false }),
      })
    const res = await fetch(url, { headers: headers(config) })
    const body = await res.text()
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `auth failed (${res.status}) — re-copy auth_token and ct0 cookies into ${configPath}`,
      )
    }
    if (res.status === 404) {
      throw new Error(
        "query id no longer valid — update QUERY_ID from " +
          "https://github.com/vladkens/twscrape/blob/main/twscrape/api.py",
      )
    }
    let json
    try {
      json = JSON.parse(body)
    } catch {
      throw new Error(`unexpected response (${res.status}): ${body.slice(0, 200)}`)
    }
    const errors: string[] = (json.errors ?? []).map((e: { message: string }) => e.message)
    const missing = errors.flatMap((msg) => {
      const m = msg.match(/features cannot be null: (.*)/)
      return m ? m[1].split(",").map((s) => s.trim()) : []
    })
    const unknown = errors.flatMap((msg) => {
      const m = msg.match(/following features are not enabled: (.*)/)
      return m ? m[1].split(",").map((s) => s.trim()) : []
    })
    if (missing.length === 0 && unknown.length === 0) {
      if (errors.length > 0 && !json.data?.list) {
        throw new Error(`api error: ${errors.join("; ")}`)
      }
      return json
    }
    for (const f of missing) features[f] = true
    for (const f of unknown) delete features[f]
  }
  throw new Error("could not converge on a working feature set")
}

// ---------- response parsing ----------

/** Pixel dimensions let the HTML reserve space before images load, so
 * anchors and scroll positions don't shift. */
interface Media {
  url: string
  w?: number
  h?: number
}

interface Tweet {
  id: string
  /** Timeline-position ID: for a retweet, the retweet's own ID rather than
   * the (possibly much older) original tweet's. Used for read-state. */
  sortId: string
  handle: string
  name: string
  avatar?: string
  text: string
  createdAt: Date
  likes: number
  retweets: number
  replies: number
  media: Media[]
  retweetedFrom?: string
  quoted?: Tweet
  /** Entry ID of the conversation module this tweet came in, if any.
   * Consecutive tweets sharing one are rendered as a connected thread. */
  threadId?: string
}

/** Tweets as fetched, plus the read-state they were rendered against, so a
 * cached re-render within the TTL shows the same view. */
interface TweetCache {
  fetchedAt: string
  lastRead: string | null
  reachedLastRead: boolean
  tweets: Tweet[]
}

/** Restore Date fields lost to JSON round-tripping through the cache, and
 * normalize media entries cached by older versions as bare strings. */
function reviveTweet(t: Tweet): Tweet {
  return {
    ...t,
    createdAt: new Date(t.createdAt),
    media: (t.media ?? []).map((m) => typeof m === "string" ? { url: m } : m),
    quoted: t.quoted ? reviveTweet(t.quoted) : undefined,
  }
}

// deno-lint-ignore no-explicit-any
function parseUser(result: any): { handle: string; name: string; avatar?: string } {
  const u = result?.core?.user_results?.result ?? {}
  return {
    handle: u.legacy?.screen_name ?? u.core?.screen_name ?? "?",
    name: u.legacy?.name ?? u.core?.name ?? "?",
    avatar: u.legacy?.profile_image_url_https ?? u.avatar?.image_url,
  }
}

// deno-lint-ignore no-explicit-any
export function parseTweet(result: any): Tweet | null {
  if (result?.__typename === "TweetWithVisibilityResults") result = result.tweet
  if (!result?.legacy) return null

  const rt = result.legacy.retweeted_status_result?.result
  if (rt) {
    const inner = parseTweet(rt)
    if (inner) {
      return { ...inner, sortId: result.rest_id, retweetedFrom: parseUser(result).handle }
    }
  }

  const legacy = result.legacy
  // Long tweets carry full text and entities under note_tweet instead.
  const note = result.note_tweet?.note_tweet_results?.result
  let text: string = note?.text ?? legacy.full_text ?? ""
  for (
    const u of [...(legacy.entities?.urls ?? []), ...(note?.entity_set?.urls ?? [])]
  ) {
    text = text.replaceAll(u.url, u.expanded_url)
  }
  // Media and quote-tweet t.co links carry no information; drop them.
  for (const m of legacy.entities?.media ?? []) text = text.replaceAll(m.url, "")
  text = text.replace(/https:\/\/t\.co\/\w+$/, "").trim()
  text = text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")

  const quotedResult = result.quoted_status_result?.result
  return {
    id: result.rest_id,
    sortId: result.rest_id,
    ...parseUser(result),
    text,
    createdAt: new Date(legacy.created_at),
    likes: legacy.favorite_count ?? 0,
    retweets: legacy.retweet_count ?? 0,
    replies: legacy.reply_count ?? 0,
    media: (legacy.extended_entities?.media ?? []).map(
      // deno-lint-ignore no-explicit-any
      (m: any): Media =>
        m.type === "photo"
          ? {
            url: m.media_url_https,
            w: m.original_info?.width,
            h: m.original_info?.height,
          }
          : { url: m.expanded_url },
    ),
    quoted: quotedResult ? parseTweet(quotedResult) ?? undefined : undefined,
  }
}

// deno-lint-ignore no-explicit-any
export function parseTimeline(json: any): { tweets: Tweet[]; cursor?: string } {
  const instructions = json.data?.list?.tweets_timeline?.timeline?.instructions ?? []
  const tweets: Tweet[] = []
  let cursor: string | undefined
  for (const inst of instructions) {
    for (const entry of inst.entries ?? []) {
      if (entry.entryId?.startsWith("cursor-bottom")) {
        cursor = entry.content?.value ?? entry.content?.itemContent?.value
        continue
      }
      const isModule = Array.isArray(entry.content?.items)
      const items = entry.content?.items?.map(
        // deno-lint-ignore no-explicit-any
        (i: any) => i.item?.itemContent,
      ) ?? [entry.content?.itemContent]
      for (const item of items) {
        const result = item?.tweet_results?.result
        if (result) {
          const tweet = parseTweet(result)
          if (tweet) {
            if (isModule) tweet.threadId = entry.entryId
            tweets.push(tweet)
          }
        }
      }
    }
  }
  return { tweets, cursor }
}

// ---------- rendering ----------

function relTime(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000)
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

function tweetUrl(t: Tweet): string {
  return `https://x.com/${t.handle}/status/${t.id}`
}

function wrap(text: string, width: number, indent: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const words = line.split(" ")
      const lines: string[] = []
      let cur = ""
      for (const word of words) {
        if (cur && cur.length + word.length + 1 > width) {
          lines.push(cur)
          cur = word
        } else {
          cur = cur ? `${cur} ${word}` : word
        }
      }
      lines.push(cur)
      return lines
    })
    .join(`\n${indent}`)
}

function renderTerminal(tweets: Tweet[], lastRead: string | null) {
  let columns = 100
  try {
    columns = Deno.consoleSize().columns
  } catch {
    // not a tty
  }
  const width = Math.min(columns - 2, 100)
  let dividerShown = false
  for (const [i, t] of tweets.entries()) {
    if (!dividerShown && lastRead && BigInt(t.sortId) <= BigInt(lastRead)) {
      console.log(dim("─".repeat(width) + " read"))
      dividerShown = true
    }
    const rt = t.retweetedFrom ? green(` ⇄ RT by @${t.retweetedFrom}`) : ""
    console.log(
      `${bold(cyan("@" + t.handle))} ${dim(t.name)}${rt} ${dim("·")} ${
        yellow(relTime(t.createdAt))
      } ${dim(`· ♥ ${t.likes} ⇄ ${t.retweets}`)}`,
    )
    console.log(`  ${wrap(t.text, width - 2, "  ")}`)
    if (t.quoted) {
      console.log(dim(`  ┌ quoting @${t.quoted.handle}:`))
      console.log(dim(`  │ ${wrap(t.quoted.text, width - 4, "  │ ")}`))
    }
    for (const m of t.media) console.log(dim(`  🖼 ${m.url}`))
    console.log(dim(`  ${tweetUrl(t)}`))
    const next = tweets[i + 1]
    if (t.threadId !== undefined && t.threadId === next?.threadId) {
      console.log(dim("│"))
    } else {
      console.log()
    }
  }
  if (lastRead && !dividerShown && tweets.length > 0) {
    console.log(dim("(all new since last check)"))
  }
}

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

function linkify(text: string): string {
  return escapeHtml(text)
    .replace(/https?:\/\/[^\s<]+/g, (u) => {
      const display = u.replace(/^https?:\/\/(www\.)?/, "")
      return `<a href="${u}">${
        display.length > 40 ? display.slice(0, 40) + "…" : display
      }</a>`
    })
    .replace(
      /(^|\s)@(\w{1,15})/g,
      (_, pre, h) => `${pre}<a href="https://x.com/${h}">@${h}</a>`,
    )
}

function mediaHtml(media: Media[]): string {
  if (media.length === 0) return ""
  const photos = media.filter((m) => m.url.startsWith("https://pbs.twimg.com"))
  const other = media.filter((m) => !m.url.startsWith("https://pbs.twimg.com"))
  // The wrapper carries the image's aspect ratio inline so its final size is
  // known before the image loads — otherwise lazy images occupy zero height
  // and the page reflows under the reader (breaking the unread jump).
  const single = photos.length === 1
  const imgs = photos
    .map((m) => {
      const style = single && m.w && m.h
        ? ` style="aspect-ratio:${m.w}/${m.h};max-width:min(100%,${
          Math.round((320 * m.w) / m.h)
        }px)"`
        : ""
      return `<a class="ph" href="${m.url}" target="_blank"${style}><img src="${m.url}" loading="lazy"></a>`
    })
    .join("")
  const chips = other
    .map((m) => `<a class="chip" href="${m.url}">▶ video on x.com</a>`)
    .join("")
  const cls = photos.length > 1 ? "media grid" : "media"
  return (photos.length ? `<div class="${cls}">${imgs}</div>` : "") + chips
}

/** Blank lines in tweet text become paragraph breaks with a tight margin
 * rather than full-height <br><br> gaps. Input is already-linkified HTML. */
function paras(html: string): string {
  return html
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replaceAll("\n", "<br>")}</p>`)
    .join("")
}

/** Position of a tweet within a rendered conversation thread. */
type ThreadPos = { up: boolean; down: boolean }

function renderTweetHtml(t: Tweet, lastRead: string | null, pos: ThreadPos): string {
  const isNew = !lastRead || BigInt(t.sortId) > BigInt(lastRead)
  const rt = t.retweetedFrom
    ? `<span class="rt">⇄ @${escapeHtml(t.retweetedFrom)} reposted</span>`
    : ""
  const quoted = t.quoted
    ? `<blockquote>
        <header><span class="name b">${escapeHtml(t.quoted.name)}</span>
        <span class="name">@${escapeHtml(t.quoted.handle)}</span></header>
        ${paras(linkify(t.quoted.text))}
        ${mediaHtml(t.quoted.media)}
      </blockquote>`
    : ""
  const avatar = t.avatar
    ? `<img class="avatar" src="${t.avatar.replace("_normal", "_bigger")}" loading="lazy">`
    : `<div class="avatar"></div>`
  const classes = [
    isNew ? "new" : "read",
    pos.up ? "t-up" : "",
    pos.down ? "t-down" : "",
  ].filter(Boolean).join(" ")
  return `<article class="${classes}">
    <div class="gutter"><a href="https://x.com/${t.handle}">${avatar}</a></div>
    <div class="body">
      <header>
        <a class="who" href="https://x.com/${t.handle}"><b>${escapeHtml(t.name)}</b>
          <span class="name">@${escapeHtml(t.handle)}</span></a> ${rt}
        <a class="time" href="${tweetUrl(t)}">♥ ${t.likes} ⇄ ${t.retweets} · ${
    relTime(t.createdAt)
  }</a>
      </header>
      ${paras(linkify(t.text))}
      ${mediaHtml(t.media)}${quoted}
    </div>
  </article>`
}

export function renderHtml(
  tweets: Tweet[],
  listName: string,
  lastRead: string | null,
): string {
  const firstRead = tweets.findIndex((t) =>
    lastRead && BigInt(t.sortId) <= BigInt(lastRead)
  )
  const inThread = (a?: Tweet, b?: Tweet) =>
    a?.threadId !== undefined && a.threadId === b?.threadId
  const body = tweets
    .map((t, i) =>
      (i === firstRead ? `<div class="divider" id="read-marker">read below</div>` : "") +
      renderTweetHtml(t, lastRead, {
        up: inThread(t, tweets[i - 1]) && i !== firstRead,
        down: inThread(t, tweets[i + 1]) && i + 1 !== firstRead,
      })
    )
    .join("\n")
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>list: ${escapeHtml(listName)}</title>
<style>
  html { scroll-behavior: smooth; }
  :root {
    color-scheme: light dark;
    --muted: color-mix(in srgb, currentColor 52%, transparent);
    --line: color-mix(in srgb, currentColor 16%, transparent);
    --link: light-dark(#1a6fc4, #56a5e8);
    --green: light-dark(#1e8a3c, #4fae62);
  }
  body {
    font: 15px/1.5 system-ui;
    max-width: 620px;
    margin: 1.5rem auto 4rem;
    padding: 0 1rem;
  }
  h1 { font-size: 1.2rem; margin: 0 0 0.5rem 4px; }
  article {
    position: relative;
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 12px;
    padding: 12px 4px;
    border-bottom: 1px solid var(--line);
  }
  article.t-down { border-bottom: none; padding-bottom: 6px; }
  article.t-up { padding-top: 6px; }
  /* thread connector through the avatar column */
  article.t-down::after, article.t-up::before {
    content: "";
    position: absolute;
    left: 25px;
    width: 2px;
    background: var(--line);
  }
  article.t-down::after { top: 60px; bottom: 0; }
  article.t-up::before { top: 0; height: 6px; }
  article.t-up.t-down::after { top: 54px; }
  .avatar {
    width: 44px; height: 44px; border-radius: 50%;
    background: var(--line); display: block;
  }
  article.t-up .avatar { margin-top: 6px; }
  .body { min-width: 0; }
  header { display: flex; gap: 0.5em; align-items: baseline; }
  .who { text-decoration: none; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .name { color: var(--muted); font-weight: 400; font-size: 0.92em; }
  .b { font-weight: 700; color: inherit; }
  .rt { color: var(--green); font-size: 0.85em; white-space: nowrap; }
  .time {
    margin-left: auto; text-decoration: none; color: var(--muted);
    font-size: 0.85em; white-space: nowrap;
  }
  p { margin: 0.3rem 0 0; overflow-wrap: anywhere; }
  p + p { margin-top: 0.5em; }
  p a, blockquote a { color: var(--link); text-decoration: none; }
  p a:hover, blockquote a:hover { text-decoration: underline; }
  blockquote {
    border: 1px solid var(--line); border-radius: 12px;
    margin: 0.6rem 0 0; padding: 0.6rem 0.8rem; font-size: 0.95em;
  }
  blockquote p { margin-top: 0.15rem; }
  .media { margin-top: 0.6rem; }
  .ph { display: block; }
  .ph img {
    display: block; width: 100%; height: 100%; object-fit: cover;
    border-radius: 12px; border: 1px solid var(--line);
    cursor: zoom-in;
  }
  .media.grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
  }
  .media.grid .ph { aspect-ratio: 16 / 10; }
  .chip {
    display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.7rem;
    border: 1px solid var(--line); border-radius: 999px;
    color: var(--muted); font-size: 0.85em; text-decoration: none;
  }
  .chip:hover { color: inherit; }
  .divider {
    display: flex; align-items: center; gap: 0.8em;
    color: var(--muted); font-size: 0.8em;
    text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0.9rem 0;
  }
  .divider::before, .divider::after {
    content: ""; flex: 1; border-top: 1px dashed var(--muted);
  }
  /* land with the oldest unread tweets still visible above the marker */
  .divider { scroll-margin-top: 55vh; }
  .jump {
    position: fixed; top: 12px; right: 12px; z-index: 1;
    padding: 0.3rem 0.8rem; border: 1px solid var(--line); border-radius: 999px;
    background: light-dark(#fffc, #111c); backdrop-filter: blur(6px);
    color: var(--muted); font-size: 0.85em; text-decoration: none;
  }
  .jump:hover { color: inherit; }
  a { color: inherit; }
</style>
<h1>${escapeHtml(listName)}</h1>
${firstRead > 0 ? `<a class="jump" href="#read-marker">⇣ oldest unread</a>` : ""}
${body}`
}

// ---------- main ----------

const command = new Command()
  .name("x-list")
  .description("View a Twitter/X list timeline without opening twitter")
  .arguments("[list:string]")
  .option("-n, --count <n:number>", "Number of tweets to fetch", { default: 50 })
  .option("--html", "Render to HTML and open in browser")
  .option("--peek", "Don't advance the last-read marker")
  .option("--fresh", "Fetch even if the cached tweets are recent")
  .option("--refresh-features", "Reset cached feature flags to the built-in defaults")
  .action(async ({ count, html, peek, fresh, refreshFeatures }, listArg) => {
    const config = await readJson<Config>(configPath)
    if (!config?.auth_token || !config?.ct0 || !config?.lists) {
      console.error(
        `missing or incomplete ${configPath} — see the comment at the top of this script`,
      )
      Deno.exit(1)
    }
    const listName = listArg ?? Object.keys(config.lists)[0]
    const listId = config.lists[listName]
    if (!listId) {
      console.error(
        `unknown list "${listName}" (have: ${Object.keys(config.lists).join(", ")})`,
      )
      Deno.exit(1)
    }

    const features = (!refreshFeatures &&
      (await readJson<Record<string, boolean>>(cachePath))) ||
      { ...DEFAULT_FEATURES }

    const state = (await readJson<Record<string, string>>(statePath)) ?? {}
    let lastRead: string | null = state[listName] ?? null

    const tweetCachePath = `${home}/.cache/x-list/${listName}.tweets.json`
    const cached = fresh ? null : await readJson<TweetCache>(tweetCachePath)
    const cacheAgeMs = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity

    let tweets: Tweet[]
    let reachedLastRead: boolean
    if (cached && cacheAgeMs < CACHE_TTL_MS) {
      // Render from cache, including the last-read marker as of that fetch,
      // so a repeat run within the TTL shows the same view.
      tweets = cached.tweets.map(reviveTweet)
      lastRead = cached.lastRead
      reachedLastRead = cached.reachedLastRead
      console.error(
        dim(`(cached ${Math.round(cacheAgeMs / 60_000)}m ago; --fresh to refetch)`),
      )
    } else {
      // Paginate until the last-read marker is reached, so a burst of more
      // than `count` unread tweets doesn't silently drop the oldest ones.
      const marker = lastRead
      tweets = []
      const seen = new Set<string>()
      reachedLastRead = lastRead === null
      let cursor: string | undefined
      let firstPage
      const cap = Math.max(count, 300)
      for (let page = 0; page < 10; page++) {
        // Jittered delay between pages so paginating doesn't look like scraping.
        if (page > 0) {
          await new Promise((r) => setTimeout(r, 800 + Math.random() * 1700))
        }
        const timeline = await fetchTimeline(config, features, listId, count, cursor)
        firstPage ??= timeline
        const parsed = parseTimeline(timeline)
        const unseen = parsed.tweets.filter((t) => !seen.has(t.sortId))
        for (const t of unseen) seen.add(t.sortId)
        tweets.push(...unseen)
        if (marker && parsed.tweets.some((t) => BigInt(t.sortId) <= BigInt(marker))) {
          reachedLastRead = true
        }
        cursor = parsed.cursor
        if (reachedLastRead || !cursor || unseen.length === 0 || tweets.length >= cap) break
      }
      await writeJson(cachePath, features)

      if (tweets.length === 0) {
        console.error("no tweets parsed — raw response starts:")
        console.error(JSON.stringify(firstPage).slice(0, 500))
        Deno.exit(1)
      }
      await writeJson(
        tweetCachePath,
        {
          fetchedAt: new Date().toISOString(),
          lastRead,
          reachedLastRead,
          tweets,
        } satisfies TweetCache,
      )
    }
    if (!reachedLastRead) {
      console.error(
        `warning: stopped after ${tweets.length} tweets without reaching the last-read marker — older unread tweets exist`,
      )
    }

    if (html) {
      const path = `${home}/.cache/x-list/${listName}.html`
      await Deno.writeTextFile(path, renderHtml(tweets, listName, lastRead))
      new Deno.Command("open", { args: [path] }).spawn()
      console.log(path)
    } else {
      renderTerminal(tweets, lastRead)
    }

    if (!peek) {
      const newest = tweets.reduce((a, b) => (BigInt(a.sortId) > BigInt(b.sortId) ? a : b))
      state[listName] = newest.sortId
      await writeJson(statePath, state)
    }
  })

if (import.meta.main) await command.parse()
