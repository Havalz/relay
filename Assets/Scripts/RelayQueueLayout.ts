/**
 * RelayQueueLayout — turns a list of work items into positions in space.
 *
 * OWNS:      the spatial encoding. The queue is a coordinate space, not a list:
 *              height   (Y)      = urgency  — urgent floats higher
 *              distance (radius) = age      — the longer it waits, the closer it comes
 *              colour            = ownership (owned by the renderer, not this module)
 * EXPECTS:   nothing (pure functions, no scene access, no @input).
 * MUST NOT:  read or write the scene, or make any decision about colour.
 *
 * Cards sit on a cylindrical arc so that the two encoded axes stay independent:
 * the slot angle only spreads cards apart, it carries no data. Slot order comes from
 * sortForQueue(), which is deterministic, so the host and the guest lay out the same
 * items in the same places without exchanging any layout information.
 */

import {
  RELAY_LANE_ANCHOR_X_CM,
  RELAY_URGENCY_TIE_FAN_CM,
  RELAY_LANE_SPACING_CM,
  RELAY_LANE_Y_CM,
  RELAY_LANE_Z_CM
} from "./RelayConfig"
import {ageSeconds, formatAge, sortForQueue, WorkItem} from "./RelayWorkItem"

export interface QueueLayoutOptions {
  /** TOTAL arc the queue may occupy, including the width of the outermost cards. */
  arcSpanDegrees: number
  nearDistanceCm: number
  farDistanceCm: number
  minHeightCm: number
  maxHeightCm: number
  /** Card width in centimetres. Needed to inset the arc so cards fit INSIDE the span. */
  cardWidthCm: number
  /** Hard ceiling on how many cards are placed. Surplus items keep their data, get no position. */
  maxVisibleCards: number
}

export interface CardPlacement {
  item: WorkItem
  /** Local position within the colocated queue root. */
  position: vec3
  /** Y rotation, in radians, that turns the card's face back toward the user. */
  yawRadians: number
  /** 0..1 normalised urgency. Drives brightness — never hue. */
  urgency: number
  /**
   * 0 at the middle of the arc, 1 at either end, with the sign giving which end.
   *
   * The arc shows five of however many are open, so its outer cards are a CUT, not a
   * boundary. Fading them toward their outer edge turns that cut into a window: the
   * queue reads as continuing past the frame instead of stopping at it.
   */
  edgeFade: number
  edgeSide: number
  /** Precomputed human age for the card's metadata row. */
  ageLabel: string
}

const DEG_TO_RAD = Math.PI / 180

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Normalise v into 0..1 across [min, max]. A degenerate range (every item equal)
 * collapses to the midpoint rather than dividing by zero.
 */
function normalise(v: number, min: number, max: number): number {
  if (!(max > min)) return 0.5
  const t = (v - min) / (max - min)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Normalise on a LOG scale. Used for age only.
 *
 * Queue ages are heavy-tailed: four items minutes old alongside one a day old is
 * normal. Linear seconds let the stale item own the whole range and flatten the rest
 * — measured at 2.8 cm of separation across four items spanning 26 min to 2 h, against
 * 40 cm for the single 27 h item. Distance is supposed to read as a gradient, so the
 * axis follows log(age), where each order of magnitude gets equal room.
 *
 * log1p keeps a zero-second age representable instead of diverging to -Infinity.
 */
function normaliseLog(v: number, min: number, max: number): number {
  const lv = Math.log1p(v > 0 ? v : 0)
  const lmin = Math.log1p(min > 0 ? min : 0)
  const lmax = Math.log1p(max > 0 ? max : 0)
  if (!(lmax > lmin)) return 0.5
  const t = (lv - lmin) / (lmax - lmin)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Where the Nth card in the local user's lane sits. The lane is a shallow row centred
 * under the arc; it carries no encoded data, it only says "these are mine".
 */
/**
 * Where a claimed card sits in your lane. ANCHORED, not centred.
 *
 * This used to centre the row on x = 0, which meant taking a fourth card slid the first
 * three sideways to make room. Nothing was scrolling — but a static record that shuffles
 * every time you add to it reads exactly like a scroller, and it is the wrong idea twice
 * over: the lane is a record of what you have taken, so a card's place in it should be
 * fixed the moment you take it.
 *
 * Anchoring at the left end means slot i is always the same x forever. The common
 * three-card lane lands on the same -8.5 / 0 / +8.5 it always did; the difference only
 * shows on the fourth, which now appends instead of pushing.
 */
export function lanePosition(index: number, count: number): vec3 {
  const x = RELAY_LANE_ANCHOR_X_CM + index * RELAY_LANE_SPACING_CM
  return new vec3(x, RELAY_LANE_Y_CM, RELAY_LANE_Z_CM)
}

export function computePlacements(
  items: WorkItem[],
  opts: QueueLayoutOptions,
  nowMs: number
): CardPlacement[] {
  // Sort first, then truncate: sortForQueue is deterministic, so the host and the guest
  // independently choose the SAME visible subset without exchanging layout information.
  const sorted = sortForQueue(items)
  const limit = opts.maxVisibleCards > 0 ? opts.maxVisibleCards : sorted.length
  const ordered = sorted.length > limit ? sorted.slice(0, limit) : sorted
  const count = ordered.length
  if (count === 0) return []

  // Observed ranges, so the encoding stays legible whatever the data looks like.
  let minPriority = Number.POSITIVE_INFINITY
  let maxPriority = Number.NEGATIVE_INFINITY
  let minAge = Number.POSITIVE_INFINITY
  let maxAge = Number.NEGATIVE_INFINITY
  const ages: number[] = []

  for (let i = 0; i < count; i++) {
    const p = ordered[i].priority
    if (p < minPriority) minPriority = p
    if (p > maxPriority) maxPriority = p
    const a = ageSeconds(ordered[i], nowMs)
    ages.push(a)
    if (a < minAge) minAge = a
    if (a > maxAge) maxAge = a
  }

  // arcSpanDegrees is the TOTAL width the queue may occupy, card edges included. Card
  // centres therefore spread across the span MINUS one card's angular width, so the
  // outermost cards' outer edges land on the boundary instead of overhanging it.
  // The near plane is the worst case: the same card subtends a wider angle up close.
  const span = opts.arcSpanDegrees * DEG_TO_RAD
  const cardAngular = 2 * Math.atan(opts.cardWidthCm / 2 / opts.nearDistanceCm)
  const centreSpan = Math.max(0, span - cardAngular)
  const step = count > 1 ? centreSpan / (count - 1) : 0
  const start = count > 1 ? -centreSpan / 2 : 0

  const placements: CardPlacement[] = []
  for (let i = 0; i < count; i++) {
    const item = ordered[i]

    const urgency = normalise(item.priority, minPriority, maxPriority)

    // Height means urgency — and among cards of EQUAL urgency it also means "waiting
    // longer sits higher", because the queue is sorted priority-first then oldest-first.
    //
    // Without this, three priority-3 items resolve to one identical y and sit in a flat
    // row, which is most of what made the arc look scattered: the eye saw a line of
    // equals with no reason for their left-to-right order. The fan is small enough that
    // it can never reorder two different priorities — it only separates a tie.
    const tie = count > 1 ? i / (count - 1) : 0
    const y =
      lerp(opts.minHeightCm, opts.maxHeightCm, urgency) +
      RELAY_URGENCY_TIE_FAN_CM * (0.5 - tie)

    // Older -> nearer. Log-scaled: 0 for the newest item, 1 for the oldest.
    const agedness = normaliseLog(ages[i], minAge, maxAge)
    const radius = lerp(opts.farDistanceCm, opts.nearDistanceCm, agedness)

    const spanPos = count > 1 ? (2 * i) / (count - 1) - 1 : 0
    const theta = start + step * i
    const x = radius * Math.sin(theta)
    const z = -radius * Math.cos(theta)

    // Turn the card so its +Z face points back at the origin (the user's head).
    const yaw = Math.atan2(-x, -z)

    placements.push({
      item: item,
      position: new vec3(x, y, z),
      yawRadians: yaw,
      urgency: urgency,
      edgeFade: Math.abs(spanPos),
      edgeSide: spanPos >= 0 ? 1 : -1,
      ageLabel: formatAge(ages[i])
    })
  }

  return placements
}
