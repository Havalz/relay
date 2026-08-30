/**
 * RelayBurst — the three moments, drawn as the card's own shape.
 *
 * OWNS:      a pool of small plates and their tweens.
 * EXPECTS:   a parent SceneObject in the same local space as the cards.
 * MUST NOT:  decide WHEN anything fires, or carry a hue of its own. Same contract as
 *            RelayAudio: an effect is a consequence of a state change, never a source of
 *            truth, and the colour it is handed is the ownership colour of the moment.
 *
 * WHY NOT A PARTICLE SYSTEM
 * The VFX Graph path was proven dead in this preview last session: with every content
 * node disabled, the engine's OWN all-defaults fallback — a grid of white quads — drew
 * nothing. That is environmental, upstream of any GLSL, so a second attempt would fail
 * the same way. These are ordinary UIKit plates instead, the exact component the cards
 * are built from and therefore known to render here.
 *
 * WHY RECTANGLES
 * A radial ring says "something happened somewhere". A card-shaped outline says "THAT
 * card". The shards carry the card's own aspect ratio for the same reason — they read as
 * pieces of the thing you just took, not as generic sparks.
 */

import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {
  RELAY_CARD_CORNER_RADIUS_CM,
  RELAY_CARD_EDGE_SOFTNESS,
  RELAY_CARD_HEIGHT_CM,
  RELAY_CARD_WIDTH_CM
} from "./RelayConfig"

/** Motion discipline: ease out, no bounce, nothing under 300 ms or over 600 ms. */
const OUTLINE_MS = 460
const SHARD_MS = 540
const TRAIL_MS = 420
const WAKE_MS = 540
const BLOOM_MS = 480

const SHARD_COUNT = 10
/** Shards keep the card's aspect (7.8 x 10.5) so they read as pieces of it. */
const SHARD_W = 0.86
const SHARD_H = 1.16

const OUTLINE_GROW = 1.32
const SHARD_SPREAD_CM = 5.2
const SHARD_RISE_CM = 4.4

/** Pool sizes: one full burst plus a second overlapping it, and a short trail. */
const POOL_SHARDS = SHARD_COUNT * 2
const POOL_OUTLINES = 3
const POOL_TRAIL = 7
// Three, not five. Five card-sized ghosts at 55% fill read as a stack of copies; three
// at a fraction of that read as one smear. Softer and fewer is the whole correction.
const POOL_WAKE = 3
const POOL_BLOOM = 2

/** The bloom opens to a little over a card and stops. It greets, it does not announce. */
const BLOOM_GROW = 1.55

function easeOut(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return 1 - Math.pow(1 - c, 3)
}

interface Mark {
  root: SceneObject
  shape: RoundedRectangle
  ready: boolean
  active: boolean
  startMs: number
  durMs: number
  from: vec3
  to: vec3
  fromScale: number
  toScale: number
  color: vec4
  /** Outlines draw border-only; shards and trail marks are filled. */
  filled: boolean
  /** Scales this mark's whole opacity. Wake marks are ghosts, not copies. */
  softness: number
}

export class RelayBurst {
  private shards: Mark[] = []
  private outlines: Mark[] = []
  private trail: Mark[] = []
  private wakeMarks: Mark[] = []
  private blooms: Mark[] = []

  private shardNext = 0
  private outlineNext = 0
  private trailNext = 0
  private wakeNext = 0
  private bloomNext = 0

  private built = false

  constructor(private readonly root: SceneObject) {}

  /**
   * Everything is built and initialised up front, disabled.
   *
   * A plate's material does not exist until BackPlate.initialize() has run, and writing a
   * colour before then throws inside UIKit — the same lifecycle trap that cost a session.
   * Pre-warming at startup means every mark is already `ready` by the time a claim can
   * possibly happen, so the fire path never races initialisation.
   */
  public build(): void {
    if (this.built) return
    this.built = true

    for (let i = 0; i < POOL_SHARDS; i++) {
      this.shards.push(this.makeMark("RelayShard" + i, SHARD_W, SHARD_H, true))
    }
    for (let i = 0; i < POOL_OUTLINES; i++) {
      this.outlines.push(
        this.makeMark("RelayOutline" + i, RELAY_CARD_WIDTH_CM, RELAY_CARD_HEIGHT_CM, false)
      )
    }
    for (let i = 0; i < POOL_TRAIL; i++) {
      this.trail.push(this.makeMark("RelayTrail" + i, SHARD_W * 1.6, SHARD_H * 1.6, true))
    }
    // Wake marks are card-shaped and card-sized: they are after-images of the sheet
    // itself, so anything smaller would read as sparks rather than as motion blur.
    for (let i = 0; i < POOL_WAKE; i++) {
      this.wakeMarks.push(
        this.makeMark("RelayWake" + i, RELAY_CARD_WIDTH_CM * 0.7, RELAY_CARD_HEIGHT_CM * 0.7, true)
      )
    }
    for (let i = 0; i < POOL_BLOOM; i++) {
      this.blooms.push(
        this.makeMark("RelayBloom" + i, RELAY_CARD_WIDTH_CM * 0.8, RELAY_CARD_HEIGHT_CM * 0.8, true)
      )
    }
  }

  private makeMark(name: string, w: number, h: number, filled: boolean): Mark {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.root)

    const plate = obj.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(w, h)

    const shape = obj.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle

    const mark: Mark = {
      root: obj,
      shape: shape,
      ready: false,
      active: false,
      startMs: 0,
      durMs: 0,
      from: vec3.zero(),
      to: vec3.zero(),
      fromScale: 1,
      toScale: 1,
      color: new vec4(1, 1, 1, 1),
      filled: filled,
      softness: 1
    }

    plate.onInitialized.add(() => {
      mark.ready = true
      // A mark is decoration, never a target.
      const collider = obj.getComponent("Physics.ColliderComponent")
      if (collider) collider.enabled = false
      if (plate.interactable) plate.interactable.enabled = false
      obj.enabled = false
    })

    return mark
  }

  private launch(
    mark: Mark,
    from: vec3,
    to: vec3,
    fromScale: number,
    toScale: number,
    color: vec4,
    durMs: number,
    now: number
  ): void {
    if (!mark.ready) return
    mark.active = true
    mark.startMs = now
    mark.durMs = durMs
    mark.from = from
    mark.to = to
    mark.fromScale = fromScale
    mark.toScale = toScale
    mark.color = color
    mark.root.enabled = true
    mark.root.getTransform().setLocalPosition(from)
    this.paint(mark, 1)
  }

  private paint(mark: Mark, rawAlpha: number): void {
    if (!mark.ready || isNull(mark.shape)) return
    const alpha = rawAlpha * mark.softness
    const c = mark.color
    const shape = mark.shape
    shape.cornerRadius = RELAY_CARD_CORNER_RADIUS_CM
    shape.gradient = false
    shape.backgroundColor = new vec4(c.r, c.g, c.b, mark.filled ? 0.42 * alpha : 0)
    shape.border = true
    shape.borderType = "Color"
    shape.borderColor = new vec4(c.r, c.g, c.b, alpha)
    shape.borderSize = mark.filled ? 0.05 : 0.16
    shape.borderSoftness = RELAY_CARD_EDGE_SOFTNESS
  }

  /**
   * A burst of card-shaped shards leaving the card's own outline.
   *
   * They start ON the perimeter rather than at the centre, so the effect reads as the card
   * coming apart rather than as something detonating behind it.
   */
  private burst(at: vec3, color: vec4, rise: number, now: number): void {
    for (let i = 0; i < SHARD_COUNT; i++) {
      const mark = this.shards[this.shardNext]
      this.shardNext = (this.shardNext + 1) % this.shards.length

      const a = (i / SHARD_COUNT) * Math.PI * 2
      const ox = Math.cos(a) * (RELAY_CARD_WIDTH_CM * 0.42)
      const oy = Math.sin(a) * (RELAY_CARD_HEIGHT_CM * 0.42)
      const from = new vec3(at.x + ox, at.y + oy, at.z)
      const to = new vec3(
        at.x + ox + Math.cos(a) * SHARD_SPREAD_CM,
        at.y + oy + Math.sin(a) * SHARD_SPREAD_CM * 0.5 + rise,
        at.z
      )
      mark.softness = 1
      this.launch(mark, from, to, 1, 0.45, color, SHARD_MS, now)
    }
  }

  /** You took this card: jade shards lift off it. */
  public claimAt(at: vec3, jade: vec4, now: number): void {
    this.burst(at, jade, SHARD_RISE_CM, now)
  }

  /** Your partner took that one: lilac shards rise where it used to be. */
  public dissolveAt(at: vec3, lilac: vec4, now: number): void {
    this.burst(at, lilac, SHARD_RISE_CM * 1.4, now)
  }

  /** Something entered the queue: one card-shaped outline, expanding once. */
  public arrivalAt(at: vec3, mineral: vec4, now: number): void {
    const mark = this.outlines[this.outlineNext]
    this.outlineNext = (this.outlineNext + 1) % this.outlines.length
    mark.softness = 1
    this.launch(mark, at, at, 0.82, OUTLINE_GROW, mineral, OUTLINE_MS, now)
  }

  /**
   * The pass: a short trail dropped along the crossing, tinted from the sender's hue to
   * the receiver's, so the handover of OWNERSHIP is legible while the card is still moving.
   */
  public passTrail(from: vec3, to: vec3, jade: vec4, lilac: vec4, now: number): void {
    for (let i = 0; i < POOL_TRAIL; i++) {
      const mark = this.trail[this.trailNext]
      this.trailNext = (this.trailNext + 1) % this.trail.length

      const k = i / (POOL_TRAIL - 1)
      const at = new vec3(
        from.x + (to.x - from.x) * k,
        from.y + (to.y - from.y) * k,
        from.z + (to.z - from.z) * k
      )
      // Jade at the sending end, lilac at the receiving end. No third hue in between.
      const tint = new vec4(
        jade.r + (lilac.r - jade.r) * k,
        jade.g + (lilac.g - jade.g) * k,
        jade.b + (lilac.b - jade.b) * k,
        1
      )
      mark.softness = 0.55
      this.launch(mark, at, at, 0.9, 0.5, tint, TRAIL_MS, now)
    }
  }

  /**
   * A soft wake behind a departing sheet.
   *
   * The marks are staggered in TIME as well as space, so they resolve into a smear that
   * follows the card rather than a row of ghosts that all appear at once.
   */
  public wake(from: vec3, to: vec3, jade: vec4, now: number): void {
    for (let i = 0; i < POOL_WAKE; i++) {
      const mark = this.wakeMarks[this.wakeNext]
      this.wakeNext = (this.wakeNext + 1) % this.wakeMarks.length

      const k = i / POOL_WAKE
      const at = new vec3(
        from.x + (to.x - from.x) * k,
        from.y + (to.y - from.y) * k,
        from.z + (to.z - from.z) * k
      )
      // Faint at the head of the smear and fainter behind it, so the trail dissolves
      // rather than ending. Nothing here should ever look like a second card.
      mark.softness = 0.3 * (1 - k * 0.55)
      // Each mark starts slightly later and lives slightly shorter than the one before.
      const start = now + k * 110
      const mk = this.launchAt(mark, at, at, 1, 0.9, jade, WAKE_MS * (1 - k * 0.3), start)
      if (!mk) continue
    }
  }

  /** A soft bloom greeting a sheet as it lands. */
  public bloomAt(at: vec3, lilac: vec4, now: number): void {
    const mark = this.blooms[this.bloomNext]
    this.bloomNext = (this.bloomNext + 1) % this.blooms.length
    mark.softness = 0.45
    this.launch(mark, at, at, 0.5, BLOOM_GROW, lilac, BLOOM_MS, now)
  }

  /** launch() with an explicit (possibly future) start time. */
  private launchAt(
    mark: Mark,
    from: vec3,
    to: vec3,
    fromScale: number,
    toScale: number,
    color: vec4,
    durMs: number,
    startMs: number
  ): boolean {
    if (!mark.ready) return false
    this.launch(mark, from, to, fromScale, toScale, color, durMs, startMs)
    return true
  }

  /** One frame of every live mark. Driven from the UI's existing tick. */
  public tick(now: number): void {
    this.step(this.shards, now)
    this.step(this.outlines, now)
    this.step(this.trail, now)
    this.step(this.wakeMarks, now)
    this.step(this.blooms, now)
  }

  private step(marks: Mark[], now: number): void {
    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]
      if (!mark.active) continue

      const t = (now - mark.startMs) / mark.durMs
      if (t < 0) {
        // Staggered wake mark that has not begun yet.
        mark.root.enabled = false
        continue
      }
      if (!mark.root.enabled) mark.root.enabled = true
      if (t >= 1) {
        mark.active = false
        mark.root.enabled = false
        continue
      }

      const k = easeOut(t)
      const s = mark.fromScale + (mark.toScale - mark.fromScale) * k
      mark.root
        .getTransform()
        .setLocalPosition(
          new vec3(
            mark.from.x + (mark.to.x - mark.from.x) * k,
            mark.from.y + (mark.to.y - mark.from.y) * k,
            mark.from.z + (mark.to.z - mark.from.z) * k
          )
        )
      mark.root.getTransform().setLocalScale(new vec3(s, s, s))

      // Fade accelerates so the tail is short and the moment stays a moment.
      const fade = 1 - t
      this.paint(mark, fade * fade)
    }
  }
}
