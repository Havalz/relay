/**
 * RelayConfig — the ONE module that owns Relay's backend connection details and
 * visual identity constants.
 *
 * OWNS:      Supabase URL + publishable key + endpoint, the network timeout, the
 *            ownership colour spectrum, and the card/typography identity constants.
 * EXPECTS:   nothing (plain TypeScript module, no @input, no scene access).
 * MUST NOT:  perform network I/O, import a @component, or touch the scene graph.
 *
 * The publishable key below is a client-side anon key. It is *meant* to be public —
 * Supabase RLS policies and column-level grants are what actually restrict access.
 * It still lives here and only here: never inline it at a call site.
 */

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

export const RELAY_SUPABASE_URL = "https://wfxynchxvjtokenyxjue.supabase.co"

/** Publishable (anon) key. Public by design; restricted by RLS. */
export const RELAY_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9TqYP5nitqBF7oyzAjXL3Q_9JtMTVLs"

/** Open work items only — claimed/done rows are filtered server-side. */
export const RELAY_WORK_ITEMS_PATH = "/rest/v1/work_items?select=*&status=eq.open"

/** Hard timeout applied to EVERY network call. Non-negotiable. */
export const RELAY_REQUEST_TIMEOUT_MS = 20000

export function relayWorkItemsUrl(): string {
  return RELAY_SUPABASE_URL + RELAY_WORK_ITEMS_PATH
}

/** PATCH target for a single row — used to persist triage output. */
export function relayWorkItemUrl(id: string): string {
  return RELAY_SUPABASE_URL + "/rest/v1/work_items?id=eq." + encodeURIComponent(id)
}

/** apikey and Authorization carry the same publishable key, per the PostgREST contract. */
export function relayAuthHeaders(): Record<string, string> {
  return {
    apikey: RELAY_SUPABASE_PUBLISHABLE_KEY,
    Authorization: "Bearer " + RELAY_SUPABASE_PUBLISHABLE_KEY
  }
}

// ---------------------------------------------------------------------------
// Gemini triage
// ---------------------------------------------------------------------------

/** Known-good through the Remote Service Gateway. Do not swap for an -exp/-preview id. */
export const RELAY_GEMINI_MODEL = "gemini-2.5-flash"

/**
 * Hard ceiling on the triage call.
 *
 * NOTE: RSG's `Gemini.models()` exposes no timeout option, and `requestTimeoutSeconds`
 * does not exist anywhere in the Lens API — so this is enforced by racing the request
 * against a DelayedCallbackEvent, exactly as RelayHostNetwork does for Supabase.
 */
export const RELAY_GEMINI_TIMEOUT_MS = 20000

/** The card is 7.8 cm wide. A longer summary wraps and breaks the arc fit. */
export const RELAY_SUMMARY_MAX_WORDS = 8

export const RELAY_PRIORITY_MIN = 1
export const RELAY_PRIORITY_MAX = 5

// ---------------------------------------------------------------------------
// Ownership spectrum — colour encodes ownership and NOTHING else.
// Urgency is carried by height and brightness. Never introduce a status hue.
// ---------------------------------------------------------------------------

// Tuned as GLASS TINTS, not as fills. Each is desaturated from its signage-bright
// ancestor so a wall of them is restful, while the three stay unmistakably apart in hue:
// mineral sits at ~16% saturation (cool, almost neutral), jade at ~33% (clearly green),
// lilac at ~26% (clearly violet). Mineral is deliberately the quietest because it is what
// most cards are, most of the time.
export const RELAY_HEX_YOURS = "#7FBE9E" // jade — green, not neon
export const RELAY_HEX_UNCLAIMED = "#A8BEC8" // mineral — cool, desaturated, restful
export const RELAY_HEX_PARTNERS = "#B2A3DC" // lilac — violet, soft
export const RELAY_HEX_DONE = "#66757C" // graphite, always at low opacity

/** Parse "#RRGGBB" into a linear-ish vec4 with the supplied alpha. */
export function hexToVec4(hex: string, alpha: number): vec4 {
  const h = hex.charAt(0) === "#" ? hex.substring(1) : hex
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  return new vec4(r, g, b, alpha)
}

/**
 * Same hue, scaled brightness. Used to express urgency without touching hue.
 *
 * The scale is capped so the brightest channel lands exactly on 1.0 and never above it.
 * Without that cap, brightening lilac (b = 0.941) by the hover gain of 1.55 produces
 * b = 1.46, which the shader clamps to 1.0 while r and g keep climbing — so the colour
 * silently walks toward white and lilac stops looking like lilac at the exact moment a
 * hand reaches for it. Clipping is how a palette dies one channel at a time; hover has
 * alpha and border weight to express itself with instead.
 */
export function scaleRgb(color: vec4, factor: number): vec4 {
  const peak = Math.max(color.r, Math.max(color.g, color.b))
  const safe = peak > 0 ? Math.min(factor, 1 / peak) : factor
  return new vec4(color.r * safe, color.g * safe, color.b * safe, color.a)
}

// ---------------------------------------------------------------------------
// Card material identity — "a thin sheet of edge-lit glass".
// ---------------------------------------------------------------------------

/**
 * Fill opacity of the card body. The edge carries the form; the fill is nearly clear.
 *
 * This is the BASE, before the gradient's pool gain. See RELAY_CARD_MAX_BODY_ALPHA for
 * the ceiling that actually governs how solid a card can ever look.
 */
export const RELAY_CARD_FILL_OPACITY = 0.1

/**
 * Hard ceiling on the card body's opacity, anywhere on the sheet.
 *
 * THIS IS THE GUARD THAT KEEPS A CARD GLASS.
 *
 * The fill used to be computed as base x poolGain x ownedEmphasis with nothing bounding
 * the product: 0.15 x 2.2 x 2.4 = 0.79, so a claimed card was a 79%-opaque panel. That is
 * how the queue drifted into solid saturated green — not from the hue, which was correct
 * all along, but from stacking three independent multipliers on the alpha.
 *
 * Every path that writes body alpha now clamps to this, so no future gain can reintroduce
 * a solid card. The scene must remain visible through the sheet.
 */
export const RELAY_CARD_MAX_BODY_ALPHA = 0.18

/**
 * Border thickness in centimetres of local space (UIKit RoundedRectangle.borderSize).
 * Derived so the edge lands in the requested 1–1.4 px band across the queue's depth
 * range: at the far plane (145 cm) it renders ~1.0 px, at the near plane (105 cm)
 * ~1.4 px. Re-derive if RELAY_NEAR/FAR_DISTANCE_CM change materially.
 */
export const RELAY_CARD_EDGE_WIDTH_CM = 0.11

/** Inner-edge fade. Small — the edge should read as a crisp line, not a glow. */
export const RELAY_CARD_EDGE_SOFTNESS = 0.004

export const RELAY_CARD_CORNER_RADIUS_CM = 0.6

// ---------------------------------------------------------------------------
// Spatial encoding defaults — the queue is a coordinate space, not a list.
//   height   = urgency (urgent floats higher)
//   distance = age     (the longer it waits, the closer it comes)
//   colour   = ownership
// ---------------------------------------------------------------------------

/**
 * Total horizontal arc the queue may occupy, in degrees, INCLUDING the width of the
 * outermost cards. The entire queue must fit inside it: reading the whole queue at a
 * glance is the thesis of Relay, and a head-turn breaks it.
 *
 * MEASURED, NOT ASSUMED. The SPECS 27 preview camera reports fov = 0.6386 rad = 36.6 deg
 * VERTICAL; at the preview's 1392x2254 frame that is 23.1 deg HORIZONTAL. An earlier
 * 27 deg estimate (53 cm at 110 cm) overshoots it, and cards laid out to 27 deg are
 * visibly clipped at both edges. 22 deg leaves ~0.9 deg of margin against the measured
 * frame. Re-measure if the preview panel's aspect changes — horizontal FOV follows it.
 */
export const RELAY_ARC_SPAN_DEGREES = 19

/**
 * How many cards are placed in the arc. Items beyond this stay in the data model and on
 * the wire; they are simply not given a position.
 */
export const RELAY_MAX_VISIBLE_CARDS = 5
// Depth still means age, and still monotonically — but over 28 cm rather than 40.
//
// Even angular spacing was never the problem: the arc has always distributed centres
// evenly. What made it read as scattered is that height and depth vary INDEPENDENTLY, so
// a 40 cm depth swing threw cards to visibly different sizes in no order the eye could
// follow, drowning the urgency ladder underneath it. Tightening the depth keeps the age
// signal legible while letting height be the axis that organises the picture.
export const RELAY_NEAR_DISTANCE_CM = 136 // oldest item — closest to the user
export const RELAY_FAR_DISTANCE_CM = 164 // newest item — furthest away
// Widened from -12 to deepen the urgency axis. It stops here rather than going lower
// because the lane row sits at y -24: at arc depth, a card much below -18 starts landing
// on the lane cards in screen space, trading one legibility problem for another.
export const RELAY_MIN_HEIGHT_CM = -18 // lowest priority
export const RELAY_MAX_HEIGHT_CM = 16 // highest priority

/**
 * Card width in centimetres. Five of these plus gaps must fit inside
 * RELAY_ARC_SPAN_DEGREES: at the 125 cm queue radius, 7.8 cm subtends 3.57 deg, so five
 * cards occupy 17.9 deg of card and 3.4 deg of gap = 21.3 deg inside a 22 deg budget.
 * Widening this without widening the arc pushes the outermost cards off-screen.
 */
export const RELAY_CARD_WIDTH_CM = 7.8
/** Taller than wide: narrow cards wrap titles onto more lines. */
export const RELAY_CARD_HEIGHT_CM = 10.5

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

/** Networked event names. Every client may SEND these; only the host acts on a claim. */
export const RELAY_EVT_CLAIM_REQUEST = "relay:claim"
export const RELAY_EVT_CLAIM_DENIED = "relay:denied"
export const RELAY_EVT_HOVER = "relay:hover"
export const RELAY_EVT_PASS_REQUEST = "relay:pass"
export const RELAY_EVT_LANGUAGE = "relay:lang"
export const RELAY_EVT_TRANSLATE_REQUEST = "relay:translate"

/**
 * The claimer's lane: where a card you have taken comes to rest. Below the arc and
 * nearer than its far plane, so "mine" is spatially distinct from "the queue".
 * Lane cards are scaled down — they are a record, not a decision surface.
 *
 * SEPARATED FROM THE ARC BY CONSTRUCTION, NOT BY TUNING.
 *
 * At -24 / -140 the lane's top edge sat 2.7 deg ABOVE the arc's lowest reachable card
 * edge, so a low-priority card and a claimed card could occupy the same screen space and
 * tangle. Nudging it down would only have moved the collision to whichever arc state was
 * tried next, which is the same mistake the language chip made before it was given an
 * angular bound (see RELAY_LANG_CHIP_Y_CM).
 *
 * The arc has a hard FLOOR, exactly as it has a hard ceiling. The lowest a card can ever
 * be is RELAY_MIN_HEIGHT_CM (-18) minus half the urgency tie fan (2.5) minus half a slab
 * at minimum urgency scale (5.375) = -25.875 cm, and the nearest it can be is
 * RELAY_NEAR_DISTANCE_CM (136). So no arc card can ever fall below
 * atan(-25.875 / 136) = -10.77 deg.
 *
 * The lane's HIGHEST edge — the outermost of five slots, which is the furthest out and so
 * the shallowest angle — sits at atan(-30.74 / hypot(25.5, 132)) = -12.88 deg. That is
 * 2.11 deg (4.9 cm) below the arc's floor in every arc state and at every lane count from
 * one card to five, by construction rather than by tuning.
 *
 * Z moves from -140 to -132 so the lane is also nearer than the arc's near plane (136):
 * it is now a plane in FRONT of the queue, not a row buried inside its depth range.
 * The lane's lowest edge lands at -16.17 deg, inside the 18.29 deg half-FOV.
 */
export const RELAY_LANE_Y_CM = -34.5
export const RELAY_LANE_Z_CM = -132
export const RELAY_LANE_SPACING_CM = 8.5
export const RELAY_LANE_SCALE = 0.7

/** Lift-and-settle. Rise, brief hold, settle — an object with weight. */
export const RELAY_CLAIM_RISE_CM = 9
export const RELAY_CLAIM_RISE_MS = 300
export const RELAY_CLAIM_HOLD_MS = 90
export const RELAY_CLAIM_SETTLE_MS = 520

/** The partner's view of a claim: dissolve upward, tinted with the claimer's colour. */
export const RELAY_DISSOLVE_MS = 400
export const RELAY_DISSOLVE_RISE_CM = 14

/** How long the loser of a race sees "claimed by partner". */
export const RELAY_DENIED_FLASH_MS = 600

/**
 * Where the denied banner appears when the card it refers to is already gone and no
 * last-known position was recorded. Normally the banner is held at the card's final
 * position — the spot the hand was reaching for — so this is only a backstop.
 */
export const RELAY_DENIED_ANCHOR_X_CM = 0
export const RELAY_DENIED_ANCHOR_Y_CM = 2
export const RELAY_DENIED_ANCHOR_Z_CM = -125

/**
 * The banner's height in the arc, fixed.
 *
 * It used to sit at the denied card's own position, which put it straight on top of a
 * live card whenever the loser's copy had not finished dissolving yet — the message
 * covering the very headline it was talking about.
 *
 * Everything else on screen has a fixed vertical band, so the banner gets the one below
 * all of them:
 *   arc cards   y -12 .. 16, 10.5 tall  -> bottom edge -17.25
 *   lane cards  y -24, 10.5 tall at 0.7 -> bottom edge -27.68
 *   language chip at y -27
 * Clearing -27.68 by a comfortable margin puts the banner under the lot. The gap between
 * the arc and the lane is only ~3.1 cm, which a 3.4 cm banner does not fit inside — so
 * "just below the arc" would have traded one overlap for another.
 *
 * The banner still keeps the x/z of the slot the hand was reaching for, so it stays
 * pointed at the right place; only its height is pinned.
 */
export const RELAY_DENIED_DROP_Y_CM = -33

/** Reflow of the remaining arc after a gap opens. */
export const RELAY_REFLOW_MS = 420

// ---------------------------------------------------------------------------
// Direct pass — handing a card you hold to the other person
// ---------------------------------------------------------------------------

/**
 * Horizontal drag, in centimetres, that turns "I nudged my lane card" into "I passed
 * this". Below the threshold the card eases back into its slot, so a mis-grab costs
 * nothing.
 */
export const RELAY_PASS_THRESHOLD_CM = 6

/** How far the card flies on the SENDER's side before it leaves their view. */
export const RELAY_PASS_TRAVEL_CM = 34

/** Sender's throw and receiver's catch. Both inside the 300-600 ms motion budget. */
export const RELAY_PASS_MS = 520

// ---------------------------------------------------------------------------
// Arrival — a new row reaching the queue
// ---------------------------------------------------------------------------

/** A newly-seen card eases in from outside the arc instead of popping into place. */
export const RELAY_ARRIVE_MS = 520

/** Where it starts: this multiple of its final radius, i.e. just beyond the far plane. */
export const RELAY_ARRIVE_OUT_FACTOR = 1.3

/** Host-only Supabase poll. Plain REST on an interval — no realtime sockets. */
export const RELAY_POLL_MS = 3000

// ---------------------------------------------------------------------------
// Language chip — a setting, parked at the edge of your own lane
// ---------------------------------------------------------------------------

/**
 * The chip lives in the HEADER BAND, above the arc — not among the cards.
 *
 * It used to sit at the left end of the lane, inside the same volume the cards occupy.
 * That meant its clearance depended on how the arc happened to reflow: whenever the arc
 * extended left it collided with the leftmost card, and every fix was another guess at a
 * position the layout was free to invalidate on the next poll.
 *
 * Angular separation is what makes this safe, because the card volume has a hard ceiling:
 * the highest a card can ever be is RELAY_MAX_HEIGHT_CM (16) plus half a card at maximum
 * urgency scale (6.2) = 22.2 cm, and the nearest it can be is RELAY_NEAR_DISTANCE_CM
 * (130). So no card can ever exceed atan(22.2 / 130) = 9.7 deg above the eyeline.
 *
 * The chip sits at atan(30.7 / 150) = 11.6 deg at its LOWEST edge. That is above every
 * reachable card position in every arc state, by construction rather than by tuning — the
 * arc cannot reflow into it. Horizontally 21 / 150 = 8.0 deg keeps it inside the ~11 deg
 * half-width, and off to the right of the centred status pill.
 */
export const RELAY_LANG_CHIP_X_CM = 21
export const RELAY_LANG_CHIP_Y_CM = 32
export const RELAY_LANG_CHIP_Z_CM = -150
export const RELAY_LANG_CHIP_W_CM = 5.4
export const RELAY_LANG_CHIP_H_CM = 2.6

/**
 * Where the expanded list lives: FORWARD of the chip, not above it.
 *
 * Opening upward put the list in the same visual field as the lower cards and they
 * tangled. Coming toward the camera puts it on a nearer plane so it floats clear of
 * everything behind it. It also has to move INWARD as it comes forward — at world
 * z = -85 the horizontal half-FOV is 15.4 cm, so the old x = -15.5 would fall off the
 * side of the display. x = -8 keeps the whole row on screen while staying left of centre.
 */
export const RELAY_LANG_OPEN_X_CM = 16
export const RELAY_LANG_OPEN_Z_CM = -122
export const RELAY_LANG_OPEN_MS = 380

/** How far the queue recedes while you are choosing. */
export const RELAY_LANG_DIM = 0.35

/**
 * Expanded list: six rows stacked DOWNWARD from the chip.
 *
 * They stacked upward when the chip was at the bottom of the view. Now that it is in the
 * header the list has to hang below it, or it would run off the top of the display.
 */
export const RELAY_LANG_ROW_DIR = -1
export const RELAY_LANG_ROW_H_CM = 2.0
export const RELAY_LANG_ROW_GAP_CM = 0.3

/**
 * Clearance between the chip's top edge and the FIRST row.
 *
 * At the old 0.2 cm the bottom row (English, the default and the one a viewer is most
 * likely to switch back to) sat inside the chip's own hit volume, so the pinch landed on
 * the chip and toggled the list instead of selecting. 1.2 cm separates them cleanly; the
 * whole stack still ends at 5.8 deg against an 18.3 deg vertical limit.
 */
export const RELAY_LANG_FIRST_GAP_CM = 1.2

/**
 * The one line telling you what your partner is reading in. It follows the chip into the
 * header band and sits ABOVE it, because the expanded list now hangs below.
 */
export const RELAY_LANG_PARTNER_Y_CM = 35.5

// ---------------------------------------------------------------------------
// Motion — everything eases out, nothing bounces.
// ---------------------------------------------------------------------------

export const RELAY_MOTION_MIN_MS = 300
export const RELAY_MOTION_MAX_MS = 600

/** Cubic ease-out. The only easing Relay uses. */
export function easeOut(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  const inv = 1 - c
  return 1 - inv * inv * inv
}

/**
 * Slow at both ends, gathering in the middle. The motion of something being DRAWN away
 * by air rather than pushed along a rail: easeOut is already at full speed on frame one,
 * which is exactly what reads as mechanical on a short travel.
 */
export function smootherStep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return c * c * c * (c * (c * 6 - 15) + 10)
}

/** Arrives fast, then settles for a long time. Used where something should condense. */
export function easeOutQuint(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  const inv = 1 - c
  return 1 - inv * inv * inv * inv * inv
}

// ---------------------------------------------------------------------------
// Networking cadence
// ---------------------------------------------------------------------------

/** Sync Kit disconnects clients that flood. Cap every synced property at 10 Hz. */
export const RELAY_MAX_SENDS_PER_SECOND = 10

/** Stable network id so both panes agree which entity carries the shared queue. */
export const RELAY_QUEUE_NETWORK_ID = "RelayQueueState"

// ---------------------------------------------------------------------------
// The pass, seen — paper released in one place, arriving in another
// ---------------------------------------------------------------------------

/**
 * Peel (sender) and resolve (receiver) are deliberately the same length and the same
 * curve, run in opposite directions. The card that leaves your lane and the card that
 * lands in theirs are one object crossing one gap; making the two halves symmetric is
 * what sells that, rather than two unrelated animations that happen to share a moment.
 */
export const RELAY_PEEL_MS = 560
export const RELAY_RESOLVE_MS = 540

/** How far the sheet tips as the air catches it. Enough to read as lift, not as a flip. */
export const RELAY_PEEL_TILT_DEG = 15

/** Card-lengths of wake dropped behind a departing sheet. */
export const RELAY_WAKE_MARKS = 3

// ---------------------------------------------------------------------------
// Liquid glass — a specular band that drifts with the head
// ---------------------------------------------------------------------------

/**
 * Wet glass is not a brighter panel; it is a panel with a HIGHLIGHT THAT MOVES. The band
 * rides the card's own vertical gradient and is positioned from the direction the viewer
 * actually is, so leaning changes where the sheen sits. Alpha only — lifting RGB toward
 * white would clip the ownership hue, which is the bug that flattened the palette before.
 */
export const RELAY_GLOSS_HALF_WIDTH = 0.13
export const RELAY_GLOSS_ALPHA_BOOST = 1.9
/** How fast the band chases the head. Slow enough to feel like a surface, not a cursor. */
export const RELAY_GLOSS_EASE = 0.12

// ---------------------------------------------------------------------------
// Per-pane ambient wash — atmosphere, never ownership
// ---------------------------------------------------------------------------

/**
 * THIS IS THE ONLY THING THAT DIFFERS BETWEEN THE TWO PANES.
 *
 * It is a light in the room, not a property of any card. Cards keep jade / lilac /
 * mineral by OWNERSHIP on both screens; this only changes the air they hang in, so the
 * two displays read as two places rather than one image shown twice.
 *
 * Host warm, guest cool. Host/guest is the only discriminator both clients already agree
 * on without another round trip, and it is stable for the life of the session — colouring
 * by "am I local" would tint BOTH panes warm and produce no distinction at all.
 *
 * The alpha is deliberately near the floor of perceptibility. If you can name its colour
 * without looking for it, it is too strong and it is competing with ownership.
 */
export const RELAY_AMBIENT_WARM = "#C9A27E"
export const RELAY_AMBIENT_COOL = "#7E9FC9"
export const RELAY_AMBIENT_ALPHA = 0.026
export const RELAY_AMBIENT_W_CM = 150
export const RELAY_AMBIENT_H_CM = 95
export const RELAY_AMBIENT_Y_CM = 2
export const RELAY_AMBIENT_Z_CM = -196

// ---------------------------------------------------------------------------
// Header band — a status strip, not a feature
// ---------------------------------------------------------------------------

/**
 * The band shares the language chip's baseline and depth, because the chip is the one
 * header element whose position is already proven safe: no card can reach above 9.7 deg
 * and the chip's lowest edge sits at 11.6 deg. Hanging the rest of the strip off that
 * same line means the whole header inherits the clearance instead of re-deriving it.
 */
export const RELAY_HEADER_Y_CM = RELAY_LANG_CHIP_Y_CM
export const RELAY_HEADER_Z_CM = RELAY_LANG_CHIP_Z_CM

/**
 * Five evenly spaced slots, left to right, the last one landing exactly on the chip:
 * wordmark, connection dot, queue counter, local time, language chip.
 * (21 - (-20)) / 4 = 10.25 cm apart. Even spacing is most of what makes a strip read as
 * arranged rather than assembled.
 */
export const RELAY_HEADER_X0_CM = -21
export const RELAY_HEADER_SLOT_CM = 10.5

/** Small tags (the timezone) hang on a second line under the baseline. */
export const RELAY_HEADER_SUB_DY_CM = -2.9

/**
 * How dim the header sits relative to a card edge.
 *
 * The whole point of the band is that it must lose the competition for attention. The
 * cards just earned their calm by dropping to glass; a bright status bar would spend it.
 */
// Raised from 0.66/0.46. Calm is a brightness, not an absence — at the old values the
// strip was only readable zoomed in, which makes it decoration rather than a readout.
export const RELAY_HEADER_DIM = 0.95
export const RELAY_HEADER_LABEL_DIM = 0.8

/** Presence dot: solid when the partner is here, hollow when you are alone. */
export const RELAY_HEADER_DOT_CM = 0.78
// The resting brightness is deliberately well BELOW full, because the pulse has to have
// somewhere to go. At 0.72 resting the flash could only travel 0.28 before clipping,
// which is why it read as static — there was no headroom, not no pulse.
export const RELAY_HEADER_DOT_ALONE = 0.2
export const RELAY_HEADER_DOT_PRESENT = 0.45

/**
 * One soft brightness pulse per sync event, decaying.
 *
 * This is the only element in the piece that reports the WIRE rather than the queue. It
 * fires on the events the cards already react to — claim, pass, arrival — so it costs no
 * extra network traffic, and it makes the invisible visible: the dot flickers at the
 * moment something crosses between the two panes.
 */
export const RELAY_HEADER_PULSE_MS = 380
export const RELAY_HEADER_PULSE_LIFT = 0.55

/**
 * The flash also SWELLS the dot.
 *
 * Alpha alone was never going to carry this: a 0.78 cm dot brightening by a quarter is
 * invisible on camera across a room. Size is the channel the eye actually catches, and it
 * costs no new hue — the dot stays mineral throughout, it just briefly becomes a much
 * bigger mineral dot.
 */
export const RELAY_HEADER_PULSE_SCALE = 2.4

/** Wordmark dots, in ownership colours: the two people this board belongs to. */
export const RELAY_HEADER_MARK_DOT_CM = 0.62
export const RELAY_HEADER_MARK_GAP_CM = 0.95

/**
 * Presentation offset for the GUEST pane's clock, in hours.
 *
 * Two clients in two cities genuinely show two times; two preview panes on ONE machine
 * share one system clock and would show the same time, which tells the opposite story.
 * This offsets the guest's DISPLAYED clock so a recording on a single machine shows what
 * a real pair would. Set it to 0 for truthful local time on both panes.
 */
export const RELAY_TIME_GUEST_OFFSET_HOURS = -8

/**
 * The arc's ends fade, because five cards are a window onto a longer queue.
 *
 * TILT skews the fill gradient sideways so an outer card thins toward its outer edge;
 * STRENGTH is the overall softening applied on top, quadratic so the middle three cards
 * are untouched and only the true outliers give way.
 */
export const RELAY_EDGE_FADE_TILT = 0.34
export const RELAY_EDGE_FADE_STRENGTH = 0.42

// ---------------------------------------------------------------------------
// Language dropdown — a menu, not a scatter of rows
// ---------------------------------------------------------------------------

/**
 * The list hangs BELOW the chip and NEARER to the viewer.
 *
 * It used to travel from behind the chip to a position overlapping it, which is why it
 * tangled: the button and the menu wanted the same pixels. A dropdown has one rule — the
 * trigger stays visible and the list appears clear of it — and the geometry here enforces
 * that rather than hoping for it. The chip's bottom edge sits at 30.7 cm at z = -150,
 * which is 24.6 cm at this nearer plane; the first row starts below that with a gap.
 *
 * Nearer also means it renders in front of every card (the closest card is z = -136), so
 * the menu floats above the scene instead of being interleaved with it.
 */
export const RELAY_LANG_LIST_X_CM = 15.5
export const RELAY_LANG_LIST_Z_CM = -120
export const RELAY_LANG_LIST_TOP_CM = 22.2
export const RELAY_LANG_LIST_W_CM = 7.6
export const RELAY_LANG_LIST_ROW_H_CM = 2.2
export const RELAY_LANG_LIST_PITCH_CM = 2.65

/** Rows slide down INTO place: they start this far above their slot and settle. */
export const RELAY_LANG_LIST_RISE_CM = 1.5

/** Per-row delay, so the list unrolls instead of appearing all at once. */
export const RELAY_LANG_STAGGER_MS = 42
export const RELAY_LANG_ROW_MS = 260

/** The panel behind the rows: what turns six controls into one menu. */
export const RELAY_LANG_PANEL_PAD_CM = 0.7
export const RELAY_LANG_PANEL_ALPHA = 0.3

/**
 * Left end of the lane. Slot i is always this plus i spacings — fixed forever, so adding
 * a card never moves the ones already there.
 */
export const RELAY_LANE_ANCHOR_X_CM = -8.5

/**
 * Vertical separation between cards that share a priority.
 *
 * Small on purpose: it must never be large enough to lift a priority-2 card above a
 * priority-3 one, or height would stop meaning urgency. With the axis spanning 34 cm and
 * up to five cards, 5 cm of fan cannot cross a real priority step.
 */
export const RELAY_URGENCY_TIE_FAN_CM = 5

// ---------------------------------------------------------------------------
// Urgency rail — the axis, made readable
// ---------------------------------------------------------------------------

/**
 * A faint mineral rail down the left of the arc, with one word at each end.
 *
 * The arc has always encoded urgency in height, and viewers have consistently read it as
 * scatter — because nothing on screen said the vertical axis meant anything. This is the
 * legend. It is deliberately the dimmest thing in the scene: it needs to be found once,
 * understood, and then ignored forever.
 */
export const RELAY_RAIL_X_CM = -29
export const RELAY_RAIL_Z_CM = -150
export const RELAY_RAIL_W_CM = 0.16
export const RELAY_RAIL_TOP_CM = 20
export const RELAY_RAIL_BOTTOM_CM = -20
export const RELAY_RAIL_ALPHA_TOP = 0.5
export const RELAY_RAIL_ALPHA_BOTTOM = 0.08
export const RELAY_RAIL_LABEL_DIM = 0.5
export const RELAY_RAIL_LABEL_GAP_CM = 2.2







// ---------------------------------------------------------------------------
// The light bridge — the pass, made visible in the volume
// ---------------------------------------------------------------------------

/**
 * How far the beam bows out of the straight line between the two lanes. A straight line
 * is a diagram; an arc is a THROW — something with weight leaving one hand and being
 * caught by another. The bow lifts and also comes slightly toward the viewer, so the
 * connection passes through the room rather than across a plane behind it.
 */
export const RELAY_BRIDGE_BOW_CM = 13
export const RELAY_BRIDGE_BOW_NEAR = 0.45

/** Beads of light along the curve: dense enough to read as one beam, cheap enough to pool. */
/** Cross-sections along the swept ribbon. 26 is smooth at this arc length. */
export const RELAY_BRIDGE_SEGMENTS = 26
/** Width at the ribbon's widest point, tapering to a quarter of it at both ends. */
export const RELAY_BRIDGE_WIDTH_CM = 3.4

/** Springs in from the sender's end, holds while the card crosses, then fades from it. */
export const RELAY_BRIDGE_SPRING_MS = 190
export const RELAY_BRIDGE_FADE_MS = 170

/** Half-width of the travelling pulse, in fractions of the beam's length. */
export const RELAY_BRIDGE_PULSE_WIDTH = 0.13
/** The pulse runs AHEAD of the card, so the eye is led to the destination first. */
export const RELAY_BRIDGE_PULSE_LEAD = 0.22

/**
 * Faint environmental light caught on the card's specular band: warm on the host pane,
 * cool on the guest. Environmental light only — never an ownership signal.
 */
export const RELAY_GLASS_ENV_TINT = 0.16

// ---------------------------------------------------------------------------
// The slab — a card with real thickness
// ---------------------------------------------------------------------------

/**
 * How deep the card body is, in cm.
 *
 * This is the number that turns a sticker into an object. At 1.8 cm the sides are a
 * genuine surface: move your head a few degrees and you see the card's thickness, tinted
 * with its ownership colour, which is depth you cannot fake with a gradient.
 */
export const RELAY_SLAB_DEPTH_CM = 1.8

/** The body sits just behind the face so the BackPlate always wins the z-fight. */
export const RELAY_SLAB_BEHIND_CM = 1.0

/** A hair larger than the face, so the body reads as the card's edge rather than a halo. */
export const RELAY_SLAB_INSET_CM = 0.25

/**
 * How much the arc's natural look-at yaw is amplified.
 *
 * Cards already turn to face the origin, but across a 19 deg arc that is only about
 * +/-8 deg of rotation — too little to read, which is why five cards look like a flat
 * wall. Multiplying the yaw turns the set into a rack that visibly wraps around the
 * viewer, and because it only changes YAW the arc's height=urgency and depth=age
 * positions are untouched.
 *
 * Above roughly 3 the outermost cards start turning far enough that their text begins to
 * foreshorten; 2.4 is the most wrap that keeps every headline square-on enough to read.
 */
export const RELAY_ARC_YAW_GAIN = 2.4

/** Slab material defaults. Tunable on relay_slab.mat; these are what the script drives. */
export const RELAY_SLAB_FACE_OPACITY = 0.05
export const RELAY_SLAB_EDGE_OPACITY = 0.72
export const RELAY_SLAB_FROST = 0.6
export const RELAY_SLAB_INTENSITY = 0.95
