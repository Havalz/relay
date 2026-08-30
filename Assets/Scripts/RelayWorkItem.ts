/**
 * RelayWorkItem — the shape of one row of `work_items`, plus parsing and derived values.
 *
 * OWNS:      the WorkItem contract (all 9 columns, exactly as Supabase returns them),
 *            defensive parsing of an untrusted JSON payload, and age/priority derivation.
 * EXPECTS:   nothing (plain TypeScript module).
 * MUST NOT:  know where the items came from. Supabase rows and the local fallback
 *            dataset are indistinguishable at this layer — that is the whole point.
 */

import {isSourceLanguage, translationFor} from "./RelayLanguage"

export type RelayStatus = "open" | "claimed" | "done"

/** One row of public.work_items. Field names match the column names verbatim. */
export interface WorkItem {
  id: string
  source: string
  title: string
  body: string
  status: RelayStatus
  claimed_by: string | null

  /**
   * Connection id of the claimer. TRANSIENT — it travels on the wire but is never
   * written to Supabase.
   *
   * `claimed_by` holds the Snapchat USER id, which is the right thing to persist but the
   * wrong thing to compare against locally: two Lens Studio preview panes are the same
   * signed-in account, so userId is identical on both and every client concludes it was
   * the claimer. Connection id is unique per client, so it is what decides "mine" vs
   * "theirs" — and therefore lane vs dissolve.
   */
  claimed_conn: string | null
  priority: number
  summary: string | null
  translations: Record<string, unknown> | null
  created_at: string // ISO 8601 timestamptz

  /**
   * Whether the row actually CARRIED a numeric priority, as opposed to being given
   * the neutral 3 by the parser. Derived, never a column.
   *
   * This distinction is what makes the triage cache honest: a freshly-inserted row has
   * priority NULL in Postgres, and collapsing that to 3 at parse time would make an
   * untriaged item indistinguishable from one Gemini deliberately rated 3.
   */
  hasPriority: boolean
}

/** Ownership as the renderer sees it. Derived, never stored on the row. */
export type Ownership = "unclaimed" | "yours" | "partners" | "done"

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback
}

function asStatus(v: unknown): RelayStatus {
  return v === "claimed" || v === "done" ? v : "open"
}

/**
 * Parse an arbitrary decoded JSON body into WorkItems, discarding malformed rows.
 * Never throws — a partially-bad payload degrades to the rows that did parse.
 */
export function parseWorkItems(payload: unknown): WorkItem[] {
  if (!Array.isArray(payload)) return []
  const out: WorkItem[] = []
  for (let i = 0; i < payload.length; i++) {
    const row = payload[i] as Record<string, unknown>
    if (!row || typeof row !== "object") continue
    const id = asString(row.id, "")
    if (id === "") continue
    const priorityRaw = row.priority
    out.push({
      id: id,
      source: asString(row.source, "unknown"),
      title: asString(row.title, "(untitled)"),
      body: asString(row.body, ""),
      status: asStatus(row.status),
      claimed_by: typeof row.claimed_by === "string" ? row.claimed_by : null,
      claimed_conn: typeof row.claimed_conn === "string" ? row.claimed_conn : null,
      priority: typeof priorityRaw === "number" && isFinite(priorityRaw) ? priorityRaw : 3,
      hasPriority: typeof priorityRaw === "number" && isFinite(priorityRaw),
      summary: typeof row.summary === "string" ? row.summary : null,
      translations:
        row.translations && typeof row.translations === "object"
          ? (row.translations as Record<string, unknown>)
          : null,
      created_at: asString(row.created_at, new Date().toISOString())
    })
  }
  return out
}

/**
 * An item needs triage only if it is missing a real priority OR a usable summary.
 * Anything that already has both is served from what Supabase returned and is never
 * sent to Gemini again — this is the whole cache.
 */
export function needsTriage(item: WorkItem): boolean {
  if (!item.hasPriority) return true
  const s = item.summary
  return s === null || s.trim() === ""
}

/** Returns a copy with triage applied. Priority is clamped into the legal range. */
export function withTriage(item: WorkItem, priority: number, summary: string): WorkItem {
  const p = Math.round(priority)
  const clamped = p < 1 ? 1 : p > 5 ? 5 : p
  const out: WorkItem = {
    id: item.id,
    source: item.source,
    title: item.title,
    body: item.body,
    status: item.status,
    claimed_by: item.claimed_by,
    claimed_conn: item.claimed_conn,
    priority: clamped,
    summary: summary,
    translations: item.translations,
    created_at: item.created_at,
    hasPriority: true
  }
  return out
}

/**
 * What the card shows as its headline. The summary is the point of triage; the raw
 * title is the fallback when Gemini never answered.
 */
export function headlineOf(item: WorkItem): string {
  const s = item.summary
  return s !== null && s.trim() !== "" ? s.trim() : item.title
}

/**
 * The headline in a chosen language: the stored translation if we have one, otherwise
 * the English original.
 *
 * The fallback is the whole error strategy for translation. A missing language, a failed
 * Gemini call, a timeout, a malformed jsonb — every one of them lands here and produces
 * readable English rather than a blank card.
 */
export function headlineIn(item: WorkItem, languageCode: string): string {
  const translated = translationFor(item.translations, languageCode)
  return translated !== null ? translated : headlineOf(item)
}

/** True when this item has no text yet for a language that is not the source. */
export function needsTranslation(item: WorkItem, languageCode: string): boolean {
  if (isSourceLanguage(languageCode)) return false
  return translationFor(item.translations, languageCode) === null
}

/** Returns a copy carrying one more language, leaving every other language intact. */
export function withTranslation(item: WorkItem, languageCode: string, text: string): WorkItem {
  const next: Record<string, unknown> = {}
  const existing = item.translations
  if (existing && typeof existing === "object") {
    const keys = Object.keys(existing)
    for (let i = 0; i < keys.length; i++) next[keys[i]] = existing[keys[i]]
  }
  next[languageCode] = text
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    body: item.body,
    status: item.status,
    claimed_by: item.claimed_by,
    claimed_conn: item.claimed_conn,
    priority: item.priority,
    summary: item.summary,
    translations: next,
    created_at: item.created_at,
    hasPriority: item.hasPriority
  }
}

/** Seconds this item has been waiting. Clamped at 0 for clock skew. */
export function ageSeconds(item: WorkItem, nowMs: number): number {
  const created = Date.parse(item.created_at)
  if (isNaN(created)) return 0
  const secs = (nowMs - created) / 1000
  return secs > 0 ? secs : 0
}

/** Compact human age for the card's metadata line: "4m", "3h", "2d". */
export function formatAge(seconds: number): string {
  if (seconds < 60) return Math.floor(seconds) + "s"
  if (seconds < 3600) return Math.floor(seconds / 60) + "m"
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h"
  return Math.floor(seconds / 86400) + "d"
}

/**
 * Ownership of an item relative to the local user. Colour is driven purely by this.
 * Day 1 renders everything unclaimed; the branches below are the seam that the
 * claim/transfer phase plugs into without touching the renderer.
 */
export function ownershipOf(item: WorkItem, localConnectionId: string | null): Ownership {
  if (item.status === "done") return "done"
  if (item.status !== "claimed") return "unclaimed"
  // Compare connection ids, not user ids — see WorkItem.claimed_conn.
  if (!item.claimed_conn) return "partners"
  return localConnectionId && item.claimed_conn === localConnectionId ? "yours" : "partners"
}

/** Highest priority first, then oldest first. Deterministic across both clients. */
export function sortForQueue(items: WorkItem[]): WorkItem[] {
  const copy = items.slice()
  copy.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const at = Date.parse(a.created_at)
    const bt = Date.parse(b.created_at)
    if (at !== bt) return at - bt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return copy
}
