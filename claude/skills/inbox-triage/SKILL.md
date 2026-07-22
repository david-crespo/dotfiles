---
name: inbox-triage
description: Triage Gmail inbox noise (mostly GitHub notifications) — classify threads as keep vs archive, optionally unsubscribe from dead threads. Dry-run by default.
---

# Inbox triage

Classify inbox threads as KEEP or ARCHIVE using the criteria below, then act
according to the mode. The goal is to clear GitHub notification noise while
never touching mail the user is personally involved in.

## Modes

- **Dry run (default).** Produce the report only. Do not modify any thread and
  do not hit any unsubscribe URL. Stay in this mode unless the user explicitly
  says to apply changes ("live", "actually do it", "apply").
- **Live.** For ARCHIVE threads: mark read and archive (remove `UNREAD` and
  `INBOX` labels via the Gmail thread label tools). For threads marked
  unsubscribe: also POST the unsubscribe URL (see below). Always end with the
  same report, listing what was done.

The dry-run default is deliberate while the criteria are being tuned. False
positives get fixed by editing the criteria lists in this file, not by
special-casing in conversation.

## Gathering

Search `in:inbox` and paginate through everything (also `in:inbox is:unread`
if the user asked specifically about unreads). Classify per thread, using the
most recent messages to judge current state (a thread that ended in
"Merged"/"Closed" is terminal regardless of how interesting it was).

## Classification

Apply in order; first match wins.

1. **Not GitHub → KEEP.** Human mail, calendar, newsletters, anything not from
   `notifications@github.com` is out of scope. Never archive or unsubscribe.
2. **Personal involvement → KEEP.** Any message in the thread cc's
   `david.crespo@oxidecomputer.com` directly, or carries a directed reason cc:
   `review_requested@`, `mention@`, `assign@`, `author@`, `comment@`, or
   `approval_requested@noreply.github.com`. These represent review requests,
   mentions, threads the user commented on, and deploy approvals — always keep,
   even if the thread is now closed (flag terminal ones as mark-read
   candidates in the report instead).
3. **Relevant subject matter → KEEP.** Subscribed-only threads whose topic is
   in the user's territory:
   - External API: endpoints, views, request/response schemas, API versioning,
     pagination, error semantics, dropshot
   - Web console bumps and console-facing changes
   - IP pools, subnet pools, external IPs/subnets
   - Auth/authz: IAM policy, tokens, sessions, audit log
   - VPC and firewall rules
   - Networking changes **only when they change the external API** (e.g. a new
     router-config or BGP endpoint). Networking internals (BFD, RSS handoff,
     switch plumbing, OPTE) without an API surface do not qualify.
   - Repos the user watches without necessarily weighing in: `docs`,
     `careers`, `design-system`, `rfd-site` — human-authored work stays;
     bot/dependency churn there still archives under rule 4.
4. **Everything else → ARCHIVE.** Typical noise, from observation:
   - Terminal notifications: merged / closed, on threads the user isn't
     personally involved in — even in relevant areas, the thread is over
   - Push-only commit emails and vercel/renovate/github-actions bot chatter
   - Hardware/update/telemetry internals: sp-sim, wicketd, MGS, update-engine,
     installinator, TUF/releng internals, oximeter, ereports/FM subsystem,
     sled-agent, storage allocation, sagas/datastore internals, CRDB tuning
   - Repos the user doesn't work in or watch, absent involvement

**When unsure, KEEP.** A false archive costs more than a false keep. Anything
that required judgment (either direction) gets a ⚠ flag in the report so the
user can correct the criteria.

## Unsubscribing from threads

For ARCHIVE threads that are subscribed-only AND either terminal
(merged/closed) or clearly never-relevant (rule 4 internals), also unsubscribe
so follow-up notifications stop. Do not unsubscribe from threads in relevant
areas that merely reached a terminal state — future activity there may matter.

Mechanics: fetch the thread's most recent message with the Gmail get-message
tool; the `htmlBody` footer contains a link of the form
`https://github.com/notifications/unsubscribe-auth/<token>`. GitHub supports
RFC 8058 one-click unsubscribe, so:

```
curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --request POST --data 'List-Unsubscribe=One-Click' '<url>'
```

A 2xx means unsubscribed (thread muted on GitHub). Report the status per
thread; on non-2xx, report and move on — never retry into a loop. Tokens are
per-message, so always extract from the message being acted on.

## Report

One table (or three short lists) grouped by verdict, most recent first:

- **KEEP** — subject, one-line reason (involvement type or matched territory)
- **ARCHIVE** — subject, one-line reason
- **ARCHIVE + UNSUBSCRIBE** — subject, reason, and (live mode) unsub HTTP status

Flag every judgment call with ⚠ and end with a one-line tally. In dry-run
mode, title the report "DRY RUN — no changes made".
