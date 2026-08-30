/**
 * RelayQueueUI — every pixel Relay draws.
 *
 * OWNS:      the card surfaces (UIKit BackPlate + RoundedRectangle edge-lit glass),
 *            the card typography, the ownership colour mapping, and the small
 *            data-source status readout.
 * EXPECTS:   @input cardsRoot and statusRoot — authored SceneObjects that a human can
 *            drag in the Inspector to move the whole deck or the status pill.
 * MUST NOT:  hold domain state, fetch anything, decide anything about the queue, or
 *            know that Sync Kit exists. It is a passive view: state arrives through
 *            setCards()/setStatus(), user intent leaves through onCardPinched.
 *
 * Card material — "a thin sheet of edge-lit glass". Built from UIKit's
 * RoundedRectangle, whose border/fill uniforms express exactly that: the fill sits at
 * RELAY_CARD_FILL_OPACITY (~15%) and the bright border carries the form.
 *
 * Typography — two weights only, per the visual identity: MEDIUM (500) for titles,
 * REGULAR (400) for metadata. No thin weights anywhere; they vanish on a waveguide.
 */

import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {
  FlexAlign,
  FlexDirection,
  FlexJustify
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {InteractionPlane} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractionPlane/InteractionPlane"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

import {
  easeOut,
  easeOutQuint,
  smootherStep,
  hexToVec4,
  RELAY_CLAIM_HOLD_MS,
  RELAY_CLAIM_RISE_CM,
  RELAY_CLAIM_RISE_MS,
  RELAY_CLAIM_SETTLE_MS,
  RELAY_DENIED_ANCHOR_X_CM,
  RELAY_DENIED_ANCHOR_Y_CM,
  RELAY_DENIED_ANCHOR_Z_CM,
  RELAY_DENIED_DROP_Y_CM,
  RELAY_DENIED_FLASH_MS,
  RELAY_HEX_PARTNERS,
  RELAY_DISSOLVE_MS,
  RELAY_DISSOLVE_RISE_CM,
  RELAY_ARRIVE_MS,
  RELAY_ARRIVE_OUT_FACTOR,
  RELAY_LANE_SCALE,
  RELAY_LANG_CHIP_H_CM,
  RELAY_LANG_CHIP_W_CM,
  RELAY_LANG_CHIP_X_CM,
  RELAY_LANG_CHIP_Y_CM,
  RELAY_LANG_CHIP_Z_CM,
  RELAY_LANG_DIM,
  RELAY_LANG_FIRST_GAP_CM,
  RELAY_LANG_ROW_DIR,
  RELAY_LANG_LIST_PITCH_CM,
  RELAY_LANG_LIST_RISE_CM,
  RELAY_LANG_LIST_ROW_H_CM,
  RELAY_LANG_LIST_TOP_CM,
  RELAY_LANG_LIST_W_CM,
  RELAY_LANG_LIST_X_CM,
  RELAY_LANG_LIST_Z_CM,
  RELAY_LANG_PANEL_ALPHA,
  RELAY_LANG_PANEL_PAD_CM,
  RELAY_LANG_ROW_MS,
  RELAY_LANG_STAGGER_MS,
  RELAY_CARD_MAX_BODY_ALPHA,
  RELAY_EDGE_FADE_STRENGTH,
  RELAY_EDGE_FADE_TILT,
  RELAY_ARC_YAW_GAIN,
  RELAY_SLAB_BEHIND_CM,
  RELAY_SLAB_DEPTH_CM,
  RELAY_SLAB_INSET_CM,
  RELAY_SLAB_FACE_OPACITY,
  RELAY_SLAB_EDGE_OPACITY,
  RELAY_SLAB_FROST,
  RELAY_SLAB_INTENSITY,
  RELAY_GLASS_ENV_TINT,
  RELAY_PEEL_MS,
  RELAY_RESOLVE_MS,
  RELAY_PEEL_TILT_DEG,
  RELAY_GLOSS_HALF_WIDTH,
  RELAY_GLOSS_ALPHA_BOOST,
  RELAY_GLOSS_EASE,
  RELAY_AMBIENT_WARM,
  RELAY_AMBIENT_COOL,
  RELAY_AMBIENT_ALPHA,
  RELAY_AMBIENT_W_CM,
  RELAY_AMBIENT_H_CM,
  RELAY_AMBIENT_Y_CM,
  RELAY_AMBIENT_Z_CM,
  RELAY_LANG_OPEN_MS,
  RELAY_LANG_OPEN_X_CM,
  RELAY_LANG_OPEN_Z_CM,
  RELAY_LANG_PARTNER_Y_CM,
  RELAY_LANG_ROW_GAP_CM,
  RELAY_LANG_ROW_H_CM,
  RELAY_PASS_MS,
  RELAY_PASS_THRESHOLD_CM,
  RELAY_PASS_TRAVEL_CM,
  RELAY_REFLOW_MS,
  RELAY_CARD_CORNER_RADIUS_CM,
  RELAY_CARD_HEIGHT_CM,
  RELAY_CARD_WIDTH_CM,
  RELAY_CARD_EDGE_SOFTNESS,
  RELAY_CARD_EDGE_WIDTH_CM,
  RELAY_CARD_FILL_OPACITY,
  scaleRgb
} from "./RelayConfig"
import {CardPlacement, lanePosition} from "./RelayQueueLayout"
import {RelayAudio} from "./RelayAudio"
import {RelayBurst} from "./RelayBurst"
import {bridgePoint, RelayBridge} from "./RelayBridge"
import {RelayHeader} from "./RelayHeader"
import {slabMesh} from "./RelaySlab"
import {
  RELAY_DEFAULT_LANGUAGE,
  RELAY_LANGUAGES,
  RelayLanguage,
  languageByCode
} from "./RelayLanguage"
import {ageSeconds, formatAge, headlineIn, Ownership, ownershipOf, WorkItem} from "./RelayWorkItem"

const ICON_LIVE: Texture = requireAsset("../Icons/cloud_done.png") as Texture
const ICON_OFFLINE: Texture = requireAsset("../Icons/cloud_off.png") as Texture
const IMAGE_MATERIAL: Material = requireAsset("../Materials/ImageMaterial.mat") as Material

/**
 * The card body's material, on our own mesh.
 *
 * Not emissive and not a glow — it describes a SURFACE whose opacity varies with viewing
 * angle, so a face turned toward you stays clear and a face turned edge-on goes dense and
 * frosted. Nothing here reaches into BackPlate or RoundedRectangle.
 */
const SLAB_MATERIAL: Material = requireAsset("../Materials/relay_slab.mat") as Material


// Two weights only. Titles read at MEDIUM; everything else at REGULAR.
const WEIGHT_TITLE = 500
const WEIGHT_META = 400

// Sizes are em-square units calibrated for the 110 cm focal plane.
const SIZE_TITLE = 46
const SIZE_META = 38

// Content offset that keeps text off the plate's front face (no z-fighting).
const CONTENT_Z = 0.6

// Urgency is carried by brightness and size, never by hue.
//
// These are the values at urgency 0; urgency 1 reaches 1.0. They used to be 0.62/0.70,
// a range so narrow that five cards read as five identical cards. Widening the floor is
// what makes the top of the queue obviously the top of the queue on first sight.
const EDGE_DIM = 0.40
const FILL_DIM = 0.42

/** The most urgent card is also the biggest. Size is the fastest "this one" signal there is. */
const URGENCY_SCALE = 0.18

/**
 * How much louder an owned card is than an unclaimed one.
 *
 * Ownership now buys its emphasis almost entirely in the EDGE — full-strength hue and a
 * heavier border — rather than in the body. A fill multiplier of 2.4 was what turned a
 * claimed card into a solid panel; at 1.15 the body stays glass and the border does the
 * talking, which is where colour belongs on a transparent sheet anyway.
 */
const OWNED_EMPHASIS = 1.15
/** The edge, by contrast, is allowed to be emphatic — it costs no transparency. */
const OWNED_EDGE_WIDTH = 1.8

/** Where a card is in its life. Only "arc" views are managed by setCards(). */
type CardState = "arc" | "claiming" | "dissolving" | "lane" | "passing"

interface CardView {
  root: SceneObject
  plate: BackPlate
  shape: RoundedRectangle
  sourceText: Text
  titleText: Text
  ageText: Text
  ready: boolean
  itemId: string
  fill: vec4
  edge: vec4
  titleColor: vec4
  metaColor: vec4

  state: CardState

  /** Position tween — every move eases out, nothing bounces. */
  fromPos: vec3
  toPos: vec3
  tweenStartMs: number
  tweenDurMs: number
  tweening: boolean

  /** Claim choreography: rise, hold, settle. */
  claimPhase: number
  claimLanePos: vec3

  /** Partner-side dissolve. */
  dissolveStartMs: number
  dissolveTint: vec4

  /**
   * Hover highlight. `hoverTarget` is set by a discrete signal — a local hover, or a
   * partner's 10 Hz broadcast. `hoverGain` chases it every frame, which is what turns
   * ten updates a second into continuous motion.
   */
  hoverTarget: number
  hoverGain: number

  /** 0..1 urgency. Drives the breath amplitude — priority 1 sits perfectly still. */
  urgency: number

  /** How far out on the arc this card sits, and which way. Drives the window fade. */
  edgeFade: number
  edgeSide: number

  /** The card's body: a real box behind the face, carrying its thickness. */
  slab: SceneObject
  slabMat: Material

  /**
   * The light this card throws on the ground. Parented to cardsRoot rather than to the
   * card, so it stays lying flat while the card yaws to face the viewer.
   */


  /**
   * Paper physics for the pass.
   *
   * `peel` runs 0 -> 1 as the sheet leaves the sender: it thins toward its TRAILING edge,
   * which is what makes it read as paper lifting rather than a panel being faded out.
   * `resolve` runs 0 -> 1 as it lands on the receiver, the same curve mirrored, so the
   * two panes show one continuous object. `peelDir` is which edge trails.
   */
  peel: number
  peelDir: number
  resolve: number

  /** Where the wet highlight currently sits, 0 (bottom) .. 1 (top). Chases the head. */
  gloss: number
  glossTarget: number

  /**
   * Owned by somebody — either of us. Unclaimed is the RESTING state and should be quiet;
   * a claim is an EVENT and has to be unmistakable across the room. Ownership therefore
   * buys density and edge weight, never a different hue.
   */
  owned: boolean

  /** Yaw that faces the card at the viewer. Hover tilt composes on top of this. */
  baseYaw: number

  /** Last breath multiplier actually pushed to the shader, to avoid restyling per frame. */
  lastBreath: number

  /** The row this card is showing. Kept so a language change can re-render in place. */
  item: WorkItem | null

  /** Age string as last computed, so re-rendering text does not restate the clock. */
  ageLabel: string

  /** Accumulated horizontal drag while a lane card is being pushed. */
  dragX: number

  /** Wall-clock ms until which this card shows the "claimed by partner" flash. */
}

@component
export class RelayQueueUI extends BaseScriptComponent {
  @ui.label('<span style="color: #A3C2D0;">RelayQueueUI — the spatial work queue surface</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Authored SceneObject the card deck is built under. Move it to move the whole queue.")
  cardsRoot!: SceneObject

  @input
  @hint("Authored SceneObject the data-source status pill is built under.")
  statusRoot!: SceneObject
  @ui.group_end
  @ui.separator
  @ui.group_start("Settings")
  // Sourced from RelayConfig so the renderer and RelayQueueLayout cannot disagree about
  // card width — the arc is fitted to this number, and a second copy would silently
  // push the outermost cards past the edge of the usable area.
  @input
  @widget(new SliderWidget(6, 24, 0.5))
  @hint("Width of a queue card, in centimetres. The arc fit is derived from this.")
  cardWidthCm: number = RELAY_CARD_WIDTH_CM

  @input
  @widget(new SliderWidget(6, 18, 0.5))
  @hint("Height of a queue card, in centimetres.")
  cardHeightCm: number = RELAY_CARD_HEIGHT_CM
  @ui.group_end
  @ui.separator
  @ui.group_start("Material")

  @input
  @widget(new SliderWidget(0, 1.5, 0.05))
  @hint("How far the text floats in FRONT of the plate, in cm. This gap is the parallax: move your head and the text slides across the plate behind it.")
  contentDepthCm: number = 0.3

  @input
  @widget(new SliderWidget(1, 4, 0.05))
  @hint("Brightness of the fill at the BOTTOM edge, where light pools in the glass. 1 = flat.")
  gradientPoolGain: number = 2.2

  @input
  @widget(new SliderWidget(0, 1, 0.05))
  @hint("Brightness of the fill at the TOP edge. Lower = steeper pool.")
  gradientTopGain: number = 0.45

  @input
  @widget(new SliderWidget(0, 0.15, 0.005))
  @hint("Edge-brightness swing of a MAXIMUM-urgency card. Priority 1 never breathes; the pulse scales with urgency.")
  breathAmplitude: number = 0.04

  @input
  @widget(new SliderWidget(800, 4000, 100))
  @hint("One full breath, in milliseconds.")
  breathPeriodMs: number = 2000

  @input
  @widget(new SliderWidget(0, 10, 0.5))
  @hint("Degrees the card tilts toward you when a hand approaches.")
  hoverTiltDegrees: number = 3

  @input("vec4", "{0.639, 0.761, 0.816, 1.0}")
  @widget(new ColorWidget())
  @hint("Mineral #A3C2D0 — an unclaimed item. Colour encodes ownership and nothing else.")
  unclaimedColor: vec4 = new vec4(0.639, 0.761, 0.816, 1.0)

  @input("vec4", "{0.435, 0.780, 0.608, 1.0}")
  @widget(new ColorWidget())
  @hint("Jade #6FC79B — an item you have claimed.")
  yoursColor: vec4 = new vec4(0.435, 0.78, 0.608, 1.0)

  @input("vec4", "{0.722, 0.643, 0.941, 1.0}")
  @widget(new ColorWidget())
  @hint("Lilac #B8A4F0 — an item your partner has claimed.")
  partnersColor: vec4 = new vec4(0.722, 0.643, 0.941, 1.0)

  @input("vec4", "{0.400, 0.459, 0.486, 1.0}")
  @widget(new ColorWidget())
  @hint("Graphite #66757C — a completed item. Always rendered at low opacity.")
  doneColor: vec4 = new vec4(0.4, 0.459, 0.486, 1.0)
  @ui.group_end

  /** Keyed by item id, NOT by slot. A claim animates one specific card. */
  private views: {[id: string]: CardView} = {}
  private laneOrder: string[] = []

  /**
   * Last known position of a card that has since been destroyed. The denied banner is
   * held here, so the message survives the card it refers to.
   */
  private lastPos: {[id: string]: vec3} = {}

  private deniedRoot: SceneObject | null = null
  private deniedText: Text | null = null
  private deniedShape: RoundedRectangle | null = null
  private deniedUntilMs = 0

  /** What THIS client reads in. Purely local: it never changes the shared queue. */
  private language: RelayLanguage = languageByCode(RELAY_DEFAULT_LANGUAGE)

  private chipRoot: SceneObject | null = null
  private chipText: Text | null = null
  private chipShape: RoundedRectangle | null = null
  private langRows: {
    root: SceneObject
    label: Text
    shape: RoundedRectangle
    code: string
    /** Final resting y inside the menu. Rows slide down to this and fade in. */
    slotY: number
    /** 0 = fully closed and invisible, 1 = fully open. Drives position AND alpha. */
    openAmt: number
    startMs: number
    delayMs: number
    moving: boolean
    hover: number
    hoverTarget: number
  }[] = []

  private langPanel: SceneObject | null = null
  private langPanelShape: RoundedRectangle | null = null

  /** Queue recedes to this while the language list is open. 1 = normal. */
  private dimGain = 1

  /** Suppresses the arrival chime for the very first paint — those cards did not arrive. */
  private hasPainted = false
  private langExpanded = false
  private partnerLangText: Text | null = null

  /**
   * Retired card views, kept for reuse. Cards are NEVER destroyed.
   *
   * SIK's InteractorCursor caches the interactables it scores each frame. Destroying a
   * card's SceneObject leaves a dangling entry in that cache, and the next frame throws
   * "Exception in HostFunction: Object is null" inside InteractableScoring — every
   * frame, forever, which silently kills targeting for the WHOLE client. Both panes died
   * this way: the claimer destroys cards that fall off the visible set, the partner
   * destroys cards it has finished dissolving. Recycling keeps every SceneObject alive
   * and merely disabled, which SIK handles as a normal state.
   */
  private pool: CardView[] = []

  /** Built lazily alongside the chip, under cardsRoot so spatial emitters share its space. */
  private audio: RelayAudio | null = null
  /** Same lifetime and space as the audio: both are consequences, not state. */
  private burst: RelayBurst | null = null
  /** The pass beam. Purely visual — deleting it would not change how a pass behaves. */
  private bridge: RelayBridge | null = null
  /** Which view is currently riding the beam, and between which two points. */
  private riding: {id: string; from: vec3; to: vec3} | null = null

  /** The viewer. Used only to place the specular band; never to place a card. */
  private headObject: SceneObject | null = null

  /** The status strip. A readout only — it holds no queue state of its own. */
  private header: RelayHeader | null = null
  /**
   * Presence arrives at sync-ready, the header is built on first paint, and the order
   * between them is not ours to choose. Remembering the last value means whichever
   * happens second still ends up correct — the same race the ambient wash hit.
   */
  private partnerPresent = false

  /** Cards mid-peel or mid-resolve, by id, with the ms the transition started. */
  private peeling: {[id: string]: number} = {}
  private resolving: {[id: string]: number} = {}

  private ambientRoot: SceneObject | null = null
  private ambientShape: RoundedRectangle | null = null
  private ambientReady = false

  /**
   * Warm pane or cool pane. Set once by RelayMain from host/guest, because that is the
   * only thing both clients already agree on. Ambient only — never a card colour.
   */
  private warmPane = true

  /**
   * Which way the partner lies, as a signed x direction: +1 means they are to my right.
   *
   * THERE IS NO SHARED LEFT AND RIGHT. Each pane draws its own deck in front of its own
   * viewer, so "left" on one screen is not "left" on the other — which is why the pass
   * used to be correct in one direction and mirrored in the other. The old code took the
   * sender's direction from whichever way the user happened to push (defaulting to +1)
   * and then hardcoded the receiver's entry to its LEFT, so the two ends only agreed by
   * luck.
   *
   * Host/guest is the one spatial fact both clients already agree on, so it becomes the
   * convention: the host treats the partner as being to their right, the guest treats the
   * partner as being to their left. One value then drives both ends —
   *   sending  : the card exits toward  partnerDir  (the edge facing the partner)
   *   receiving: the card enters from   partnerDir  (the edge facing the sender)
   * — and because the two panes hold opposite values, the motion mirrors correctly
   * whichever way the card travels.
   */
  private partnerDir = 1
  private statusText: Text | null = null
  private statusMessage = ""
  private statusLive = false
  private statusIcon: Image | null = null
  private statusBuilt = false

  private _onCardPinched = new Event<string>()
  /** Fires with the item id when a card is pinched. */
  get onCardPinched(): PublicApi<string> {
    return this._onCardPinched.publicApi()
  }

  private _onCardPassed = new Event<string>()
  /** Fires with the item id when a lane card is pushed far enough to count as a pass. */
  get onCardPassed(): PublicApi<string> {
    return this._onCardPassed.publicApi()
  }

  private _onLanguagePicked = new Event<string>()
  /** Fires with a language code when the user picks one from the chip. */
  get onLanguagePicked(): PublicApi<string> {
    return this._onLanguagePicked.publicApi()
  }

  private _onCardHover = new Event<string | null>()
  /** Fires with the item id on hover-enter and null on hover-exit. */
  get onCardHover(): PublicApi<string | null> {
    return this._onCardHover.publicApi()
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  private nowMs(): number {
    return getTime() * 1000
  }

  // -------------------------------------------------------------------------
  // Public API — the main script pushes state in through these.
  // -------------------------------------------------------------------------

  /**
   * Render exactly these placements in the arc.
   *
   * Views are keyed by item id, so a card that survives a reflow keeps its identity and
   * EASES to its new slot rather than being recycled into a different item. Cards in
   * flight (claiming / dissolving / parked in a lane) are owned by their animation and
   * are deliberately untouched here.
   */
  public setCards(placements: CardPlacement[], localConnectionId: string | null): void {
    if (isNull(this.cardsRoot)) {
      print("[RelayQueueUI] cardsRoot is not wired — cannot render cards.")
      return
    }

    this.buildLanguageChip()
    if (this.audio === null && !isNull(this.cardsRoot)) {
      this.audio = new RelayAudio(this.cardsRoot)
      this.audio.build()
    }
    if (this.burst === null && !isNull(this.cardsRoot)) {
      this.burst = new RelayBurst(this.cardsRoot)
      this.burst.build()
    }
    if (this.bridge === null && !isNull(this.cardsRoot)) {
      this.bridge = new RelayBridge(this.cardsRoot)
      this.bridge.build()
    }
    if (this.headObject === null) this.headObject = this.findHead()
    this.buildAmbientWash()
    if (this.header === null && !isNull(this.cardsRoot)) {
      this.header = new RelayHeader(this.cardsRoot, this.unclaimedColor)
      this.header.build()
      this.header.setGuestClock(!this.warmPane)
      this.header.setPartnerPresent(this.partnerPresent)
    }

    const seen: {[id: string]: boolean} = {}

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]
      const id = p.item.id
      seen[id] = true

      let view = this.views[id]
      if (!view) {
        view = this.acquireCardView()
        this.views[id] = view
        // A newly-seen row does not pop into the arc. It comes in from beyond the far
        // plane along its own radial line and settles, with a brightness pulse that
        // decays through the normal hover easing. Arriving is information — something
        // entered the queue — so it earns motion; a mere reflow does not.
        const f = RELAY_ARRIVE_OUT_FACTOR
        view.root
          .getTransform()
          .setLocalPosition(new vec3(p.position.x * f, p.position.y, p.position.z * f))
        view.toPos = p.position
        view.hoverGain = 1
        view.hoverTarget = 0
        this.applyPlacement(view, p, localConnectionId)
        this.moveTo(view, p.position, RELAY_ARRIVE_MS)
        if (this.hasPainted) {
          if (this.audio) this.audio.playArrival()
          if (this.burst) this.burst.arrivalAt(p.position, this.unclaimedColor, this.nowMs())
          // Something reached this pane over the wire. Same event, no extra traffic.
          if (this.header) this.header.pulse(this.nowMs())
        }
        continue
      }
      if (view.state !== "arc") continue

      this.applyPlacement(view, p, localConnectionId)
      this.moveTo(view, p.position, RELAY_REFLOW_MS)
    }

    // Anything still marked "arc" that the layout no longer places has fallen off the
    // visible set (the maxVisibleCards cap). It leaves without ceremony — only a claim
    // gets an animation, because only a claim is a thing a person did.
    const ids = Object.keys(this.views)
    for (let i = 0; i < ids.length; i++) {
      const v = this.views[ids[i]]
      if (v.state === "arc" && !seen[ids[i]]) this.destroyView(ids[i])
    }
    // Everything in the first paint was already in the queue — nothing "arrived".
    this.hasPainted = true
  }

  /**
   * Which atmosphere this pane sits in. Ambient light only — this must never be consulted
   * when choosing a card's colour, or the ownership rule breaks.
   */
  public setPaneWarm(warm: boolean): void {
    // Host: partner on my right. Guest: partner on my left. Set here because host/guest
    // is exactly what this flag already carries.
    this.partnerDir = warm ? 1 : -1
    if (this.warmPane === warm && this.ambientReady) return
    this.warmPane = warm
    if (this.header) this.header.setGuestClock(!warm)
    // The wash may already exist: sync-ready and the first paint race each other, and
    // whichever loses must still end up with the right atmosphere rather than the default.
    this.styleAmbient()
  }

  /** Paint the wash. Safe to call before it exists or before its material does. */
  private styleAmbient(): void {
    if (!this.ambientReady || this.ambientShape === null || isNull(this.ambientShape)) return
    const shape = this.ambientShape
    const tint = hexToVec4(this.warmPane ? RELAY_AMBIENT_WARM : RELAY_AMBIENT_COOL, 1)
    shape.border = false
    shape.cornerRadius = RELAY_AMBIENT_H_CM * 0.5
    // Densest at the horizon line, falling away above — a wash, not a rectangle.
    shape.setBackgroundGradient({
      enabled: true,
      type: "Linear",
      start: new vec2(0.5, 0),
      end: new vec2(0.5, 1),
      stop0: {
        enabled: true,
        percent: 0,
        color: new vec4(tint.r, tint.g, tint.b, RELAY_AMBIENT_ALPHA * 0.35)
      },
      stop1: {
        enabled: true,
        percent: 0.45,
        color: new vec4(tint.r, tint.g, tint.b, RELAY_AMBIENT_ALPHA)
      },
      stop2: {
        enabled: true,
        percent: 0.75,
        color: new vec4(tint.r, tint.g, tint.b, RELAY_AMBIENT_ALPHA * 0.6)
      },
      stop3: {enabled: true, percent: 1, color: new vec4(tint.r, tint.g, tint.b, 0)}
    })
  }

  /**
   * The queue's own sentence. During normal operation the header's counter says this in
   * three glyphs, so the pill stays hidden — see setQueueCounts. It survives for the ONE
   * case a counter cannot express: an empty queue, where "0 / 0" is technically true and
   * humanly useless. It is also the object LEAF reads, so its name and text are a
   * contract, not a detail.
   */
  public setStatus(message: string, live: boolean): void {
    this.statusLive = live
    // Built lazily rather than in OnStartEvent: a BackPlate created *inside* the
    // OnStart dispatch misses its own initialize(), so the pill silently never drew.
    if (!this.statusBuilt) this.buildStatusPill()
    if (this.statusText) this.statusText.text = message
    if (this.statusIcon) {
      const mat = IMAGE_MATERIAL.clone()
      mat.mainPass.baseTex = live ? ICON_LIVE : ICON_OFFLINE
      mat.mainPass.depthTest = true
      mat.mainPass.depthWrite = false
      this.statusIcon.clearMaterials()
      this.statusIcon.addMaterial(mat)
    }
  }

  /**
   * Shown of open, straight from the layout. The header renders it; nobody stores it.
   *
   * This also decides whether the pill is on screen at all: with work in the queue the
   * counter has already said everything the sentence would, and two readouts of the same
   * fact is exactly the clutter the band is supposed to avoid.
   */
  public setQueueCounts(shown: number, total: number): void {
    if (this.header) this.header.setCounts(shown, total, this.statusLive)
    if (!isNull(this.statusRoot)) this.statusRoot.enabled = total === 0
  }

  /** The partner is in the session, or is not. Drives the presence dot only. */
  public setPartnerPresent(present: boolean): void {
    this.partnerPresent = present
    if (this.header) this.header.setPartnerPresent(present)
  }

  /** Something crossed the wire. One decaying pulse on the presence dot. */
  public pulseSync(): void {
    if (this.header) this.header.pulse(this.nowMs())
  }

  // -------------------------------------------------------------------------
  // Claiming, hover and conflict — the visible half of the hero mechanic
  // -------------------------------------------------------------------------

  /**
   * The LOCAL user took this card: lift it out of the arc and settle it into the lane.
   * Rise, brief hold, settle — an object with weight, never a bounce.
   */
  public claimToLane(itemId: string, jade: vec4): void {
    const view = this.views[itemId]
    if (!view || view.state !== "arc") return
    view.state = "claiming"
    view.claimPhase = 0
    view.hoverTarget = 0

    this.laneOrder.push(itemId)
    this.retintAll(view, jade)
    if (this.audio) this.audio.playClaim()
    if (this.burst) {
      this.burst.claimAt(view.root.getTransform().getLocalPosition(), jade, this.nowMs())
    }
    if (this.header) this.header.pulse(this.nowMs())

    // A lane card stays grabbable — pushing it sideways is how you pass it to the other
    // person. It is deliberately NOT re-armed for the tap path: onTriggerEnd ignores any
    // state other than "arc"/"dissolving", so a lane card can be dragged but never
    // re-claimed, and the drag handlers below ignore everything that is not "lane".
    view.dragX = 0

    const here = view.root.getTransform().getLocalPosition()
    this.moveTo(view, new vec3(here.x, here.y + RELAY_CLAIM_RISE_CM, here.z), RELAY_CLAIM_RISE_MS)
    this.relayoutLane()
  }

  /**
   * YOU handed this card to the other person: it turns their colour and travels off your
   * side. The card is theirs the moment the host says so, so it stops being jade before
   * it leaves — the colour change IS the handover, the travel is only the telling.
   */
  public passAway(itemId: string, partnerColor: vec4): void {
    const view = this.views[itemId]
    if (!view || view.state === "passing") return

    const here = view.root.getTransform().getLocalPosition()
    // NOT the push direction. Which way you shoved the card is how you START a pass, not
    // where your partner is standing — using it meant the card could leave toward empty
    // space while arriving on the other pane from the opposite side.
    const dir = this.partnerDir

    view.state = "passing"
    view.hoverTarget = 0
    this.retintAll(view, partnerColor)

    const at = this.laneOrder.indexOf(itemId)
    if (at >= 0) this.laneOrder.splice(at, 1)
    this.relayoutLane()

    const landing = new vec3(here.x + dir * RELAY_PASS_TRAVEL_CM, here.y, here.z)
    const now = this.nowMs()

    // The sheet lifts as it goes. Small: it is being carried, not thrown.
    const lifted = new vec3(landing.x, landing.y + RELAY_CLAIM_RISE_CM * 0.45, landing.z)

    // Peel: thins toward the trailing edge, which is the edge AWAY from travel.
    view.peelDir = dir > 0 ? -1 : 1
    view.peel = 0
    this.peeling[itemId] = now

    // Sound at the LANDING, not the departure: the rise should travel the way the work did.
    if (this.audio) this.audio.startPassTravel(here, lifted, RELAY_PASS_MS, now)
    if (this.header) this.header.pulse(now)
    if (this.bridge) {
      this.bridge.spring(here, lifted, this.yoursColor, this.partnersColor, RELAY_PASS_MS, now)
      this.riding = {id: itemId, from: here, to: lifted}
    }
    if (this.burst) {
      // Jade wake immediately behind the sheet, then the jade -> lilac crossing trail.
      this.burst.wake(here, lifted, this.yoursColor, now)
      this.burst.passTrail(here, lifted, this.yoursColor, this.partnersColor, now)
    }
    this.moveTo(view, lifted, RELAY_PASS_MS)
  }

  /**
   * The other person handed you this card. It arrives from their side and settles into
   * YOUR lane in jade. The receiver has never rendered this card — it lived in the
   * sender's lane, which is not part of the shared arc — so the view is built here
   * rather than by setCards().
   */
  public receiveToLane(item: WorkItem, yoursColor: vec4, nowMs: number): void {
    let view = this.views[item.id]
    if (!view) {
      view = this.acquireCardView()
      this.views[item.id] = view
    }
    view.itemId = item.id
    view.state = "lane"
    view.hoverTarget = 0
    view.hoverGain = 0

    this.applyItemText(view, item, formatAge(ageSeconds(item, nowMs)))
    this.retintAll(view, yoursColor)
    view.titleColor = new vec4(1, 1, 1, 0.86)
    view.titleText.textFill.color = view.titleColor

    if (this.laneOrder.indexOf(item.id) < 0) this.laneOrder.push(item.id)
    this.relayoutLane()

    const slot = view.claimLanePos
    const s = RELAY_LANE_SCALE
    view.root.getTransform().setLocalScale(new vec3(s, s, s))

    // It does not appear — it RESOLVES. Starts transparent and tilted, the exact mirror
    // of the peel the sender just showed, so the two panes describe one crossing.
    view.resolve = 0
    view.peel = 0
    view.peelDir = 1
    // NOT `nowMs`. That parameter is EPOCH time, used for the age label; every animation
    // clock in this file is getTime()*1000, milliseconds since the lens started. Mixing
    // them makes the elapsed term about 1.8e12 ms negative, so the card pins at resolve 0
    // and never becomes visible again — a passed card would arrive and stay invisible.
    const animNow = this.nowMs()
    this.resolving[item.id] = animNow
    this.applyFacing(view)

    // A soft lilac bloom greets it where it lands.
    if (this.burst) this.burst.bloomAt(slot, this.partnersColor, animNow)

    // The same connection, seen from this side: it comes IN from off toward the lane, so
    // both people watch one bridge between them rather than two unrelated effects.
    // Enters from the edge that faces the sender — the mirror of the exit they just saw.
    const entry = new vec3(
      slot.x + this.partnerDir * RELAY_PASS_TRAVEL_CM,
      slot.y + RELAY_CLAIM_RISE_CM * 0.45,
      slot.z
    )
    if (this.bridge) {
      this.bridge.spring(entry, slot, this.yoursColor, this.partnersColor, RELAY_PASS_MS, animNow)
      this.riding = {id: item.id, from: entry, to: slot}
    }
    if (this.header) this.header.pulse(animNow)

    view.root
      .getTransform()
      .setLocalPosition(entry)
    this.moveTo(view, slot, RELAY_PASS_MS)
  }

  /**
   * The PARTNER took this card: it dissolves upward, tinted with THEIR colour, and is
   * gone. The vanish is the message — the tint is what says who took it.
   */
  public dissolveForPartner(itemId: string, claimerColor: vec4): void {
    const view = this.views[itemId]
    if (!view || view.state === "dissolving") return
    view.state = "dissolving"
    view.dissolveStartMs = this.nowMs()
    view.dissolveTint = claimerColor
    view.hoverTarget = 0
    view.fromPos = view.root.getTransform().getLocalPosition()
    // Played FROM the card, not from the head: you hear which one your partner took.
    if (this.audio) this.audio.playDissolveAt(view.fromPos)
    if (this.burst) this.burst.dissolveAt(view.fromPos, claimerColor, this.nowMs())
    if (this.header) this.header.pulse(this.nowMs())
    this.retintAll(view, claimerColor)
  }

  /**
   * Highlight driven by a discrete signal — a local hover, or a partner's 10 Hz
   * broadcast. Only the target is set here; tick() eases the actual brightness, which
   * is what makes ten updates a second look continuous.
   */
  public setHoverHighlight(itemId: string | null, on: boolean): void {
    if (itemId === null) {
      const ids = Object.keys(this.views)
      for (let i = 0; i < ids.length; i++) this.views[ids[i]].hoverTarget = 0
      return
    }
    const view = this.views[itemId]
    if (view && view.state === "arc") view.hoverTarget = on ? 1 : 0
  }

  /**
   * The loser of a race sees this. Never hidden — it is the proof the sync is real.
   *
   * The message CANNOT live on the card: by the time a denial returns over the wire the
   * partner's copy has finished its dissolve and been destroyed, so writing into that
   * view wrote into nothing. The banner is a separate object held at the card's last
   * position — the spot the hand was reaching for — and it outlives the card entirely.
   */
  public flashDenied(itemId: string, message: string): void {
    if (this.deniedRoot === null) this.buildDeniedBanner()
    if (this.deniedRoot === null || this.deniedText === null) return

    let where = this.lastPos[itemId]
    const live = this.views[itemId]
    if (live) where = live.root.getTransform().getLocalPosition()
    if (!where) {
      where = new vec3(RELAY_DENIED_ANCHOR_X_CM, RELAY_DENIED_ANCHOR_Y_CM, RELAY_DENIED_ANCHOR_Z_CM)
    }

    // Keep the direction of the reached-for slot, but never its height: dropping below
    // the lowest possible arc card is what guarantees the message cannot cover a live one.
    const at = new vec3(where.x, RELAY_DENIED_DROP_Y_CM, where.z)
    this.deniedRoot.getTransform().setLocalPosition(at)
    this.deniedRoot.getTransform().setLocalRotation(quat.angleAxis(Math.atan2(-at.x, -at.z), vec3.up()))
    this.deniedText.text = message
    this.deniedRoot.enabled = true
    this.deniedUntilMs = this.nowMs() + RELAY_DENIED_FLASH_MS
    if (this.audio) this.audio.playDenied()
  }

  /** Lilac, because the message is about what the PARTNER did. Hue still means ownership. */
  private buildDeniedBanner(): void {
    if (isNull(this.cardsRoot)) return

    const root = global.scene.createSceneObject("RelayDeniedBanner")
    root.setParent(this.cardsRoot)

    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(this.cardWidthCm, 3.4)

    const shape = root.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle

    const content = global.scene.createSceneObject("DeniedContent")
    content.setParent(root)
    content.getTransform().setLocalPosition(new vec3(0, 0, CONTENT_Z))

    const label = content.createComponent("Component.Text") as Text
    label.depthTest = true
    label.size = SIZE_META
    label.weight = WEIGHT_TITLE
    label.horizontalAlignment = HorizontalAlignment.Center
    label.verticalAlignment = VerticalAlignment.Center
    label.horizontalOverflow = HorizontalOverflow.Wrap
    label.layoutRect = Rect.create(-this.cardWidthCm / 2 + 0.4, this.cardWidthCm / 2 - 0.4, -1.6, 1.6)

    const lilac = hexToVec4(RELAY_HEX_PARTNERS, 1)
    label.textFill.color = new vec4(1, 1, 1, 0.92)

    this.deniedRoot = root
    this.deniedText = label
    this.deniedShape = shape
    root.enabled = false

    plate.onInitialized.add(() => {
      // The banner is a message, never a target.
      const collider = root.getComponent("Physics.ColliderComponent")
      if (collider) collider.enabled = false
      if (plate.interactable) plate.interactable.enabled = false

      if (!isNull(shape)) {
        shape.gradient = false
        shape.cornerRadius = RELAY_CARD_CORNER_RADIUS_CM
        shape.backgroundColor = new vec4(lilac.r, lilac.g, lilac.b, RELAY_CARD_FILL_OPACITY)
        shape.border = true
        shape.borderType = "Color"
        shape.borderColor = lilac
        shape.borderSize = RELAY_CARD_EDGE_WIDTH_CM
        shape.borderSoftness = RELAY_CARD_EDGE_SOFTNESS
      }
    })
  }

  public isKnown(itemId: string): boolean {
    return !!this.views[itemId]
  }

  // -------------------------------------------------------------------------
  // Tweening
  // -------------------------------------------------------------------------

  private moveTo(view: CardView, target: vec3, durationMs: number): void {
    const here = view.root.getTransform().getLocalPosition()
    if (
      Math.abs(here.x - target.x) < 0.01 &&
      Math.abs(here.y - target.y) < 0.01 &&
      Math.abs(here.z - target.z) < 0.01
    ) {
      view.tweening = false
      view.toPos = target
      return
    }
    view.fromPos = here
    view.toPos = target
    view.tweenStartMs = this.nowMs()
    view.tweenDurMs = durationMs
    view.tweening = true
  }

  private relayoutLane(): void {
    for (let i = 0; i < this.laneOrder.length; i++) {
      const v = this.views[this.laneOrder[i]]
      if (!v) continue
      v.claimLanePos = lanePosition(i, this.laneOrder.length)
      if (v.state === "lane") this.moveTo(v, v.claimLanePos, RELAY_REFLOW_MS)
    }
  }

  /** One frame of every in-flight animation. */
  private tick(): void {
    const now = this.nowMs()

    if (this.deniedUntilMs > 0 && now > this.deniedUntilMs) {
      this.deniedUntilMs = 0
      if (this.deniedRoot !== null) this.deniedRoot.enabled = false
    }

    this.tickLangRows(now)
    if (this.burst) this.burst.tick(now)
    if (this.audio) this.audio.tick(now)
    if (this.bridge) this.bridge.tick(now)
    if (this.header) this.header.tick(now)
    this.tickPaper(now)

    const ids = Object.keys(this.views)

    for (let i = 0; i < ids.length; i++) {
      const view = this.views[ids[i]]

      if (view.tweening) {
        const t = (now - view.tweenStartMs) / view.tweenDurMs
        const k = easeOut(t)
        const p = new vec3(
          view.fromPos.x + (view.toPos.x - view.fromPos.x) * k,
          view.fromPos.y + (view.toPos.y - view.fromPos.y) * k,
          view.fromPos.z + (view.toPos.z - view.fromPos.z) * k
        )
        // A passing card is drawn ON the beam. The tween still owns timing and the end
        // point — this only bends where the sheet is rendered between them, so pass logic,
        // ownership and targeting are all untouched by the flourish.
        if (this.riding !== null && this.riding.id === ids[i] && this.bridge !== null) {
          const r = this.riding
          view.root.getTransform().setLocalPosition(bridgePoint(r.from, r.to, k, this.bridge.bow()))
        } else {
          view.root.getTransform().setLocalPosition(p)
        }
        if (t >= 1) {
          view.tweening = false
          if (this.riding !== null && this.riding.id === ids[i]) this.riding = null
        }
      }

      if (view.state === "passing" && !view.tweening) {
        this.destroyView(ids[i])
        continue
      }
      if (view.state === "claiming" && !view.tweening) this.advanceClaim(view, now)
      if (view.state === "dissolving") this.advanceDissolve(view, ids[i], now)

      // Hover chases its target rather than snapping — this is the receive-side
      // interpolation that hides the 10 Hz quantisation of the partner's signal.
      if (Math.abs(view.hoverGain - view.hoverTarget) > 0.001) {
        const rate = getDeltaTime() / 0.15
        const d = view.hoverTarget - view.hoverGain
        const step = d > 0 ? Math.min(d, rate) : Math.max(d, -rate)
        view.hoverGain = view.hoverGain + step
        this.applyFacing(view)
        this.applyStyle(view)
      }


      // The wet band drifts toward where the head is. Restyle only on a meaningful move,
      // for the same reason the breath does — this runs every frame on every card.
      if (view.state === "arc" || view.state === "lane") {
        this.updateGloss(view)
        const d = view.glossTarget - view.gloss
        if (Math.abs(d) > 0.0015) {
          view.gloss = view.gloss + d * RELAY_GLOSS_EASE
          this.applyStyle(view)
        }
      }

      // Urgency breathes. Amplitude scales with urgency, so the top card pulses and the
      // bottom one is perfectly still — you feel the difference before you read either.
      // Brightness only: adding a hue here would break what colour means.
      if (view.state === "arc" && view.urgency > 0.05 && this.breathAmplitude > 0) {
        const phase = (now / this.breathPeriodMs) * Math.PI * 2
        const target = 1 + this.breathAmplitude * view.urgency * Math.sin(phase)
        // Restyle only on a meaningful change — this runs every frame on every card.
        if (Math.abs(target - view.lastBreath) > 0.002) {
          view.lastBreath = target
          this.applyStyle(view)
        }
      } else if (view.lastBreath !== 1) {
        view.lastBreath = 1
        this.applyStyle(view)
      }
    }
  }

  /** rise (done) -> hold -> settle into the lane. */
  private advanceClaim(view: CardView, now: number): void {
    if (view.claimPhase === 0) {
      view.claimPhase = 1
      view.tweenStartMs = now // reuse as the hold clock
      return
    }
    if (view.claimPhase === 1) {
      if (now - view.tweenStartMs < RELAY_CLAIM_HOLD_MS) return
      view.claimPhase = 2
      this.moveTo(view, view.claimLanePos, RELAY_CLAIM_SETTLE_MS)
      const s = RELAY_LANE_SCALE
      view.root.getTransform().setLocalScale(new vec3(s, s, s))
      return
    }
    view.state = "lane"
  }

  private advanceDissolve(view: CardView, id: string, now: number): void {
    const t = (now - view.dissolveStartMs) / RELAY_DISSOLVE_MS
    const k = easeOut(t > 1 ? 1 : t)
    const p = view.fromPos
    view.root
      .getTransform()
      .setLocalPosition(new vec3(p.x, p.y + RELAY_DISSOLVE_RISE_CM * k, p.z))

    const fade = 1 - k
    const tint = view.dissolveTint
    view.edge = new vec4(tint.r, tint.g, tint.b, fade)
    view.fill = new vec4(tint.r, tint.g, tint.b, RELAY_CARD_FILL_OPACITY * fade)
    view.titleText.textFill.color = new vec4(1, 1, 1, 0.86 * fade)
    view.sourceText.textFill.color = new vec4(tint.r, tint.g, tint.b, 0.65 * fade)
    view.ageText.textFill.color = new vec4(tint.r, tint.g, tint.b, 0.65 * fade)
    this.applyStyle(view)

    if (t >= 1) this.destroyView(id)
  }

  private retintAll(view: CardView, base: vec4): void {
    // Every caller of this is an ownership event: claim, pass, receive or dissolve.
    view.owned = true
    view.edge = new vec4(base.r, base.g, base.b, 1)
    view.fill = new vec4(base.r, base.g, base.b, RELAY_CARD_FILL_OPACITY)
    view.sourceText.textFill.color = new vec4(base.r, base.g, base.b, 0.65)
    view.ageText.textFill.color = new vec4(base.r, base.g, base.b, 0.65)
    this.applyStyle(view)
  }

  /**
   * Belt and braces for the InteractionPlane suppression above: if the plate built the
   * plane anyway (its own init order is not ours to rely on), disable the component and
   * its collider-root child so nothing un-triggerable sits between a hand and the card.
   */
  private suppressInteractionPlane(root: SceneObject): void {
    const plane = root.getComponent(InteractionPlane.getTypeName())
    if (plane) plane.enabled = false
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i)
      if (child.name === "InteractionPlaneColliderRoot") child.enabled = false
    }
  }

  /** Make a card inert to targeting: no collider, no interactable, no hover. */
  private disableTargeting(view: CardView): void {
    this.setTargeting(view, false)
    view.hoverTarget = 0
    view.hoverGain = 0
  }

  private setTargeting(view: CardView, on: boolean): void {
    const collider = view.root.getComponent("Physics.ColliderComponent")
    if (collider) collider.enabled = on
    const plainCollider = view.root.getComponent("ColliderComponent")
    if (plainCollider) plainCollider.enabled = on
    if (view.plate && view.plate.interactable) view.plate.interactable.enabled = on
  }

  /** Retire a card: remember where it was, make it inert, scrub it, park it in the pool. */
  private destroyView(id: string): void {
    const view = this.views[id]
    if (!view) return
    // Captured BEFORE the scrub: the denied banner needs the spot the hand reached for.
    this.lastPos[id] = view.root.getTransform().getLocalPosition()

    this.disableTargeting(view)
    view.root.enabled = false
    this.scrubView(view)

    delete this.views[id]
    const at = this.laneOrder.indexOf(id)
    if (at >= 0) this.laneOrder.splice(at, 1)
    this.pool.push(view)
  }

  /**
   * Return a view to factory condition.
   *
   * A pooled view is a recycled SceneObject, not a fresh one, and every field left on it
   * is a lie the next item inherits: the previous headline showing through, a jade tint
   * on an unclaimed card, a half-finished dissolve, a rotation from a hover that ended
   * two items ago. Scrubbing on RELEASE rather than on acquire means a view sitting in
   * the pool is already inert — nothing can render stale content even for one frame.
   *
   * Everything here is view state; nothing touches the material except the final restyle,
   * which is guarded by `ready` like every other write.
   */
  private scrubView(view: CardView): void {
    view.itemId = ""
    view.item = null
    view.ageLabel = ""

    view.state = "arc"
    view.tweening = false
    view.tweenStartMs = 0
    view.tweenDurMs = 0
    view.fromPos = vec3.zero()
    view.toPos = vec3.zero()

    view.claimPhase = 0
    view.claimLanePos = vec3.zero()
    view.dissolveStartMs = 0
    view.dissolveTint = new vec4(1, 1, 1, 1)

    view.hoverTarget = 0
    view.hoverGain = 0
    view.urgency = 0
    view.edgeFade = 0
    view.edgeSide = 1
    view.peel = 0
    view.peelDir = 1
    view.resolve = 1
    view.gloss = 0.5
    view.glossTarget = 0.5
    view.owned = false
    view.baseYaw = 0
    view.lastBreath = 1
    view.dragX = 0

    // Transform back to identity. Position is not restored here on purpose — the view is
    // disabled, and setCards positions it before re-enabling it.
    const t = view.root.getTransform()
    t.setLocalScale(vec3.one())
    t.setLocalRotation(quat.quatIdentity())

    // No text carries over.
    view.sourceText.text = ""
    view.titleText.text = ""
    view.ageText.text = ""

    // Unclaimed is mineral. A recycled view must never arrive still wearing someone's hue.
    const mineral = this.unclaimedColor
    view.edge = new vec4(mineral.r, mineral.g, mineral.b, 1)
    view.fill = new vec4(mineral.r, mineral.g, mineral.b, RELAY_CARD_FILL_OPACITY)
    view.titleColor = new vec4(1, 1, 1, 0.72)
    view.metaColor = new vec4(mineral.r, mineral.g, mineral.b, 0.65)
    view.sourceText.textFill.color = view.metaColor
    view.titleText.textFill.color = view.titleColor
    view.ageText.textFill.color = view.metaColor

    this.applyStyle(view)
  }

  // -------------------------------------------------------------------------
  // Card construction
  // -------------------------------------------------------------------------

  /** Reuse a retired view when one is available; only build when the pool is empty. */
  private acquireCardView(): CardView {
    const recycled = this.pool.pop()
    if (recycled) {
      // Already scrubbed on release, so there is nothing to clear here. Scrubbing again
      // would only risk the two paths drifting apart — one place owns "empty view".
      recycled.root.enabled = true
      this.setTargeting(recycled, true)
      return recycled
    }
    return this.createCardView()
  }

  private createCardView(): CardView {
    const root = global.scene.createSceneObject("RelayCard")
    root.setParent(this.cardsRoot)

    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate

    // BackPlate ships with an InteractionPlane: a near-field targeting aid that builds
    // its own child SceneObject, "InteractionPlaneColliderRoot", carrying a box collider
    // nearFieldExitDepth*2 (~34 cm) deep and centred on the card. That slab reaches ~17 cm
    // toward the viewer, sits IN FRONT of the plate, and holds no Interactable — so a ray
    // aimed at the card hits a collider that cannot be triggered. Hover still resolved
    // (SIK targets through the plane) which is why the wiring looked correct while
    // TRIGGER-START never fired.
    //
    // SIK's own working buttons (RectangleButton) carry Interactable + collider on ONE
    // node with no interaction plane. Match that: turn the plane off before the plate
    // initializes, so the child collider is never built.
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false

    plate.style = "simple"
    plate.size = new vec2(this.cardWidthCm, this.cardHeightCm)

    const shape = root.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle

    // THE BODY. A child of the card, so it inherits the yaw and the hover tilt — the
    // thickness has to turn with the card or the illusion collapses on the first frame.
    const slabObj = global.scene.createSceneObject("RelayCardSlab")
    slabObj.setParent(root)
    slabObj
      .getTransform()
      .setLocalPosition(new vec3(0, 0, -RELAY_SLAB_BEHIND_CM - RELAY_SLAB_DEPTH_CM / 2))
    slabObj
      .getTransform()
      .setLocalScale(
        new vec3(
          this.cardWidthCm + RELAY_SLAB_INSET_CM,
          this.cardHeightCm + RELAY_SLAB_INSET_CM,
          RELAY_SLAB_DEPTH_CM
        )
      )

    const slabVisual = slabObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    slabVisual.mesh = slabMesh()
    const slabMat = SLAB_MATERIAL.clone()
    slabVisual.clearMaterials()
    slabVisual.addMaterial(slabMat)

    const content = global.scene.createSceneObject("Content")
    content.setParent(root)
    // The parallax gap. Text is a separate object floating in front of the plate, so
    // head movement slides one against the other for free — no shader, just geometry.
    content.getTransform().setLocalPosition(new vec3(0, 0, this.contentDepthCm))

    const innerW = this.cardWidthCm - 2.0
    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    // Children are registered explicitly via addItems() below, which UIKit forbids
    // while auto-discovery is armed and the layout has not yet initialized.
    flex.autoDiscoverItemsOnStart = false
    flex.width = this.cardWidthCm
    flex.height = this.cardHeightCm
    flex.direction = FlexDirection.Column
    flex.justifyContent = FlexJustify.Center
    flex.alignItems = FlexAlign.Start
    flex.rowGap = 0.4
    flex.paddingLeft = 1.0
    flex.paddingRight = 1.0
    flex.paddingTop = 0.9
    flex.paddingBottom = 0.9

    const items: FlexItem[] = []
    const sourceText = this.addRow(content, flex, items, innerW, 1.5, SIZE_META, WEIGHT_META, false, false)
    const titleText = this.addRow(content, flex, items, innerW, 3.4, SIZE_TITLE, WEIGHT_TITLE, true, true)
    const ageText = this.addRow(content, flex, items, innerW, 1.3, SIZE_META, WEIGHT_META, false, false)
    flex.addItems(items)

    const view: CardView = {
      root: root,
      plate: plate,
      shape: shape,
      sourceText: sourceText,
      titleText: titleText,
      ageText: ageText,
      ready: false,
      itemId: "",
      fill: new vec4(1, 1, 1, RELAY_CARD_FILL_OPACITY),
      edge: new vec4(1, 1, 1, 1),
      titleColor: new vec4(1, 1, 1, 1),
      metaColor: new vec4(1, 1, 1, 0.6),
      state: "arc",
      fromPos: vec3.zero(),
      toPos: vec3.zero(),
      tweenStartMs: 0,
      tweenDurMs: 0,
      tweening: false,
      claimPhase: 0,
      claimLanePos: vec3.zero(),
      dissolveStartMs: 0,
      dissolveTint: new vec4(1, 1, 1, 1),
      hoverTarget: 0,
      hoverGain: 0,
      urgency: 0,
      edgeFade: 0,
      edgeSide: 1,
      slab: slabObj,
      slabMat: slabMat,
      peel: 0,
      peelDir: 1,
      resolve: 1,
      gloss: 0.5,
      glossTarget: 0.5,
      owned: false,
      baseYaw: 0,
      lastBreath: 1,
      item: null,
      ageLabel: "",
      dragX: 0
    }

    plate.onInitialized.add(() => {
      view.ready = true
      this.suppressInteractionPlane(root)
      this.applyStyle(view)
      plate.interactable.onTriggerEnd.add(() => {
        // "arc" is a live card; "dissolving" is one the partner has just taken but which
        // is still on screen. Reaching for either is a real action — the second must
        // produce the denied feedback rather than silently doing nothing.
        if (view.itemId !== "" && (view.state === "arc" || view.state === "dissolving")) {
          this._onCardPinched.invoke(view.itemId)
        }
      })
      // Hover is INTENT, not action: it is broadcast so the partner sees a hand
      // approaching before a claim happens, which is the whole point of the signal.
      plate.interactable.onHoverEnter.add(() => {
        if (view.itemId !== "" && view.state === "arc") {
          view.hoverTarget = 1
          this._onCardHover.invoke(view.itemId)
        }
      })
      plate.interactable.onHoverExit.add(() => {
        view.hoverTarget = 0
        this._onCardHover.invoke(null)
      })

      // --- direct pass: grab a card in YOUR lane and push it across ---------
      plate.interactable.onDragStart.add(() => {
        if (view.state !== "lane") return
        view.dragX = 0
        view.tweening = false
      })
      plate.interactable.onDragUpdate.add((e) => {
        if (view.state !== "lane") return
        const d = e.dragVector
        if (!d) return
        view.dragX += d.x
        // Follow the hand so the push reads as physical, not as a menu selection.
        const p = view.root.getTransform().getLocalPosition()
        view.root.getTransform().setLocalPosition(new vec3(p.x + d.x, p.y, p.z))
      })
      plate.interactable.onDragEnd.add(() => {
        if (view.state !== "lane") return
        const pushed = view.dragX
        view.dragX = 0
        if (Math.abs(pushed) >= RELAY_PASS_THRESHOLD_CM) {
          this._onCardPassed.invoke(view.itemId)
        } else {
          // Not far enough to mean anything — ease back into the slot.
          this.moveTo(view, view.claimLanePos, RELAY_REFLOW_MS)
        }
      })
    })

    return view
  }

  /**
   * One text row inside the card's flex column. The rect is sized to the real content
   * box so wrapping is deterministic — the layout still owns vertical placement.
   */
  private addRow(
    parent: SceneObject,
    flex: FlexLayout,
    items: FlexItem[],
    widthCm: number,
    heightCm: number,
    size: number,
    weight: number,
    wrap: boolean,
    scrim: boolean
  ): Text {
    const rowObj = global.scene.createSceneObject("Row")
    rowObj.setParent(parent)

    const text = rowObj.createComponent("Component.Text") as Text
    text.depthTest = true
    text.size = size
    text.weight = weight
    text.horizontalAlignment = HorizontalAlignment.Left
    text.verticalAlignment = VerticalAlignment.Center
    // Wrapping titles shrink to fit rather than overflow — never truncate a title.
    text.horizontalOverflow = wrap ? HorizontalOverflow.Wrap : HorizontalOverflow.Overflow
    text.verticalOverflow = wrap ? VerticalOverflow.Shrink : VerticalOverflow.Overflow
    text.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -heightCm / 2, heightCm / 2)
    text.text = ""

    // READABILITY FIRST.
    //
    // With the body down at glass opacity the scene shows through the card, which is the
    // point — but it also means a bright building or a lamp can sit directly behind the
    // headline. A scrim on the TEXT ONLY buys the contrast back without putting density
    // back into the sheet: it hugs the glyphs, so the card stays transparent everywhere
    // the words are not. The meta rows are short, dim and expendable; only the headline
    // has to survive any background, so only the headline pays for one.
    if (scrim) {
      const bg = text.backgroundSettings
      bg.enabled = true
      bg.fill.color = new vec4(0.04, 0.06, 0.07, 0.5)
      bg.margins = Rect.create(-0.34, -0.34, -0.18, -0.18)
      bg.cornerRadius = 0.28
    }

    const item = rowObj.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideWidth = widthCm
    item.overrideHeight = heightCm
    items.push(item)

    return text
  }

  // -------------------------------------------------------------------------
  // Styling — ownership drives hue, urgency drives brightness.
  // -------------------------------------------------------------------------

  private colorFor(ownership: Ownership): vec4 {
    if (ownership === "yours") return this.yoursColor
    if (ownership === "partners") return this.partnersColor
    if (ownership === "done") return this.doneColor
    return this.unclaimedColor
  }

  private applyPlacement(view: CardView, placement: CardPlacement, localConnectionId: string | null): void {
    const item = placement.item
    view.itemId = item.id

    // Position is owned by moveTo(); facing is composed with the hover tilt in tick().
    // Amplified so the rack visibly curves around the viewer. Yaw only — position is
    // still exactly what the arc maths produced.
    view.baseYaw = placement.yawRadians * RELAY_ARC_YAW_GAIN
    view.urgency = placement.urgency
    view.edgeFade = placement.edgeFade
    view.edgeSide = placement.edgeSide
    this.applyFacing(view)

    // Arc cards only: a claimed card is already scaled by the lane, and rescaling it
    // mid-flight would fight the claim choreography.
    if (view.state === "arc") {
      const k = 1 + URGENCY_SCALE * placement.urgency
      view.root.getTransform().setLocalScale(new vec3(k, k, k))
    }

    const ownership = ownershipOf(item, localConnectionId)
    const base = this.colorFor(ownership)
    const isDone = ownership === "done"
    view.owned = ownership === "yours" || ownership === "partners"

    // Brightness ramps with urgency. Hue never moves.
    const edgeGain = isDone ? 0.4 : EDGE_DIM + (1 - EDGE_DIM) * placement.urgency
    const fillGain = isDone ? 0.4 : FILL_DIM + (1 - FILL_DIM) * placement.urgency
    const fillAlpha = isDone ? RELAY_CARD_FILL_OPACITY * 0.5 : RELAY_CARD_FILL_OPACITY

    view.edge = scaleRgb(new vec4(base.r, base.g, base.b, isDone ? 0.45 : 1.0), edgeGain)
    view.fill = scaleRgb(new vec4(base.r, base.g, base.b, fillAlpha), fillGain)
    view.titleColor = new vec4(1, 1, 1, isDone ? 0.45 : 0.72 + 0.28 * placement.urgency)
    view.metaColor = scaleRgb(new vec4(base.r, base.g, base.b, isDone ? 0.35 : 0.65), 1.0)

    this.applyItemText(view, item, placement.ageLabel)

    view.sourceText.textFill.color = view.metaColor
    view.titleText.textFill.color = view.titleColor
    view.ageText.textFill.color = view.metaColor

    if (view.ready) this.applyStyle(view)
  }

  /**
   * Facing is yaw (toward the viewer) composed with a hover pitch.
   *
   * The tilt is a PHYSICAL answer to a hand — the card leans toward you the way a page
   * lifts when you reach for it. It deliberately does not change hue; the only colour
   * response to hover is the same brightness lift the edge already had.
   */
  private applyFacing(view: CardView): void {
    const tiltRad = (-this.hoverTiltDegrees * Math.PI) / 180
    const yaw = quat.angleAxis(view.baseYaw, vec3.up())

    // Air catches the sheet as it goes, and lets it down as it arrives. Peel rolls it
    // one way; resolve starts rolled the OPPOSITE way and flattens out, so the receiving
    // pane looks like the same object settling rather than a second object appearing.
    const rollDeg =
      RELAY_PEEL_TILT_DEG * view.peel * view.peelDir -
      RELAY_PEEL_TILT_DEG * (1 - view.resolve) * view.peelDir
    const hasRoll = Math.abs(rollDeg) > 0.01

    if (view.hoverGain <= 0.001 && !hasRoll) {
      view.root.getTransform().setLocalRotation(yaw)
      return
    }

    let rot = yaw
    if (view.hoverGain > 0.001) {
      rot = rot.multiply(quat.angleAxis(tiltRad * view.hoverGain, vec3.right()))
    }
    if (hasRoll) {
      rot = rot.multiply(quat.angleAxis((rollDeg * Math.PI) / 180, vec3.forward()))
    }
    view.root.getTransform().setLocalRotation(rot)
  }

  /**
   * One frame of every sheet that is leaving or landing.
   *
   * Kept out of the main view loop because these are id-keyed transitions with their own
   * clocks: a card can be mid-peel while the arc reflows around it, and the two must not
   * share a timer.
   */
  private tickPaper(now: number): void {
    const leaving = Object.keys(this.peeling)
    for (let i = 0; i < leaving.length; i++) {
      const id = leaving[i]
      const view = this.views[id]
      if (!view) {
        delete this.peeling[id]
        continue
      }
      const t = (now - this.peeling[id]) / RELAY_PEEL_MS
      // Air, not a track. easeOut leaves at full speed from the first frame, which is
      // what made this read mechanical. Smootherstep starts almost at rest, gathers, and
      // eases off again — the shape of something being drawn away rather than pushed.
      view.peel = t >= 1 ? 1 : smootherStep(t)
      this.applyFacing(view)
      this.applyStyle(view)
      if (t >= 1) delete this.peeling[id]
    }

    const landing = Object.keys(this.resolving)
    for (let i = 0; i < landing.length; i++) {
      const id = landing[i]
      const view = this.views[id]
      if (!view) {
        delete this.resolving[id]
        continue
      }
      const t = (now - this.resolving[id]) / RELAY_RESOLVE_MS
      // Condensing into place: quintic falls away far more slowly at the end than cubic,
      // so the last of the fade-in is unhurried instead of snapping shut.
      view.resolve = t >= 1 ? 1 : easeOutQuint(t)
      this.applyFacing(view)
      this.applyStyle(view)
      if (t >= 1) delete this.resolving[id]
    }
  }

  /** The camera object, found once. Used only for the specular band. */
  private findHead(): SceneObject | null {
    const roots = global.scene.getRootObjectsCount()
    for (let i = 0; i < roots; i++) {
      const hit = this.searchForCamera(global.scene.getRootObject(i))
      if (hit) return hit
    }
    return null
  }

  private searchForCamera(obj: SceneObject): SceneObject | null {
    if (!isNull(obj.getComponent("Component.Camera"))) return obj
    const count = obj.getChildrenCount()
    for (let i = 0; i < count; i++) {
      const hit = this.searchForCamera(obj.getChild(i))
      if (hit) return hit
    }
    return null
  }

  /**
   * The per-pane wash: one wide, very dim plate parked behind the far plane.
   *
   * It is BEHIND everything and it is not a card, which is the whole point — it changes
   * the light the queue hangs in without touching a single ownership colour. Warm on the
   * host, cool on the guest, so the two displays read as two rooms.
   */
  private buildAmbientWash(): void {
    if (this.ambientRoot !== null || isNull(this.cardsRoot)) return

    const root = global.scene.createSceneObject("RelayAmbientWash")
    root.setParent(this.cardsRoot)
    root
      .getTransform()
      .setLocalPosition(new vec3(0, RELAY_AMBIENT_Y_CM, RELAY_AMBIENT_Z_CM))

    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(RELAY_AMBIENT_W_CM, RELAY_AMBIENT_H_CM)

    const shape = root.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle

    this.ambientRoot = root
    this.ambientShape = shape

    plate.onInitialized.add(() => {
      const collider = root.getComponent("Physics.ColliderComponent")
      if (collider) collider.enabled = false
      if (plate.interactable) plate.interactable.enabled = false
      this.ambientReady = true
      this.styleAmbient()
    })
  }

  /**
   * Where the wet highlight sits, from where the viewer actually is.
   *
   * The band tracks the vertical angle between the head and the card, so leaning down
   * slides the sheen up the sheet and vice versa. That relationship — highlight moves
   * opposite to the eye — is the whole reason a surface reads as glossy rather than
   * printed, and it costs one dot product per card per frame.
   */
  private updateGloss(view: CardView): void {
    if (isNull(this.headObject)) return
    const card = view.root.getTransform().getWorldPosition()
    const head = this.headObject.getTransform().getWorldPosition()
    const dy = head.y - card.y
    const dz = head.z - card.z
    const dist = Math.sqrt(dy * dy + dz * dz)
    // 0 at the bottom edge, 1 at the top. Clamped well inside so the band never
    // degenerates into the end stops.
    const raw = dist > 0.001 ? 0.5 - (dy / dist) * 0.75 : 0.5
    view.glossTarget = raw < 0.12 ? 0.12 : raw > 0.88 ? 0.88 : raw
  }

  private applyItemText(view: CardView, item: WorkItem, ageLabel: string): void {
    view.item = item
    view.ageLabel = ageLabel
    view.sourceText.text = item.source.toUpperCase()
    // The triaged summary IS the headline, translated into THIS client's language when
    // we have it and left in English when we do not. headlineIn() owns both choices so
    // the renderer cannot diverge from them.
    view.titleText.text = headlineIn(item, this.language.code)
    view.ageText.text = ageLabel + " waiting"

    // Right-to-left scripts read from the other edge. The font does the shaping and the
    // bidi run; alignment is the only thing the layout has to get right.
    const align = this.language.rtl ? HorizontalAlignment.Right : HorizontalAlignment.Left
    view.titleText.horizontalAlignment = align
    view.sourceText.horizontalAlignment = align
    view.ageText.horizontalAlignment = align
  }

  // -------------------------------------------------------------------------
  // Language
  // -------------------------------------------------------------------------

  /**
   * Switch the language THIS client reads in. Re-renders text in place: no card is
   * created, destroyed, moved or re-coloured, so ordering, ownership and every running
   * animation survive the switch untouched.
   */
  public setLanguage(code: string): void {
    this.language = languageByCode(code)
    if (this.chipText) this.chipText.text = this.language.chip

    const ids = Object.keys(this.views)
    for (let i = 0; i < ids.length; i++) {
      const view = this.views[ids[i]]
      if (view.item !== null) this.applyItemText(view, view.item, view.ageLabel)
    }
    this.styleLangRows()
  }

  public currentLanguage(): string {
    return this.language.code
  }

  /**
   * The chip: two letters at the edge of your own lane, further away than the lane so it
   * sits behind the plane you act in. It is a setting, so it gets no header, no icon and
   * no colour of its own — mineral like anything unowned.
   */
  /**
   * The panel the rows sit on. Built BEFORE the rows so it is behind them in creation
   * order, and parked slightly further away so nothing z-fights along its border.
   */
  private buildLanguagePanel(): void {
    if (this.langPanel !== null || isNull(this.cardsRoot)) return

    const n = RELAY_LANGUAGES.length
    const listH = (n - 1) * RELAY_LANG_LIST_PITCH_CM + RELAY_LANG_LIST_ROW_H_CM
    const top = RELAY_LANG_LIST_TOP_CM + RELAY_LANG_LIST_ROW_H_CM / 2
    const centreY = top - listH / 2

    const root = global.scene.createSceneObject("RelayLangPanel")
    root.setParent(this.cardsRoot)
    root
      .getTransform()
      .setLocalPosition(new vec3(RELAY_LANG_LIST_X_CM, centreY, RELAY_LANG_LIST_Z_CM - 0.6))
    root.enabled = false

    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(
      RELAY_LANG_LIST_W_CM + RELAY_LANG_PANEL_PAD_CM * 2,
      listH + RELAY_LANG_PANEL_PAD_CM * 2
    )

    const shape = root.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    this.langPanel = root

    plate.onInitialized.add(() => {
      // The panel is a surface, never a target: a collider here would eat the pinches
      // aimed at the rows sitting on top of it.
      const collider = root.getComponent("Physics.ColliderComponent")
      if (collider) collider.enabled = false
      if (plate.interactable) plate.interactable.enabled = false
      this.suppressInteractionPlane(root)
      this.langPanelShape = shape
    })
  }

  private buildLanguageChip(): void {
    if (this.chipRoot !== null || isNull(this.cardsRoot)) return

    this.buildLanguagePanel()
    const mineral = this.unclaimedColor
    const root = global.scene.createSceneObject("RelayLangChip")
    root.setParent(this.cardsRoot)
    root
      .getTransform()
      .setLocalPosition(new vec3(RELAY_LANG_CHIP_X_CM, RELAY_LANG_CHIP_Y_CM, RELAY_LANG_CHIP_Z_CM))

    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(RELAY_LANG_CHIP_W_CM, RELAY_LANG_CHIP_H_CM)
    const shape = root.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle

    const labelObj = global.scene.createSceneObject("LangChipLabel")
    labelObj.setParent(root)
    labelObj.getTransform().setLocalPosition(new vec3(0, 0, CONTENT_Z))
    const label = labelObj.createComponent("Component.Text") as Text
    label.depthTest = true
    label.size = SIZE_META
    label.weight = WEIGHT_TITLE
    label.horizontalAlignment = HorizontalAlignment.Center
    label.verticalAlignment = VerticalAlignment.Center
    label.horizontalOverflow = HorizontalOverflow.Overflow
    label.layoutRect = Rect.create(-RELAY_LANG_CHIP_W_CM / 2, RELAY_LANG_CHIP_W_CM / 2, -1.1, 1.1)
    label.textFill.color = new vec4(mineral.r, mineral.g, mineral.b, 0.9)
    label.text = this.language.chip

    this.chipRoot = root
    this.chipText = label
    this.chipShape = shape

    plate.onInitialized.add(() => {
      this.suppressInteractionPlane(root)
      this.styleChipPlate(shape, false)
      plate.interactable.onTriggerEnd.add(() => this.toggleLanguageList())
    })

    // Rows stack upward from the chip: downward runs past the bottom of the display.
    for (let i = 0; i < RELAY_LANGUAGES.length; i++) {
      this.buildLangRow(RELAY_LANGUAGES[i], i, mineral)
    }

    const partnerObj = global.scene.createSceneObject("RelayPartnerLang")
    partnerObj.setParent(this.cardsRoot)
    partnerObj
      .getTransform()
      .setLocalPosition(new vec3(RELAY_LANG_CHIP_X_CM, RELAY_LANG_PARTNER_Y_CM, RELAY_LANG_CHIP_Z_CM))
    const partner = partnerObj.createComponent("Component.Text") as Text
    partner.depthTest = true
    partner.size = SIZE_META
    partner.weight = WEIGHT_META
    partner.horizontalAlignment = HorizontalAlignment.Center
    partner.verticalAlignment = VerticalAlignment.Center
    partner.horizontalOverflow = HorizontalOverflow.Overflow
    partner.layoutRect = Rect.create(-8, 8, -1, 1)
    partner.textFill.color = new vec4(mineral.r, mineral.g, mineral.b, 0.45)
    partner.text = ""
    this.partnerLangText = partner
  }

  private buildLangRow(lang: RelayLanguage, index: number, mineral: vec4): void {
    if (isNull(this.cardsRoot)) return
    const step = RELAY_LANG_ROW_H_CM + RELAY_LANG_ROW_GAP_CM
    const dy =
      RELAY_LANG_ROW_DIR *
      (RELAY_LANG_CHIP_H_CM / 2 + RELAY_LANG_ROW_H_CM / 2 + RELAY_LANG_FIRST_GAP_CM + index * step)

    // Parented to the deck, NOT to the chip. A row nested under another Interactable is
    // not reliably resolved as its own target — the ancestor wins the scoring — so the
    // rows render and highlight but never receive a trigger.
    const root = global.scene.createSceneObject("RelayLangRow_" + lang.code)
    const slotY = RELAY_LANG_LIST_TOP_CM - index * RELAY_LANG_LIST_PITCH_CM
    root.setParent(this.cardsRoot)
    root
      .getTransform()
      .setLocalPosition(new vec3(RELAY_LANG_LIST_X_CM, slotY, RELAY_LANG_LIST_Z_CM))

    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(plate as unknown as {_enableInteractionPlane: boolean})._enableInteractionPlane = false
    plate.style = "simple"
    plate.size = new vec2(RELAY_LANG_LIST_W_CM, RELAY_LANG_LIST_ROW_H_CM)
    const shape = root.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle

    const labelObj = global.scene.createSceneObject("LangRowLabel")
    labelObj.setParent(root)
    labelObj.getTransform().setLocalPosition(new vec3(0, 0, CONTENT_Z))
    const label = labelObj.createComponent("Component.Text") as Text
    label.depthTest = true
    label.size = SIZE_META
    label.weight = WEIGHT_META
    label.horizontalAlignment = HorizontalAlignment.Center
    label.verticalAlignment = VerticalAlignment.Center
    label.horizontalOverflow = HorizontalOverflow.Shrink
    label.layoutRect = Rect.create(
      -RELAY_LANG_LIST_W_CM / 2 + 0.3,
      RELAY_LANG_LIST_W_CM / 2 - 0.3,
      -0.9,
      0.9
    )
    label.textFill.color = new vec4(mineral.r, mineral.g, mineral.b, 0.8)
    // Two letters at rest; the language's own name appears when a hand reaches for it.
    label.text = lang.chip

    // Built ENABLED on purpose. A BackPlate on a disabled SceneObject never runs its
    // own initialize(), so onInitialized never fires and no trigger handler is ever
    // bound — the row would render and be pinchable-looking but permanently inert.
    // It is collapsed below, once it has initialized.
    this.langRows.push({
      root: root,
      label: label,
      shape: shape,
      code: lang.code,
      slotY: slotY,
      openAmt: 0,
      startMs: 0,
      delayMs: 0,
      moving: false,
      hover: 0,
      hoverTarget: 0
    })

    const record = this.langRows[this.langRows.length - 1]

    plate.onInitialized.add(() => {
      this.suppressInteractionPlane(root)
      this.styleLangRow(record)
      plate.interactable.onTriggerEnd.add(() => {
        if (!this.langExpanded) return
        this._onLanguagePicked.invoke(lang.code)
        this.toggleLanguageList()
      })
      plate.interactable.onHoverEnter.add(() => {
        if (this.langExpanded) record.hoverTarget = 1
      })
      plate.interactable.onHoverExit.add(() => {
        record.hoverTarget = 0
      })
      if (!this.langExpanded) root.enabled = false
    })
  }

  private styleChipPlate(shape: RoundedRectangle, selected: boolean): void {
    if (isNull(shape)) return
    const mineral = this.unclaimedColor
    shape.gradient = false
    shape.cornerRadius = RELAY_CARD_CORNER_RADIUS_CM
    shape.backgroundColor = new vec4(
      mineral.r,
      mineral.g,
      mineral.b,
      RELAY_CARD_FILL_OPACITY * (selected ? 1.6 : 0.7)
    )
    shape.border = true
    shape.borderType = "Color"
    shape.borderColor = scaleRgb(new vec4(mineral.r, mineral.g, mineral.b, selected ? 1 : 0.6), 1)
    shape.borderSize = RELAY_CARD_EDGE_WIDTH_CM
    shape.borderSoftness = RELAY_CARD_EDGE_SOFTNESS
  }

  /**
   * Collapsed rows are DISABLED, not merely hidden: a disabled SceneObject is not a
   * raycast target, so the six rows cannot compete with the cards for a pinch when the
   * list is shut.
   */
  /**
   * Open the list TOWARD the viewer and push the queue back.
   *
   * Coming forward rather than upward is what stops the list tangling with the lower
   * cards: it lands on a nearer plane, in front of everything, instead of competing for
   * the same depth. It also travels inward as it advances — at that nearer depth the
   * display is narrower, and the old x would put the rows off the side.
   */
  private toggleLanguageList(): void {
    this.langExpanded = !this.langExpanded
    const now = this.nowMs()
    const n = this.langRows.length

    if (this.langPanel !== null) this.langPanel.enabled = true

    for (let i = 0; i < n; i++) {
      const row = this.langRows[i]

      if (this.langExpanded) {
        row.root.enabled = true
        // A row builds its InteractionPlane the first time it is ENABLED, not when it
        // is constructed — so the ~34 cm collider slab appears on expand and swallows
        // the pinch aimed at the row. Suppress it every time; the call is idempotent.
        this.suppressInteractionPlane(row.root)
      } else {
        row.hover = 0
        row.hoverTarget = 0
        row.label.text = languageByCode(row.code).chip
      }

      // Opening unrolls top-down; closing rolls up bottom-first. Reversing the stagger
      // is what stops a close from looking like a different animation than the open.
      row.delayMs = (this.langExpanded ? i : n - 1 - i) * RELAY_LANG_STAGGER_MS
      row.startMs = now
      row.moving = true
    }

    // Full attention on the choice. Brightness only — the queue does not change colour,
    // it recedes.
    this.dimGain = this.langExpanded ? RELAY_LANG_DIM : 1
    const ids = Object.keys(this.views)
    for (let i = 0; i < ids.length; i++) this.applyStyle(this.views[ids[i]])

    this.styleLangRows()
  }

  /** One frame of the menu's open/close and of each row's hover reveal. */
  private tickLangRows(now: number): void {
    let anyOpen = 0

    for (let i = 0; i < this.langRows.length; i++) {
      const row = this.langRows[i]

      if (row.moving) {
        const t = (now - row.startMs - row.delayMs) / RELAY_LANG_ROW_MS
        const k = t <= 0 ? 0 : easeOut(t)
        row.openAmt = this.langExpanded ? k : 1 - k

        // Slide DOWN into the slot while fading up. Starting above and settling is what
        // makes it read as a menu unrolling rather than a panel being switched on.
        const y = row.slotY + RELAY_LANG_LIST_RISE_CM * (1 - row.openAmt)
        row.root
          .getTransform()
          .setLocalPosition(new vec3(RELAY_LANG_LIST_X_CM, y, RELAY_LANG_LIST_Z_CM))
        this.styleLangRow(row)

        if (t >= 1) {
          row.moving = false
          // Collapse only after the travel, so it retracts rather than blinking out.
          if (!this.langExpanded) row.root.enabled = false
        }
      }
      if (row.openAmt > anyOpen) anyOpen = row.openAmt

      if (Math.abs(row.hover - row.hoverTarget) > 0.001) {
        const rate = getDeltaTime() / 0.14
        const d = row.hoverTarget - row.hover
        row.hover += d > 0 ? Math.min(d, rate) : Math.max(d, -rate)
        this.styleLangRow(row)
      }
    }

    this.paintLangPanel(anyOpen)
  }

  /**
   * The backing panel. It follows the most-open row, so it arrives with the first row and
   * leaves with the last — the thing that makes six controls read as one menu.
   */
  private paintLangPanel(openAmt: number): void {
    if (this.langPanel === null) return

    // Visibility is derived from openAmt EVERY frame, in both directions.
    //
    // It used to only ever turn the panel off here, relying on the toggle to turn it on.
    // But the first tick after a toggle lands before the stagger has started any row, so
    // openAmt is still 0 and this ran first — switching the panel straight back off, and
    // nothing ever switched it on again. The rows opened onto nothing.
    this.langPanel.enabled = openAmt > 0.001
    if (!this.langPanel.enabled) return
    if (this.langPanelShape === null || isNull(this.langPanelShape)) return
    const m = this.unclaimedColor
    const shape = this.langPanelShape
    shape.gradient = false
    shape.cornerRadius = 0.9
    shape.backgroundColor = new vec4(m.r * 0.28, m.g * 0.3, m.b * 0.34, RELAY_LANG_PANEL_ALPHA * openAmt)
    shape.border = true
    shape.borderType = "Color"
    shape.borderColor = new vec4(m.r, m.g, m.b, 0.22 * openAmt)
    shape.borderSize = RELAY_CARD_EDGE_WIDTH_CM
    shape.borderSoftness = RELAY_CARD_EDGE_SOFTNESS
  }

  private styleLangRows(): void {
    for (let i = 0; i < this.langRows.length; i++) this.styleLangRow(this.langRows[i])
  }

  /**
   * The language you are reading in is YOURS, so it is jade — the same jade as a card in
   * your lane. Everything else is dim mineral: available, unclaimed, not yours yet.
   * That is the ownership rule applied to a setting, not a new palette.
   *
   * Hover adds brightness and swaps the two-letter code for the language's own name.
   * The vitality is motion and typography; no row ever invents a hue.
   */
  private styleLangRow(row: {
    root: SceneObject
    label: Text
    shape: RoundedRectangle
    code: string
    hover: number
    openAmt: number
  }): void {
    const active = row.code === this.language.code
    const lang = languageByCode(row.code)
    const base = active ? this.yoursColor : this.unclaimedColor
    const h = row.hover
    // Everything the row draws is scaled by how open the menu is, so the fade and the
    // slide are one motion rather than a move followed by an appearance.
    const o = row.openAmt

    if (isNull(row.shape)) return
    const lift = 1 + 0.5 * h
    row.shape.gradient = false
    row.shape.cornerRadius = RELAY_CARD_CORNER_RADIUS_CM
    row.shape.backgroundColor = new vec4(
      base.r,
      base.g,
      base.b,
      RELAY_CARD_FILL_OPACITY * (active ? 1.5 : 0.55) * lift * o
    )
    row.shape.border = true
    row.shape.borderType = "Color"
    const rowEdge = scaleRgb(new vec4(base.r, base.g, base.b, active ? 1 : 0.5), lift)
    row.shape.borderColor = new vec4(rowEdge.r, rowEdge.g, rowEdge.b, rowEdge.a * o)
    row.shape.borderSize = RELAY_CARD_EDGE_WIDTH_CM * (1 + 0.5 * h)
    row.shape.borderSoftness = RELAY_CARD_EDGE_SOFTNESS

    row.label.textFill.color = new vec4(1, 1, 1, (active ? 0.92 : 0.45 + 0.5 * h) * o)
    // Reaching for a row is what earns its real name.
    row.label.text = h > 0.5 ? lang.label : lang.chip
  }

  /** One quiet line saying what the other person is reading in. Mineral, no emphasis. */
  public setPartnerLanguage(code: string | null): void {
    if (this.partnerLangText === null) return
    if (code === null) {
      this.partnerLangText.text = ""
      return
    }
    this.partnerLangText.text = "partner reading " + languageByCode(code).chip
  }

  /**
   * The edge-lit glass itself: near-transparent fill, bright thin border.
   *
   * Hover raises BRIGHTNESS and edge weight only — it never shifts hue, because hue is
   * reserved for ownership. A highlighted unclaimed card is a brighter mineral, not a
   * different colour.
   */
  private applyStyle(view: CardView): void {
    // NOT READY IS NOT AN ERROR — IT IS THE NORMAL FIRST FRAME.
    //
    // The RoundedRectangle component exists the instant createComponent returns, but its
    // MATERIAL does not: BackPlate builds that during its own initialize(). Writing a
    // gradient before then reaches into shape.mainPass while it is still undefined and
    // throws inside UIKit (writeUniformVec4). That throw is the expensive part — it
    // aborts whatever called us, which is how a single unstyled card stopped setCards()
    // from ever reaching its retire loop and left withdrawn cards on screen forever.
    //
    // So: never write early, and never need to. onInitialized calls applyStyle again,
    // and every field it reads is plain state on the view, so the deferred write paints
    // exactly what the early one would have. A card retired before it initialises is
    // hidden by destroyView regardless — hiding touches no material.
    if (isNull(view.shape) || !view.ready) return
    const g = view.hoverGain
    const breath = view.lastBreath

    const dim = this.dimGain
    const edge = scaleRgb(view.edge, (1 + 0.55 * g) * breath * dim)
    const fill = new vec4(
      view.fill.r,
      view.fill.g,
      view.fill.b,
      view.fill.a * (1 + 1.1 * g) * dim
    )

    // `resolve` fades a landing card up from nothing; `peel` thins a departing one away.
    const life = view.resolve * (1 - view.peel)

    // The body carries the same ownership colour as the face, so turning your head
    // reveals the card's thickness in ITS colour rather than in a neutral grey.
    if (!isNull(view.slabMat)) {
      const sm = view.slabMat.mainPass as any
      sm.tint = new vec4(view.edge.r, view.edge.g, view.edge.b, 1)
      sm.faceOpacity = RELAY_SLAB_FACE_OPACITY * life
      sm.edgeOpacity = RELAY_SLAB_EDGE_OPACITY * life * (view.owned ? 1.25 : 1)
      sm.frost = RELAY_SLAB_FROST
      sm.intensity = RELAY_SLAB_INTENSITY
    }

    const shape = view.shape
    shape.cornerRadius = RELAY_CARD_CORNER_RADIUS_CM
    shape.border = true
    shape.borderType = "Color"
    const windowFade = 1 - RELAY_EDGE_FADE_STRENGTH * view.edgeFade * view.edgeFade
    shape.borderColor = new vec4(edge.r, edge.g, edge.b, edge.a * life * windowFade)
    shape.borderSize =
      RELAY_CARD_EDGE_WIDTH_CM * (1 + 0.6 * g) * (view.owned ? OWNED_EDGE_WIDTH : 1)
    shape.borderSoftness = RELAY_CARD_EDGE_SOFTNESS

    // Light pools at the bottom of the sheet — but the pool is DENSITY, not whiteness.
    //
    // This used to scale the fill's RGB by the pool gain. With a gain above ~1.2 every
    // ownership hue clipped: mineral (0.639, 0.761, 0.816) x 2.2 is (1.41, 1.67, 1.80),
    // which clamps to pure white. So did jade, and so did lilac. The bottom of every card
    // was the same blown-out white regardless of who owned it, and the only surviving hue
    // was a 0.11 cm border. That is the whole "everything looks the same" complaint: the
    // gradient was quietly deleting the one channel that carries meaning.
    //
    // Ramping ALPHA instead gives the identical read — dense at the bottom edge, thin at
    // the top — while every pixel keeps the exact ownership hue. Nothing can clip, because
    // the colour is never scaled at all.
    // Ownership emphasis. Mineral sits at the base weight so a full arc stays calm; jade
    // and lilac come forward, because "someone has this" is the one thing that must carry.
    const own = view.owned ? OWNED_EMPHASIS : 1
    // Clamped to the glass ceiling, not to 1. Nothing on the body may exceed it.
    const cap = RELAY_CARD_MAX_BODY_ALPHA
    const poolAlpha = Math.min(fill.a * this.gradientPoolGain * own, cap) * life * windowFade
    const topAlpha = Math.min(fill.a * this.gradientTopGain * own, cap) * life * windowFade

    if (view.peel > 0.001) {
      // PEELING: the ramp turns sideways so the sheet thins along its trailing edge
      // instead of dimming uniformly. A flat fade reads as a light being switched off;
      // a directional thin reads as paper lifting off a surface.
      const lead = view.peelDir > 0 ? 0 : 1
      const trail = view.peelDir > 0 ? 1 : 0
      shape.setBackgroundGradient({
        enabled: true,
        type: "Linear",
        start: new vec2(lead, 0.5),
        end: new vec2(trail, 0.5),
        stop0: {enabled: true, percent: 0, color: new vec4(fill.r, fill.g, fill.b, poolAlpha)},
        stop1: {
          enabled: true,
          percent: 0.55 - 0.5 * view.peel,
          color: new vec4(fill.r, fill.g, fill.b, poolAlpha * 0.45)
        },
        stop2: {enabled: true, percent: 1, color: new vec4(fill.r, fill.g, fill.b, 0)},
        stop3: {enabled: true, percent: 1, color: new vec4(fill.r, fill.g, fill.b, 0)}
      })
    } else {
      // AT REST: pool at the bottom, thin at the top, and a narrow brighter band riding
      // the ramp wherever the viewer's head currently is. The band is ALPHA only — lifting
      // RGB toward white is what clipped the ownership hue to white the first time round.
      const band = view.gloss
      const lo = Math.max(0.02, band - RELAY_GLOSS_HALF_WIDTH)
      const hi = Math.min(0.98, band + RELAY_GLOSS_HALF_WIDTH)
      const at = (p: number): number => poolAlpha + (topAlpha - poolAlpha) * p
      // The sheen may sit a little above the body ceiling — it is a highlight, not fill —
      // but only a little, or it becomes a bright band across an otherwise clear sheet.
      const spec = Math.min(at(band) * RELAY_GLOSS_ALPHA_BOOST, cap * 1.25)

      // ENVIRONMENTAL LIGHT ON THE GLASS — an approximation, and worth being plain about.
      //
      // RoundedRectangle exposes no reflection, specular, environment or roughness input;
      // its material is a flat 2D UI shader. There is nothing native to drive, and the one
      // way to get a real reflection would be a custom shader reaching around BackPlate,
      // which is exactly what caused the mainPass crash. So instead the existing specular
      // band — the only part of the card that already behaves like a highlight — is tinted
      // toward THIS PANE's ambient: warm on the host, cool on the guest. It is the light of
      // the room landing on the sheen, not a mirror, and at this strength the ownership
      // hue underneath is never in doubt.
      const env = hexToVec4(this.warmPane ? RELAY_AMBIENT_WARM : RELAY_AMBIENT_COOL, 1)
      const e = RELAY_GLASS_ENV_TINT
      const sr = fill.r + (env.r - fill.r) * e
      const sg = fill.g + (env.g - fill.g) * e
      const sb = fill.b + (env.b - fill.b) * e

      // WINDOW FADE. The ramp is tilted sideways in proportion to how far out on the arc
      // this card sits, so the outermost cards thin toward their OUTER edge rather than
      // dimming as a whole. A uniform dim would read as "unimportant"; a directional thin
      // reads as "continues past here", which is the true statement — there are more
      // items, they are simply off the arc.
      const tilt = RELAY_EDGE_FADE_TILT * view.edgeFade * view.edgeSide
      shape.setBackgroundGradient({
        enabled: true,
        type: "Linear",
        start: new vec2(0.5 - tilt, 0),
        end: new vec2(0.5 + tilt, 1),
        stop0: {enabled: true, percent: 0, color: new vec4(fill.r, fill.g, fill.b, poolAlpha)},
        stop1: {enabled: true, percent: lo, color: new vec4(fill.r, fill.g, fill.b, at(lo))},
        stop2: {enabled: true, percent: hi, color: new vec4(sr, sg, sb, spec)},
        stop3: {enabled: true, percent: 1, color: new vec4(fill.r, fill.g, fill.b, topAlpha)}
      })
    }
  }

  // -------------------------------------------------------------------------
  // Status pill — which data source actually won.
  // -------------------------------------------------------------------------

  private buildStatusPill(): void {
    if (isNull(this.statusRoot)) {
      print("[RelayQueueUI] statusRoot is not wired — status readout skipped.")
      return
    }
    this.statusBuilt = true

    const plate = this.statusRoot.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.style = "simple"
    plate.size = new vec2(24, 4)

    const content = global.scene.createSceneObject("StatusContent")
    content.setParent(this.statusRoot)
    content.getTransform().setLocalPosition(new vec3(0, 0, CONTENT_Z))

    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.autoDiscoverItemsOnStart = false
    flex.width = 24
    flex.height = 4
    flex.direction = FlexDirection.Row
    flex.alignItems = FlexAlign.Center
    flex.justifyContent = FlexJustify.Center
    flex.columnGap = 0.9
    flex.paddingLeft = 1.2
    flex.paddingRight = 1.2

    const items: FlexItem[] = []

    const iconObj = global.scene.createSceneObject("StatusIcon")
    iconObj.setParent(content)
    this.statusIcon = iconObj.createComponent("Component.Image") as Image
    const iconItem = iconObj.createComponent(FlexItem.getTypeName()) as FlexItem
    iconItem.overrideWidth = 2.2
    iconItem.overrideHeight = 2.2
    items.push(iconItem)

    const labelObj = global.scene.createSceneObject("StatusLabel")
    labelObj.setParent(content)
    const label = labelObj.createComponent("Component.Text") as Text
    label.depthTest = true
    label.size = SIZE_META
    label.weight = WEIGHT_META
    label.horizontalAlignment = HorizontalAlignment.Left
    label.verticalAlignment = VerticalAlignment.Center
    label.horizontalOverflow = HorizontalOverflow.Overflow
    label.layoutRect = Rect.create(-9.5, 9.5, -1.3, 1.3)
    label.textFill.color = new vec4(1, 1, 1, 0.72)
    label.text = "Connecting..."
    this.statusText = label

    const labelItem = labelObj.createComponent(FlexItem.getTypeName()) as FlexItem
    labelItem.overrideWidth = 19
    labelItem.overrideHeight = 2.6
    items.push(labelItem)

    flex.addItems(items)

    plate.onInitialized.add(() => {
      const shape = this.statusRoot.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
      if (isNull(shape)) return
      shape.gradient = false
      shape.cornerRadius = 1.2
      shape.backgroundColor = new vec4(
        this.unclaimedColor.r,
        this.unclaimedColor.g,
        this.unclaimedColor.b,
        RELAY_CARD_FILL_OPACITY
      )
      shape.border = true
      shape.borderType = "Color"
      shape.borderColor = new vec4(
        this.unclaimedColor.r,
        this.unclaimedColor.g,
        this.unclaimedColor.b,
        0.85
      )
      shape.borderSize = RELAY_CARD_EDGE_WIDTH_CM
      shape.borderSoftness = RELAY_CARD_EDGE_SOFTNESS
    })

  }
}
