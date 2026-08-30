/**
 * RelayTriage — the ONLY code path in Relay that reaches an AI service.
 *
 * OWNS:      the Gemini prompt, the strict-JSON contract, the 20 s ceiling, and the
 *            decoding of triage output into priority + summary.
 * EXPECTS:   a host BaseScriptComponent (used purely to create the timeout event).
 * MUST NOT:  be constructible by a guest, write to Supabase, or touch the scene.
 *
 * HOST AUTHORITY
 * Same mechanism as RelayHostNetwork: the constructor is private and the only way to
 * obtain an instance is to hand `grantIfAuthoritative()` the live SyncEntity, which
 * calls `doIOwnStore()` itself. The ownership test cannot be separated from the grant,
 * so a guest holds no reference through which Gemini could be called. Two clients
 * triaging the same queue would produce divergent priorities and divergent layouts.
 *
 * WHY ONE BATCHED CALL, NOT ONE PER ITEM
 * Priority is a RELATIVE judgement. Asked about a single ticket in isolation, a model
 * has no scale to place it on and reliably answers "3" — which is precisely the flat
 * queue this module exists to prevent. Sending the whole untriaged set in one request
 * gives the model the comparison set it needs to spread across 1-5, and costs one
 * round trip instead of N.
 */

import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"

import {
  RELAY_GEMINI_MODEL,
  RELAY_GEMINI_TIMEOUT_MS,
  RELAY_SUMMARY_MAX_WORDS
} from "./RelayConfig"
import {WorkItem} from "./RelayWorkItem"

/** One row of Gemini's answer. */
export interface TriageVerdict {
  id: string
  priority: number
  summary: string
}

const SYSTEM_PROMPT =
  "You are triaging a shared work queue for two people who can see the whole queue at once.\n" +
  "You receive EVERY untriaged item in one request. Rank them RELATIVE TO EACH OTHER.\n" +
  "\n" +
  "For each item return:\n" +
  "- priority: an integer 1-5. 5 = act now, 1 = whenever there is time.\n" +
  "  Judge urgency ONLY from what the title and body actually say. Money already lost,\n" +
  "  customers already blocked, and things already broken outrank requests, ideas and\n" +
  "  nice-to-haves. Do NOT infer urgency from the source label — a 'bug' is not\n" +
  "  automatically urgent and a 'feature' is not automatically trivial.\n" +
  "- summary: at most " + RELAY_SUMMARY_MAX_WORDS + " words. No trailing period.\n" +
  "  It REPLACES the title on a narrow card, so make it concrete and scannable.\n" +
  "  Say what is wrong and for whom. Do not restate the category.\n" +
  "\n" +
  "You MUST spread priorities across the 1-5 range. Returning the same number for every\n" +
  "item is a failure. If the set genuinely clusters, still separate them by relative\n" +
  "urgency so the most pressing item is clearly above the least.\n" +
  "\n" +
  "Return one object per input item, echoing its id exactly."

/** Strict-JSON contract. Gemini is constrained to this shape, not merely asked for it. */
const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: {type: "STRING"},
      priority: {type: "INTEGER"},
      summary: {type: "STRING"}
    },
    required: ["id", "priority", "summary"]
  }
}

export class RelayTriage {
  private constructor(private readonly host: BaseScriptComponent) {}

  /**
   * Returns a triage handle ONLY to the client that owns the queue's store.
   * Ownership is tested here against the live SyncEntity, never trusted from a caller.
   */
  public static grantIfAuthoritative(
    syncEntity: SyncEntity | null,
    host: BaseScriptComponent
  ): RelayTriage | null {
    if (syncEntity === null || syncEntity === undefined) return null
    if (syncEntity.doIOwnStore() !== true) return null
    return new RelayTriage(host)
  }

  /**
   * Triage every supplied item in one call. Rejects on timeout, transport failure, or
   * an unusable body. The caller is expected to keep existing values on failure rather
   * than surface an error — an untriaged queue still renders.
   */
  public async triage(items: WorkItem[]): Promise<TriageVerdict[]> {
    if (items.length === 0) return []
    return await this.withTimeout(
      this.performTriage(items),
      RELAY_GEMINI_TIMEOUT_MS,
      items.length + " items"
    )
  }

  private async performTriage(items: WorkItem[]): Promise<TriageVerdict[]> {
    const payload = items.map((it) => ({id: it.id, title: it.title, body: it.body}))

    const response = await Gemini.models({
      model: RELAY_GEMINI_MODEL,
      type: "generateContent",
      body: {
        systemInstruction: {parts: [{text: SYSTEM_PROMPT}]},
        contents: [{role: "user", parts: [{text: JSON.stringify(payload)}]}],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA
        }
      }
    })

    const text = this.firstText(response)
    if (text === null) throw new Error("Gemini returned no text part")

    let decoded: unknown
    try {
      decoded = JSON.parse(text)
    } catch (e) {
      throw new Error("Gemini returned a body that is not JSON")
    }
    const verdicts = this.parseVerdicts(decoded)
    if (verdicts.length === 0) throw new Error("Gemini returned zero usable verdicts")
    return verdicts
  }

  /** Pull the first text part out of the first candidate, defensively. */
  private firstText(response: unknown): string | null {
    const r = response as {candidates?: {content?: {parts?: {text?: string}[]}}[]}
    if (!r || !Array.isArray(r.candidates) || r.candidates.length === 0) return null
    const parts = r.candidates[0]?.content?.parts
    if (!Array.isArray(parts)) return null
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i]?.text
      if (typeof t === "string" && t.trim() !== "") return t
    }
    return null
  }

  /** Discard malformed rows rather than throwing — a partial answer is still useful. */
  private parseVerdicts(decoded: unknown): TriageVerdict[] {
    if (!Array.isArray(decoded)) return []
    const out: TriageVerdict[] = []
    for (let i = 0; i < decoded.length; i++) {
      const row = decoded[i] as Record<string, unknown>
      if (!row || typeof row !== "object") continue
      const id = typeof row.id === "string" ? row.id : ""
      if (id === "") continue
      const p = row.priority
      if (typeof p !== "number" || !isFinite(p)) continue
      const s = typeof row.summary === "string" ? row.summary : ""
      if (s.trim() === "") continue
      out.push({id: id, priority: p, summary: this.trimToWordLimit(s)})
    }
    return out
  }

  /**
   * The word cap is enforced here, not merely requested in the prompt. A model that
   * ignores the instruction must not be able to overflow a 7.8 cm card.
   */
  private trimToWordLimit(summary: string): string {
    const cleaned = summary.trim().replace(/[.\s]+$/, "")
    const words = cleaned.split(/\s+/)
    if (words.length <= RELAY_SUMMARY_MAX_WORDS) return cleaned
    return words.slice(0, RELAY_SUMMARY_MAX_WORDS).join(" ")
  }

  /**
   * Hard 20 s ceiling. RSG's Gemini.models() exposes no timeout option and the Lens API
   * has no requestTimeoutSeconds, so the ceiling is imposed by racing the request
   * against a DelayedCallbackEvent owned by the Lens lifecycle.
   */
  private withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    const timeout = new Promise<T>((_resolve, reject) => {
      const delayed = this.host.createEvent("DelayedCallbackEvent")
      delayed.bind(() => {
        reject(new Error("Gemini timed out after " + timeoutMs + " ms: " + label))
      })
      delayed.reset(timeoutMs / 1000)
    })
    return Promise.race([work, timeout])
  }
}
