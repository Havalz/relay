/**
 * RelayLanguage — the six languages Relay reads in, and how a card picks its text.
 *
 * OWNS:      the language table, the two-letter codes on the chip, script direction,
 *            and the lookup that turns (item, language) into the line on the card.
 * EXPECTS:   nothing (plain TypeScript module).
 * MUST NOT:  call Gemini, touch the scene, or know how translations were produced.
 *
 * Language is a per-CLIENT choice over SHARED data. Two people read the same queue in
 * the same order with the same ownership; only the glyphs differ. Nothing about the
 * queue's identity, sorting or state lives here.
 */

export interface RelayLanguage {
  /** Key inside the translations jsonb. "en" is the original and is never stored. */
  code: string
  /** What the peripheral chip shows. Two letters, nothing else. */
  chip: string
  /** Display name, shown only in the expanded list. Usually the endonym. */
  label: string
  /** Full name handed to Gemini, so the prompt cannot be ambiguous. */
  geminiName: string
  /** Right-to-left scripts get right-aligned text; the font does the shaping. */
  rtl: boolean
}

/**
 * Order is deliberate: English first because it is the source, then the two scripts
 * this project exists to serve, then the three that are cheap for the model.
 */
export const RELAY_LANGUAGES: RelayLanguage[] = [
  {code: "en", chip: "EN", label: "English", geminiName: "English", rtl: false},
  {code: "ar", chip: "AR", label: "العربية", geminiName: "Arabic", rtl: true},
  // Display label only: "Kurdish" is what readers here expect to see. The code, the
  // Gemini name and the Latin script (ş û ê î) are deliberately unchanged.
  {code: "ku", chip: "KU", label: "Kurdish", geminiName: "Northern Kurdish (Kurmanji, Latin script)", rtl: false},
  {code: "es", chip: "ES", label: "Español", geminiName: "Spanish", rtl: false},
  {code: "fr", chip: "FR", label: "Français", geminiName: "French", rtl: false},
  {code: "pl", chip: "PL", label: "Polski", geminiName: "Polish", rtl: false}
]

export const RELAY_DEFAULT_LANGUAGE = "en"

export function languageByCode(code: string): RelayLanguage {
  for (let i = 0; i < RELAY_LANGUAGES.length; i++) {
    if (RELAY_LANGUAGES[i].code === code) return RELAY_LANGUAGES[i]
  }
  return RELAY_LANGUAGES[0]
}

/** English is the source text, so it is never a translation and never needs fetching. */
export function isSourceLanguage(code: string): boolean {
  return code === RELAY_DEFAULT_LANGUAGE
}

/**
 * The translated line for this item, or null if we do not have one.
 *
 * Defensive on purpose: `translations` arrives over the wire and out of Postgres, so it
 * may be null, may not be an object, and may hold non-strings.
 */
export function translationFor(
  translations: Record<string, unknown> | null,
  code: string
): string | null {
  if (isSourceLanguage(code)) return null
  if (!translations || typeof translations !== "object") return null
  const v = (translations as Record<string, unknown>)[code]
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  return trimmed === "" ? null : trimmed
}
