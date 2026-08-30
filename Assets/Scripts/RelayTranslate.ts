/**
 * RelayTranslate — the second, and only other, code path that reaches an AI service.
 *
 * OWNS:      the translation prompt, the strict-JSON contract, the 20 s ceiling, and
 *            decoding one language's worth of lines.
 * EXPECTS:   a host BaseScriptComponent (used purely to create the timeout event).
 * MUST NOT:  be constructible by a guest, write to Supabase, or touch the scene.
 *
 * HOST AUTHORITY
 * Identical mechanism to RelayHostNetwork and RelayTriage: private constructor, and the
 * only way to an instance is handing `grantIfAuthoritative()` the live SyncEntity, which
 * calls `doIOwnStore()` itself. A guest choosing Arabic does not call Gemini; it asks the
 * host to fill the language and waits for the broadcast.
 *
 * LAZY, BATCHED, THEN PERMANENT
 * Nothing is translated on load — that would multiply Gemini calls by six and stall the
 * first paint for text most people will never read. A language is filled the first time
 * somebody actually picks it, in ONE call for the whole visible queue, and written back
 * to the translations column so it is never paid for twice.
 *
 * The batching is not only about latency. A queue translated item-by-item drifts in
 * register — one line formal, the next clipped — because each call is blind to the
 * others. One call sees the whole set and keeps a single voice across it.
 */

import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"

import {
  RELAY_GEMINI_MODEL,
  RELAY_GEMINI_TIMEOUT_MS,
  RELAY_SUMMARY_MAX_WORDS
} from "./RelayConfig"
import {RelayLanguage} from "./RelayLanguage"

/** One line of Gemini's answer. */
export interface TranslationResult {
  id: string
  text: string
}

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: {type: "STRING"},
      text: {type: "STRING"}
    },
    required: ["id", "text"]
  }
}

export class RelayTranslate {
  private constructor(private readonly host: BaseScriptComponent) {}

  public static grantIfAuthoritative(
    syncEntity: SyncEntity | null,
    host: BaseScriptComponent
  ): RelayTranslate | null {
    if (syncEntity === null || syncEntity === undefined) return null
    if (syncEntity.doIOwnStore() !== true) return null
    return new RelayTranslate(host)
  }

  /**
   * Translate every supplied line into one language, in a single call. Rejects on
   * timeout, transport failure, or an unusable body; the caller keeps English.
   */
  public async translate(
    lines: TranslationResult[],
    language: RelayLanguage
  ): Promise<TranslationResult[]> {
    if (lines.length === 0) return []
    return await this.withTimeout(
      this.performTranslate(lines, language),
      RELAY_GEMINI_TIMEOUT_MS,
      lines.length + " lines -> " + language.code
    )
  }

  private buildPrompt(language: RelayLanguage): string {
    return (
      "You are translating the headlines of a shared work queue into " +
      language.geminiName +
      ".\n" +
      "You receive every headline at once. Keep one consistent register across the whole\n" +
      "set — they sit side by side on screen and must read as one voice.\n" +
      "\n" +
      "Rules:\n" +
      "- Translate the MEANING, not the words. These are short work items; a fluent, natural\n" +
      "  phrase in " + language.geminiName + " beats a literal rendering.\n" +
      "- At most " + RELAY_SUMMARY_MAX_WORDS + " words. They are drawn on a narrow card and\n" +
      "  longer lines are cut off.\n" +
      "- Write in the native script of " + language.geminiName + ". Do NOT transliterate into\n" +
      "  Latin letters, and do not leave the English in place.\n" +
      "- Keep product nouns, invoice numbers and proper names as they are.\n" +
      "- No trailing period. No quotes around the result.\n" +
      "\n" +
      "Return one object per input item, echoing its id exactly."
    )
  }

  private async performTranslate(
    lines: TranslationResult[],
    language: RelayLanguage
  ): Promise<TranslationResult[]> {
    const response = await Gemini.models({
      model: RELAY_GEMINI_MODEL,
      type: "generateContent",
      body: {
        systemInstruction: {parts: [{text: this.buildPrompt(language)}]},
        contents: [{role: "user", parts: [{text: JSON.stringify(lines)}]}],
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
    const out = this.parseResults(decoded)
    if (out.length === 0) throw new Error("Gemini returned zero usable translations")
    return out
  }

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

  /** Discard malformed rows rather than throwing — a partial answer still helps. */
  private parseResults(decoded: unknown): TranslationResult[] {
    if (!Array.isArray(decoded)) return []
    const out: TranslationResult[] = []
    for (let i = 0; i < decoded.length; i++) {
      const row = decoded[i] as Record<string, unknown>
      if (!row || typeof row !== "object") continue
      const id = typeof row.id === "string" ? row.id : ""
      if (id === "") continue
      const t = typeof row.text === "string" ? row.text : ""
      if (t.trim() === "") continue
      out.push({id: id, text: this.trimToWordLimit(t)})
    }
    return out
  }

  /**
   * The word cap is enforced here, not merely requested. Arabic and Kurmancî in
   * particular come back longer than the English they came from, and the card is
   * 7.8 cm wide and not allowed to grow.
   */
  private trimToWordLimit(text: string): string {
    const cleaned = text.trim().replace(/[.،؛\s]+$/, "")
    const words = cleaned.split(/\s+/)
    if (words.length <= RELAY_SUMMARY_MAX_WORDS) return cleaned
    return words.slice(0, RELAY_SUMMARY_MAX_WORDS).join(" ")
  }

  private withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    const timeout = new Promise<T>((_resolve, reject) => {
      const delayed = this.host.createEvent("DelayedCallbackEvent")
      delayed.bind(() => {
        reject(new Error("Gemini translate timed out after " + timeoutMs + " ms: " + label))
      })
      delayed.reset(timeoutMs / 1000)
    })
    return Promise.race([work, timeout])
  }
}
