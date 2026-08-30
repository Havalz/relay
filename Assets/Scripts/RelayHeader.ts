/**
 * RelayHeader — the status strip above the queue.
 *
 * OWNS:      the wordmark, the presence dot, the queue counter and the local clock, their
 *            layout, and the dot's pulse.
 * EXPECTS:   a parent in the same local space as the cards, and to be told about sync
 *            events by whoever already handles them.
 * MUST NOT:  originate network traffic, or hold any queue state of its own. Everything
 *            here is a READOUT; if the header disappeared, nothing about how Relay works
 *            would change.
 *
 * WHY IT IS DELIBERATELY DULL
 * The cards spent five sessions getting quiet enough to read as glass. A status bar that
 * competes with them would spend that immediately, so every element here is mineral at
 * roughly half brightness and carries exactly one fact. The one thing allowed to move is
 * the presence dot, and only for 220 ms at a time.
 */

import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {
  hexToVec4,
  RELAY_HEADER_DIM,
  RELAY_HEADER_DOT_ALONE,
  RELAY_HEADER_DOT_CM,
  RELAY_HEADER_DOT_PRESENT,
  RELAY_HEADER_LABEL_DIM,
  RELAY_HEADER_MARK_DOT_CM,
  RELAY_HEADER_MARK_GAP_CM,
  RELAY_HEADER_PULSE_LIFT,
  RELAY_HEADER_PULSE_MS,
  RELAY_HEADER_PULSE_SCALE,
  RELAY_HEADER_SLOT_CM,
  RELAY_HEADER_SUB_DY_CM,
  RELAY_HEADER_X0_CM,
  RELAY_HEADER_Y_CM,
  RELAY_HEADER_Z_CM,
  RELAY_HEX_PARTNERS,
  RELAY_HEX_YOURS,
  RELAY_RAIL_ALPHA_BOTTOM,
  RELAY_RAIL_ALPHA_TOP,
  RELAY_RAIL_BOTTOM_CM,
  RELAY_RAIL_LABEL_DIM,
  RELAY_RAIL_LABEL_GAP_CM,
  RELAY_RAIL_TOP_CM,
  RELAY_RAIL_W_CM,
  RELAY_RAIL_X_CM,
  RELAY_RAIL_Z_CM,
  RELAY_TIME_GUEST_OFFSET_HOURS
} from "./RelayConfig"

// Calibrated against the card type (title 46, meta 38) at roughly the same depth. The
// header should read as smaller and quieter than a headline, not as a different medium.
const SIZE_MARK = 56
const SIZE_VALUE = 56
const SIZE_LABEL = 38
const WEIGHT_LIGHT = 400

/** Slot centres, left to right. Slot 4 is the language chip, which owns itself. */
function slotX(index: number): number {
  return RELAY_HEADER_X0_CM + index * RELAY_HEADER_SLOT_CM
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n)
}

export class RelayHeader {
  private root: SceneObject | null = null

  private dotObj: SceneObject | null = null
  private dotShape: RoundedRectangle | null = null
  private dotReady = false


  private counterText: Text | null = null
  private clockText: Text | null = null
  private zoneText: Text | null = null

  private partnerPresent = false
  private pulseUntilMs = 0
  private lastClock = ""

  /** Guest panes show a shifted clock so a one-machine recording tells the true story. */
  private offsetHours = 0

  private built = false

  constructor(
    private readonly parent: SceneObject,
    private readonly mineral: vec4
  ) {}

  public build(): void {
    if (this.built || isNull(this.parent)) return
    this.built = true

    const root = global.scene.createSceneObject("RelayHeader")
    root.setParent(this.parent)
    this.root = root

    this.buildWordmark(root)
    this.buildPresenceDot(root)
    this.counterText = this.makeText(root, "HeaderCount", slotX(2), 0, SIZE_VALUE, RELAY_HEADER_DIM)
    this.clockText = this.makeText(root, "HeaderClock", slotX(3), 0, SIZE_VALUE, RELAY_HEADER_DIM)
    this.zoneText = this.makeText(
      root,
      "HeaderZone",
      slotX(3),
      RELAY_HEADER_SUB_DY_CM,
      SIZE_LABEL,
      RELAY_HEADER_LABEL_DIM
    )

    this.buildUrgencyRail(root)
  }

  /**
   * The urgency legend: a rail down the left of the arc, bright at the top and fading
   * out at the bottom, with one word at each end.
   *
   * The gradient does the teaching before the words are read — brightness falling away
   * downward is the same "less" the cards themselves use, so the rail and the queue agree
   * without anyone explaining it.
   */
  private buildUrgencyRail(root: SceneObject): void {
    const height = RELAY_RAIL_TOP_CM - RELAY_RAIL_BOTTOM_CM
    const midY = (RELAY_RAIL_TOP_CM + RELAY_RAIL_BOTTOM_CM) / 2

    const obj = global.scene.createSceneObject("RelayUrgencyRail")
    obj.setParent(root)
    obj.getTransform().setLocalPosition(new vec3(RELAY_RAIL_X_CM, midY, RELAY_RAIL_Z_CM))

    const plate = obj.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(RELAY_RAIL_W_CM, height)

    const shape = obj.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    const m = this.mineral

    plate.onInitialized.add(() => {
      const collider = obj.getComponent("Physics.ColliderComponent")
      if (collider) collider.enabled = false
      if (plate.interactable) plate.interactable.enabled = false
      if (isNull(shape)) return
      shape.border = false
      shape.cornerRadius = RELAY_RAIL_W_CM * 0.5
      shape.setBackgroundGradient({
        enabled: true,
        type: "Linear",
        start: new vec2(0.5, 0),
        end: new vec2(0.5, 1),
        stop0: {enabled: true, percent: 0, color: new vec4(m.r, m.g, m.b, RELAY_RAIL_ALPHA_BOTTOM)},
        stop1: {enabled: true, percent: 0.5, color: new vec4(m.r, m.g, m.b, RELAY_RAIL_ALPHA_BOTTOM * 2.4)},
        stop2: {enabled: true, percent: 0.85, color: new vec4(m.r, m.g, m.b, RELAY_RAIL_ALPHA_TOP * 0.8)},
        stop3: {enabled: true, percent: 1, color: new vec4(m.r, m.g, m.b, RELAY_RAIL_ALPHA_TOP)}
      })
    })

    const top = this.makeRailLabel(root, "RailTop", RELAY_RAIL_TOP_CM + RELAY_RAIL_LABEL_GAP_CM)
    top.text = "urgent"
    const bottom = this.makeRailLabel(
      root,
      "RailBottom",
      RELAY_RAIL_BOTTOM_CM - RELAY_RAIL_LABEL_GAP_CM
    )
    bottom.text = "calm"
  }

  private makeRailLabel(root: SceneObject, name: string, y: number): Text {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(root)
    obj.getTransform().setLocalPosition(new vec3(RELAY_RAIL_X_CM, y, RELAY_RAIL_Z_CM))

    const text = obj.createComponent("Component.Text") as Text
    text.depthTest = true
    text.size = SIZE_LABEL
    text.weight = WEIGHT_LIGHT
    text.horizontalAlignment = HorizontalAlignment.Center
    text.verticalAlignment = VerticalAlignment.Center
    text.horizontalOverflow = HorizontalOverflow.Overflow
    text.verticalOverflow = VerticalOverflow.Overflow
    text.layoutRect = Rect.create(-4, 4, -1, 1)
    const m = this.mineral
    text.textFill.color = new vec4(m.r, m.g, m.b, RELAY_RAIL_LABEL_DIM)
    return text
  }

  /**
   * The two dots are jade and lilac — the only place in the piece where the ownership
   * colours appear without owning anything. They stand for the two people the board is
   * for, which is why the wordmark is the one header element allowed a hue at all.
   */
  private buildWordmark(root: SceneObject): void {
    const x = slotX(0)
    const jade = hexToVec4(RELAY_HEX_YOURS, 1)
    const lilac = hexToVec4(RELAY_HEX_PARTNERS, 1)

    // The cluster is centred on the slot, not hung off its left edge: two dots plus a
    // five-letter word is wider than any other element, and letting it start at the slot
    // line is what made the first gap read wider than the other three.
    this.makeDot(root, "MarkDotYours", x - 3.0, RELAY_HEADER_MARK_DOT_CM, jade, 0.85)
    this.makeDot(
      root,
      "MarkDotPartner",
      x - 3.0 + RELAY_HEADER_MARK_GAP_CM,
      RELAY_HEADER_MARK_DOT_CM,
      lilac,
      0.85
    )

    const word = this.makeText(root, "HeaderWordmark", x + 1.0, 0, SIZE_MARK, RELAY_HEADER_DIM)
    word.text = "relay"
    // Wide tracking, lowercase. Real letterSpacing, not padded spaces — spaces would
    // break any future translation of the wordmark and misalign the centring.
    word.letterSpacing = 0.42
  }

  private buildPresenceDot(root: SceneObject): void {
    const obj = this.makeDot(
      root,
      "HeaderPresence",
      slotX(1),
      RELAY_HEADER_DOT_CM,
      this.mineral,
      RELAY_HEADER_DOT_ALONE
    )
    this.dotObj = obj
  }

  private makeDot(
    root: SceneObject,
    name: string,
    x: number,
    sizeCm: number,
    tint: vec4,
    alpha: number
  ): SceneObject {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(root)
    obj.getTransform().setLocalPosition(new vec3(x, RELAY_HEADER_Y_CM, RELAY_HEADER_Z_CM))

    const plate = obj.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(sizeCm, sizeCm)

    const shape = obj.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    const isPresence = name === "HeaderPresence"

    plate.onInitialized.add(() => {
      const collider = obj.getComponent("Physics.ColliderComponent")
      if (collider) collider.enabled = false
      if (plate.interactable) plate.interactable.enabled = false
      if (isNull(shape)) return

      // Corner radius at half the side turns the rounded rectangle into a circle, which
      // is the only reason this needs no new asset.
      shape.cornerRadius = sizeCm * 0.5
      shape.gradient = false
      shape.border = false
      shape.backgroundColor = new vec4(tint.r, tint.g, tint.b, alpha)

      if (isPresence) {
        this.dotShape = shape
        this.dotReady = true
        this.paintDot(0)
      }
    })

    return obj
  }

  private makeText(
    root: SceneObject,
    name: string,
    x: number,
    dy: number,
    size: number,
    dim: number
  ): Text {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(root)
    obj.getTransform().setLocalPosition(new vec3(x, RELAY_HEADER_Y_CM + dy, RELAY_HEADER_Z_CM))

    const text = obj.createComponent("Component.Text") as Text
    text.depthTest = true
    text.size = size
    text.weight = WEIGHT_LIGHT
    text.horizontalAlignment = HorizontalAlignment.Center
    text.verticalAlignment = VerticalAlignment.Center
    text.horizontalOverflow = HorizontalOverflow.Overflow
    text.verticalOverflow = VerticalOverflow.Overflow
    text.layoutRect = Rect.create(-6, 6, -1.1, 1.1)
    text.textFill.color = new vec4(this.mineral.r, this.mineral.g, this.mineral.b, dim)
    text.text = ""
    return text
  }

  /** Which clock this pane keeps. Guests are offset for the single-machine recording. */
  public setGuestClock(isGuest: boolean): void {
    this.offsetHours = isGuest ? RELAY_TIME_GUEST_OFFSET_HOURS : 0
  }

  /** Is the other person actually in the session? Brightness only — no new hue. */
  public setPartnerPresent(present: boolean): void {
    if (this.partnerPresent === present) return
    this.partnerPresent = present
    this.paintDot(0)
  }

  /** Shown of open. The one number a viewer needs to trust the arc is a subset. */
  public setCounts(shown: number, total: number, live: boolean): void {
    if (this.counterText === null || isNull(this.counterText)) return
    // "local" appears only on fallback data. It is the difference between a real queue
    // and a convincing one, so it must never be silent — but it costs a word, not a slot.
    this.counterText.text = shown + " / " + total + (live ? "" : "  local")
  }

  /**
   * Something crossed the wire. One decaying brightness pulse.
   *
   * Called from the same handlers the cards already use, so this reports real sync
   * traffic and generates none of its own.
   */
  public pulse(nowMs: number): void {
    this.pulseUntilMs = nowMs + RELAY_HEADER_PULSE_MS
  }

  public tick(nowMs: number): void {
    if (this.pulseUntilMs > 0) {
      const left = (this.pulseUntilMs - nowMs) / RELAY_HEADER_PULSE_MS
      if (left <= 0) {
        this.pulseUntilMs = 0
        this.paintDot(0)
      } else {
        // Decay, not a square wave: the dot should read as a flicker of light, not a lamp
        // being switched. Squaring makes the tail quick and the peak brief.
        this.paintDot(left * left)
      }
    }

    this.updateClock()
  }

  private paintDot(pulse: number): void {
    if (!this.dotReady || this.dotShape === null || isNull(this.dotShape)) return
    const base = this.partnerPresent ? RELAY_HEADER_DOT_PRESENT : RELAY_HEADER_DOT_ALONE
    const alpha = Math.min(base + RELAY_HEADER_PULSE_LIFT * pulse, 1)
    const m = this.mineral
    const shape = this.dotShape

    // Brightness AND size. The swell is what makes it impossible to miss.
    if (this.dotObj !== null && !isNull(this.dotObj)) {
      const k = 1 + (RELAY_HEADER_PULSE_SCALE - 1) * pulse
      this.dotObj.getTransform().setLocalScale(new vec3(k, k, k))
    }

    shape.backgroundColor = new vec4(m.r, m.g, m.b, alpha)
    // Alone, the dot is hollow: a thin ring reads as "nobody there" far faster than a
    // dimmer disc does, and it cannot be mistaken for a weak signal.
    if (this.partnerPresent) {
      shape.border = false
    } else {
      shape.border = true
      shape.borderType = "Color"
      shape.borderColor = new vec4(m.r, m.g, m.b, 0.55)
      shape.borderSize = 0.06
      shape.borderSoftness = 0.004
      shape.backgroundColor = new vec4(m.r, m.g, m.b, alpha * 0.35)
    }
  }

  private updateClock(): void {
    if (this.clockText === null || isNull(this.clockText)) return

    const now = new Date(Date.now() + this.offsetHours * 3600000)
    const stamp = pad2(now.getHours()) + ":" + pad2(now.getMinutes())
    // Text writes are not free; the clock only changes once a minute.
    if (stamp === this.lastClock) return
    this.lastClock = stamp
    this.clockText.text = stamp
    print("[Relay] header clock=" + stamp + " offsetHours=" + this.offsetHours)

    if (this.zoneText !== null && !isNull(this.zoneText)) {
      // getTimezoneOffset is minutes BEHIND UTC, so the sign flips for a UTC+N label.
      const localOffsetH = -new Date().getTimezoneOffset() / 60
      const shown = localOffsetH + this.offsetHours
      const sign = shown >= 0 ? "+" : "-"
      const whole = Math.floor(Math.abs(shown))
      const mins = Math.round((Math.abs(shown) - whole) * 60)
      this.zoneText.text = "UTC" + sign + whole + (mins > 0 ? ":" + pad2(mins) : "")
    }
  }
}
