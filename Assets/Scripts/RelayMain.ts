/**
 * RelayMain — the orchestrator for Relay's shared spatial work queue.
 *
 * OWNS:      the session lifecycle, host authority, the fetch/fallback decision, the
 *            networked broadcast of queue state, and pushing placements into the view.
 * EXPECTS:   @input queueUI (the RelayQueueUI view) plus the spatial-encoding tunables.
 * MUST NOT:  create text, import UIKit, or draw anything. All rendering lives in
 *            RelayQueueUI; this script only calls its public setters.
 *
 * HOST AUTHORITY
 * Exactly one client talks to the network. Authority is decided by ownership of a
 * single, explicitly-named SyncEntity (claimOwnership: true + a Custom network id, so
 * both panes agree which entity that is). RelayHostNetwork tests that ownership itself
 * before granting a handle, so a guest has no reachable path to Supabase. The
 * host fetches, then broadcasts the resulting list over a StorageProperty capped at
 * 10 Hz. Late joiners get the current snapshot for free — StorageProperty replicates,
 * networked events do not.
 *
 * THREE OUTCOMES, NOT TWO
 * A fetch that FAILS or times out (20 s) renders the local fallback dataset. A fetch
 * that SUCCEEDS with zero rows renders a real empty state — the queue is genuinely
 * clear, and showing fallback items there would present fabricated work as real work.
 * A fetch that succeeds with rows renders those. A guest that never hears from a host
 * falls back to the local dataset after guestWaitSeconds — local data, no network call.
 */

import {NetworkIdOptions} from "SpectaclesSyncKit.lspkg/Core/NetworkIdTools"
import {NetworkIdType} from "SpectaclesSyncKit.lspkg/Core/NetworkIdType"
import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"
import {StorageProperty} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StoragePropertySet} from "SpectaclesSyncKit.lspkg/Core/StoragePropertySet"
import {StorageTypes} from "SpectaclesSyncKit.lspkg/Core/StorageTypes"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

import {
  RELAY_ARC_SPAN_DEGREES,
  RELAY_CARD_WIDTH_CM,
  RELAY_FAR_DISTANCE_CM,
  RELAY_MAX_HEIGHT_CM,
  RELAY_MAX_VISIBLE_CARDS,
  RELAY_MAX_SENDS_PER_SECOND,
  RELAY_MIN_HEIGHT_CM,
  RELAY_NEAR_DISTANCE_CM,
  RELAY_QUEUE_NETWORK_ID,
  RELAY_EVT_CLAIM_REQUEST,
  RELAY_EVT_CLAIM_DENIED,
  RELAY_EVT_HOVER,
  RELAY_EVT_PASS_REQUEST,
  RELAY_EVT_LANGUAGE,
  RELAY_EVT_TRANSLATE_REQUEST,
  RELAY_POLL_MS,
  RELAY_HEX_YOURS,
  RELAY_HEX_PARTNERS,
  hexToVec4
} from "./RelayConfig"
import {RELAY_FALLBACK_ITEMS} from "./RelayFallbackData"
import {RelayHostNetwork} from "./RelayHostNetwork"
import {RelayTriage} from "./RelayTriage"
import {RelayTranslate, TranslationResult} from "./RelayTranslate"
import {RELAY_DEFAULT_LANGUAGE, isSourceLanguage, languageByCode} from "./RelayLanguage"
import {computePlacements} from "./RelayQueueLayout"
import {RelayQueueUI} from "./RelayQueueUI"
import {headlineOf, needsTranslation, needsTriage, parseWorkItems, withTranslation, withTriage, WorkItem} from "./RelayWorkItem"

type QueueSource = "supabase" | "fallback"

interface QueuePayload {
  source: QueueSource
  items: WorkItem[]
}

@component
export class RelayMain extends BaseScriptComponent {
  @ui.label('<span style="color: #A3C2D0;">RelayMain — session, host authority, queue state</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("The RelayQueueUI view this script pushes queue state into.")
  queueUI!: RelayQueueUI
  @ui.group_end
  @ui.separator
  @ui.group_start("Settings")
  @input
  @widget(new SliderWidget(12, 120, 1))
  @hint("Horizontal spread of the queue arc, in degrees. Slot angle carries no data.")
  arcSpanDegrees: number = RELAY_ARC_SPAN_DEGREES

  @input
  @widget(new SliderWidget(60, 200, 5))
  @hint("Distance of the OLDEST item, in centimetres. The longer it waits, the closer it comes.")
  nearDistanceCm: number = RELAY_NEAR_DISTANCE_CM

  @input
  @widget(new SliderWidget(80, 300, 5))
  @hint("Distance of the NEWEST item, in centimetres.")
  farDistanceCm: number = RELAY_FAR_DISTANCE_CM

  @input
  @widget(new SliderWidget(-60, 20, 1))
  @hint("Height of the LOWEST-priority item, in centimetres. Height encodes urgency.")
  minHeightCm: number = RELAY_MIN_HEIGHT_CM

  @input
  @widget(new SliderWidget(0, 80, 1))
  @hint("Height of the HIGHEST-priority item, in centimetres.")
  maxHeightCm: number = RELAY_MAX_HEIGHT_CM

  @input
  @widget(new SliderWidget(1, 8, 1))
  @hint("How many cards are placed in the arc. Five 9 cm cards fill the ~27 deg usable area; more than that cannot be read without a head-turn.")
  maxVisibleCards: number = RELAY_MAX_VISIBLE_CARDS

  @input
  @widget(new SliderWidget(5, 60, 1))
  @hint("How long a guest waits for the host's broadcast before showing local data instead.")
  guestWaitSeconds: number = 25
  @ui.group_end

  /** The one shared property: the whole queue, JSON-encoded, written only by the host. */
  private readonly queueProp: StorageProperty<StorageTypes.string> =
    StorageProperty.manualString("relayQueue", "")

  private readonly syncEntity: SyncEntity = new SyncEntity(
    this,
    new StoragePropertySet([this.queueProp]),
    /* claimOwnership */ true,
    "Session",
    new NetworkIdOptions(NetworkIdType.Custom, RELAY_QUEUE_NETWORK_ID)
  )

  private syncReady = false
  private authorityHandled = false
  private localUserId: string | null = null
  /** Unique per CLIENT. Decides mine-vs-theirs; see WorkItem.claimed_conn. */
  private localConnectionId: string | null = null

  /** Last authoritative queue this client knows about. Diffed to detect new claims. */
  private items: WorkItem[] = []
  private source: QueueSource = "fallback"

  /** Hover outbox — coalesced to RELAY_MAX_SENDS_PER_SECOND sends per second. */
  private hoverPending: string | null = null
  private hoverSent: string | null = null
  private hoverLastSendMs = 0
  private pollArmed = false

  /** This client's reading language. Local only — it never alters the shared queue. */
  private localLanguage: string = RELAY_DEFAULT_LANGUAGE

  /** Languages already asked of Gemini this session, so a retry never double-calls. */
  private translateInFlight: {[code: string]: boolean} = {}
  private hasRendered = false

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onAwake(): void {
    // Sync Kit disconnects clients that flood. 10 Hz ceiling, no exceptions.
    this.queueProp.sendsPerSecondLimit = RELAY_MAX_SENDS_PER_SECOND

    // The whole notifyOnReady chain starts in OnStart so every sibling component has
    // finished its own onAwake before we touch it (SyncKit sibling-lookup pitfall).
    this.createEvent("OnStartEvent").bind(() => this.begin())

    // EnableOnReady fires at materially different times in START_MENU vs MULTIPLAYER,
    // so event-only triggers can miss the "I am authoritative now" transition.
    this.createEvent("UpdateEvent").bind(() => {
      this.tryBecomeAuthority()
      this.flushHover()
    })
  }

  /**
   * Hover is a continuous gesture but the wire budget is discrete. Sync Kit drops
   * clients that flood, so at most RELAY_MAX_SENDS_PER_SECOND updates leave this
   * client per second; the receiver eases between them (RelayQueueUI.tick) so the
   * partner still sees smooth motion rather than a strobe.
   */
  private flushHover(): void {
    if (!this.syncReady) return
    if (this.hoverPending === this.hoverSent) return
    const nowMs = getTime() * 1000
    const minGapMs = 1000 / RELAY_MAX_SENDS_PER_SECOND
    if (nowMs - this.hoverLastSendMs < minGapMs) return
    this.hoverLastSendMs = nowMs
    this.hoverSent = this.hoverPending
    this.syncEntity.sendEvent(
      RELAY_EVT_HOVER,
      {itemId: this.hoverSent, userId: this.localUserId},
      /* onlySendRemote */ true
    )
  }

  // ---------------------------------------------------------------------------
  // Claiming
  // ---------------------------------------------------------------------------

  /**
   * This client wants the card. The HOST decides — always, including when the host is
   * this client. One arbiter is what makes a double-claim impossible: two requests for
   * the same card arrive at the same queue in some order, and the second one loses.
   */
  private requestClaim(itemId: string): void {
    if (!this.syncReady || this.localUserId === null) return
    if (this.syncEntity.doIOwnStore() === true) {
      this.arbitrate(itemId, this.localUserId, this.localConnectionId ?? "")
      return
    }
    this.syncEntity.sendEvent(RELAY_EVT_CLAIM_REQUEST, {
      itemId: itemId,
      userId: this.localUserId,
      connectionId: this.localConnectionId
    })
  }

  /** Host-only. Decides a claim, then tells everyone — including the loser. */
  private arbitrate(itemId: string, userId: string, connectionId: string): void {
    if (this.syncEntity.doIOwnStore() !== true) return

    let target: WorkItem | null = null
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === itemId) {
        target = this.items[i]
        break
      }
    }
    if (target === null) return

    if (target.status !== "open") {
      // Someone already has it. The loser must SEE this, so it is broadcast, not hidden.
      print("[Relay] Claim on " + itemId + " by " + userId + " DENIED — already " + target.status)
      if (connectionId === this.localConnectionId) {
        this.queueUI.flashDenied(itemId, "claimed by partner")
      } else {
        this.syncEntity.sendEvent(RELAY_EVT_CLAIM_DENIED, {
          itemId: itemId,
          connectionId: connectionId
        })
      }
      return
    }

    const claimed: WorkItem[] = []
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      if (it.id !== itemId) {
        claimed.push(it)
        continue
      }
      claimed.push({
        id: it.id,
        source: it.source,
        title: it.title,
        body: it.body,
        status: "claimed",
        claimed_by: userId,
        claimed_conn: connectionId,
        priority: it.priority,
        summary: it.summary,
        translations: it.translations,
        created_at: it.created_at,
        hasPriority: it.hasPriority
      })
    }
    print("[Relay] Claim on " + itemId + " GRANTED to " + userId)

    this.broadcast({source: this.source, items: claimed})
    this.applyQueueState(claimed, this.source)
    this.persistClaim(itemId, userId)
  }

  /**
   * This client is handing a card it holds to the other person. Same shape as a claim:
   * the HOST decides, so a pass can never create two owners or an owner-less card.
   */
  private requestPass(itemId: string): void {
    if (!this.syncReady || this.localConnectionId === null) return
    if (this.syncEntity.doIOwnStore() === true) {
      this.arbitratePass(itemId, this.localConnectionId)
      return
    }
    this.syncEntity.sendEvent(RELAY_EVT_PASS_REQUEST, {
      itemId: itemId,
      connectionId: this.localConnectionId
    })
  }

  /**
   * Host-only. Transfers a card from the sender to the other person in the session.
   *
   * The sender is only allowed to pass what they actually hold — checked against the
   * host's own copy of the queue, not against anything the sender asserts. With two
   * people the recipient is simply the other connection; with nobody else present the
   * pass is dropped and the card stays where it is.
   */
  private arbitratePass(itemId: string, fromConnectionId: string): void {
    if (this.syncEntity.doIOwnStore() !== true) return

    let target: WorkItem | null = null
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === itemId) {
        target = this.items[i]
        break
      }
    }
    if (target === null) return
    if (target.status !== "claimed" || target.claimed_conn !== fromConnectionId) {
      print("[Relay] Pass of " + itemId + " refused — sender does not hold it.")
      return
    }

    const users = SessionController.getInstance().getUsers()
    let toConn: string | null = null
    let toUser: string | null = null
    for (let i = 0; i < users.length; i++) {
      const c = users[i].connectionId
      if (c && c !== fromConnectionId) {
        toConn = c
        toUser = users[i].userId ?? null
        break
      }
    }
    if (toConn === null) {
      print("[Relay] Pass of " + itemId + " dropped — nobody to pass to.")
      return
    }

    const passed: WorkItem[] = []
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      if (it.id !== itemId) {
        passed.push(it)
        continue
      }
      passed.push({
        id: it.id,
        source: it.source,
        title: it.title,
        body: it.body,
        status: "claimed",
        claimed_by: toUser,
        claimed_conn: toConn,
        priority: it.priority,
        summary: it.summary,
        translations: it.translations,
        created_at: it.created_at,
        hasPriority: it.hasPriority
      })
    }
    print("[Relay] Pass of " + itemId + " GRANTED: " + fromConnectionId + " -> " + toConn)

    this.broadcast({source: this.source, items: passed})
    this.applyQueueState(passed, this.source)
    if (toUser !== null) this.persistClaim(itemId, toUser)
  }

  /** Host-only, best effort. A lost write never blocks the claim the user just made. */
  private async persistClaim(itemId: string, userId: string): Promise<void> {
    const network = RelayHostNetwork.grantIfAuthoritative(this.syncEntity, this)
    if (network === null) return
    if (this.source !== "supabase") return
    const ok = await network.writeClaim(itemId, userId)
    print("[Relay] Claim persisted for " + itemId + ": " + ok)
  }

  private begin(): void {
    if (isNull(this.queueUI)) {
      print("[Relay] FATAL: queueUI input is not wired. Nothing can be rendered.")
      return
    }
    SessionController.getInstance().notifyOnReady(() => {
      this.syncEntity.notifyOnReady(() => this.onSyncReady())
    })
  }

  private onSyncReady(): void {
    this.syncReady = true
    this.localUserId = SessionController.getInstance().getLocalUserId() ?? null
    this.localConnectionId = SessionController.getInstance().getLocalConnectionId() ?? null
    print(
      "[Relay] identity user=" + this.localUserId + " conn=" + this.localConnectionId
    )

    // Atmosphere only — the two panes sit in different light so they read as two places.
    // Host/guest is the discriminator because it is the one fact both clients already
    // agree on without another round trip. This does NOT touch card colour: ownership
    // stays jade/lilac/mineral and stays identical on both screens.
    const warm = this.syncEntity.doIOwnStore() === true
    this.queueUI.setPaneWarm(warm)
    print("[Relay] pane atmosphere=" + (warm ? "warm (host)" : "cool (guest)"))

    // Presence: the header dot reports whether the other person is actually here.
    // Driven off SyncKit's existing join/leave events — no new traffic, no polling.
    this.refreshPresence()
    SessionController.getInstance().onUserJoinedSession.add(() => this.refreshPresence())
    SessionController.getInstance().onUserLeftSession.add(() => this.refreshPresence())

    this.queueProp.onAnyChange.add((value: string) => this.onQueuePayload(value))

    // Intent in, from this client's own hands.
    this.queueUI.onCardPinched.add((itemId: string) => this.requestClaim(itemId))
    this.queueUI.onCardHover.add((itemId: string | null) => {
      this.hoverPending = itemId
    })
    this.queueUI.onCardPassed.add((itemId: string) => this.requestPass(itemId))
    this.queueUI.onLanguagePicked.add((code: string) => this.setLanguage(code))

    // Intent and decisions in, from the wire.
    this.syncEntity.onEventReceived.add(RELAY_EVT_CLAIM_REQUEST, (msg) => {
      const d = msg.data as {itemId?: string; userId?: string; connectionId?: string}
      if (d && typeof d.itemId === "string" && typeof d.userId === "string") {
        this.arbitrate(d.itemId, d.userId, typeof d.connectionId === "string" ? d.connectionId : "")
      }
    })
    this.syncEntity.onEventReceived.add(RELAY_EVT_CLAIM_DENIED, (msg) => {
      const d = msg.data as {itemId?: string; connectionId?: string}
      if (d && typeof d.itemId === "string" && d.connectionId === this.localConnectionId) {
        this.queueUI.flashDenied(d.itemId as string, "claimed by partner")
      }
    })
    this.syncEntity.onEventReceived.add(RELAY_EVT_PASS_REQUEST, (msg) => {
      const d = msg.data as {itemId?: string; connectionId?: string}
      if (d && typeof d.itemId === "string" && typeof d.connectionId === "string") {
        this.arbitratePass(d.itemId, d.connectionId)
      }
    })
    this.syncEntity.onEventReceived.add(RELAY_EVT_LANGUAGE, (msg) => {
      const d = msg.data as {connectionId?: string; lang?: string}
      if (!d || typeof d.lang !== "string") return
      if (d.connectionId === this.localConnectionId) return
      this.queueUI.setPartnerLanguage(d.lang)
    })
    this.syncEntity.onEventReceived.add(RELAY_EVT_TRANSLATE_REQUEST, (msg) => {
      const d = msg.data as {lang?: string}
      if (d && typeof d.lang === "string") this.ensureTranslations(d.lang)
    })
    this.syncEntity.onEventReceived.add(RELAY_EVT_HOVER, (msg) => {
      const d = msg.data as {itemId?: string | null}
      if (!d) return
      this.queueUI.setHoverHighlight(null, false)
      if (typeof d.itemId === "string") this.queueUI.setHoverHighlight(d.itemId, true)
    })

    // A late joiner receives the current snapshot rather than replaying events.
    const existing = this.queueProp.currentOrPendingValue
    if (existing && existing !== "") this.onQueuePayload(existing)

    this.announceLanguage()
    this.tryBecomeAuthority()
    this.armGuestWatchdog()
  }

  // ---------------------------------------------------------------------------
  // Host authority
  // ---------------------------------------------------------------------------

  private tryBecomeAuthority(): void {
    if (this.authorityHandled || !this.syncReady) return
    if (this.syncEntity.doIOwnStore() !== true) return
    this.authorityHandled = true
    print("[Relay] This client is the host. Fetching the queue from Supabase.")
    this.loadAsAuthority()
  }

  private async loadAsAuthority(): Promise<void> {
    // The ONLY place a network handle is ever granted. grantIfAuthoritative re-tests
    // ownership against the live SyncEntity, so this cannot succeed for a guest even if
    // the call were reached out of order.
    const network = RelayHostNetwork.grantIfAuthoritative(this.syncEntity, this)
    if (network === null) return

    let items: WorkItem[]
    let source: QueueSource

    try {
      items = await network.fetchOpenWorkItems()
      source = "supabase"
      if (items.length === 0) {
        // Deliberately NOT the fallback path. The queue really is clear, and saying so
        // is the honest answer; fallback items here would be fabricated work.
        print("[Relay] Supabase returned zero open work items. The queue is clear.")
      }
      if (items.length > 0) print("[Relay] Supabase returned " + items.length + " open work items:")
      for (let i = 0; i < items.length; i++) {
        print(
          "[Relay]   p" +
            items[i].priority +
            "  [" +
            items[i].source +
            "]  " +
            items[i].title
        )
      }
    } catch (error) {
      items = RELAY_FALLBACK_ITEMS
      source = "fallback"
      print("[Relay] Supabase fetch failed (" + error + ").")
      print("[Relay] Falling back to " + items.length + " local work items:")
      for (let i = 0; i < items.length; i++) {
        print(
          "[Relay]   p" +
            items[i].priority +
            "  [" +
            items[i].source +
            "]  " +
            items[i].title
        )
      }
    }

    // Render and broadcast BEFORE the AI call. Triage refines a queue the user is
    // already looking at; it never gates the first paint.
    this.broadcast({source: source, items: items})
    this.applyQueueState(items, source)

    await this.triageAndRefine(network, items, source)
    this.armPoll()
  }

  // ---------------------------------------------------------------------------
  // Language — a local choice over shared data
  // ---------------------------------------------------------------------------

  /**
   * Switch what THIS client reads in.
   *
   * The re-render is immediate and local: the queue, its order and its ownership do not
   * move, only the glyphs. If the language has no cached text yet, the fill is requested
   * in the background and arrives as a normal broadcast — the user reads English in the
   * meantime rather than watching a spinner.
   */
  private setLanguage(code: string): void {
    this.localLanguage = code
    this.queueUI.setLanguage(code)
    this.announceLanguage()

    if (isSourceLanguage(code)) return
    if (!this.anyItemNeeds(code)) {
      print("[Relay] Language " + code + " served from cache — no Gemini call.")
      return
    }
    if (this.syncEntity.doIOwnStore() === true) {
      this.ensureTranslations(code)
      return
    }
    this.syncEntity.sendEvent(RELAY_EVT_TRANSLATE_REQUEST, {lang: code})
  }

  /** Identity, not state: the partner shows this as a single quiet line. */
  private announceLanguage(): void {
    if (!this.syncReady) return
    this.syncEntity.sendEvent(
      RELAY_EVT_LANGUAGE,
      {connectionId: this.localConnectionId, lang: this.localLanguage},
      /* onlySendRemote */ true
    )
  }

  private anyItemNeeds(code: string): boolean {
    for (let i = 0; i < this.items.length; i++) {
      if (needsTranslation(this.items[i], code)) return true
    }
    return false
  }

  /**
   * Host-only. Fill one language for the whole queue in a single call, then keep it.
   *
   * Lazy: nothing is translated until somebody picks the language. Batched: one request
   * for every item that lacks it, so the set reads in one register. Permanent: written
   * back to the translations column, so this is the only time it is ever paid for.
   */
  private async ensureTranslations(code: string): Promise<void> {
    if (isSourceLanguage(code)) return
    if (this.translateInFlight[code]) return

    const translator = RelayTranslate.grantIfAuthoritative(this.syncEntity, this)
    if (translator === null) return

    const pending: TranslationResult[] = []
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      if (needsTranslation(it, code)) pending.push({id: it.id, text: headlineOf(it)})
    }
    if (pending.length === 0) {
      print("[Relay] Language " + code + " already complete — nothing to translate.")
      return
    }

    this.translateInFlight[code] = true
    const language = languageByCode(code)
    print("[Relay] Translating " + pending.length + " headlines into " + language.label + "...")

    let results: TranslationResult[]
    try {
      results = await translator.translate(pending, language)
    } catch (error) {
      // English stays on screen. Nothing blanks, nothing errors.
      print("[Relay] Translation into " + code + " failed (" + error + "). Keeping English.")
      this.translateInFlight[code] = false
      return
    }

    const byId: {[id: string]: string} = {}
    for (let i = 0; i < results.length; i++) byId[results[i].id] = results[i].text

    const next: WorkItem[] = []
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      const t = byId[it.id]
      next.push(t ? withTranslation(it, code, t) : it)
    }
    print("[Relay] Gemini returned " + results.length + " " + code + " lines.")

    this.items = next
    this.broadcast({source: this.source, items: next})
    this.applyQueueState(next, this.source)

    const network = RelayHostNetwork.grantIfAuthoritative(this.syncEntity, this)
    if (network !== null && this.source === "supabase") {
      let written = 0
      for (let i = 0; i < next.length; i++) {
        const it = next[i]
        if (!byId[it.id] || it.translations === null) continue
        const ok = await network.writeTranslations(it.id, it.translations)
        if (ok) written++
      }
      print("[Relay] Persisted " + written + " " + code + " translations to Supabase.")
    }
    this.translateInFlight[code] = false
  }

  // ---------------------------------------------------------------------------
  // Incoming rows — host polls, host broadcasts, guest never polls
  // ---------------------------------------------------------------------------

  /**
   * Re-arming interval rather than a repeating timer, so a slow request can never stack
   * up behind itself. Plain REST every RELAY_POLL_MS; no realtime socket to keep alive.
   */
  private armPoll(): void {
    if (this.pollArmed) return
    this.pollArmed = true
    this.scheduleNextPoll()
  }

  private scheduleNextPoll(): void {
    const ev = this.createEvent("DelayedCallbackEvent")
    ev.bind(() => {
      this.pollOnce()
    })
    ev.reset(RELAY_POLL_MS / 1000)
  }

  private async pollOnce(): Promise<void> {
    // Ownership can move; re-check every time rather than trusting the arm-time answer.
    const network = RelayHostNetwork.grantIfAuthoritative(this.syncEntity, this)
    if (network === null) {
      this.scheduleNextPoll()
      return
    }
    try {
      const fetched = await network.fetchOpenWorkItems()
      const merged = this.mergeFetched(fetched)
      if (merged !== null) {
        print("[Relay] Poll: queue changed, " + merged.length + " items after merge.")
        this.broadcast({source: "supabase", items: merged})
        this.applyQueueState(merged, "supabase")
        await this.triageAndRefine(network, merged, "supabase")
      }
    } catch (error) {
      // A failed poll is a non-event: the queue on screen is still the last good one.
      print("[Relay] Poll failed (" + error + "). Keeping the current queue.")
    }
    this.scheduleNextPoll()
  }

  /**
   * Fold a fresh fetch of OPEN rows into what this client already knows.
   *
   * Returns the merged list only if something actually changed, so an unchanged queue
   * costs one request and no broadcast.
   *
   * Claimed items are deliberately preserved: the endpoint filters to status=open, so a
   * card someone just took is absent from the fetch — and a naive replace would resurrect
   * it into the arc, briefly, on every poll. It also protects the window between a local
   * claim and its PATCH landing, where the row still reads 'open' in Postgres.
   */
  private mergeFetched(fetched: WorkItem[]): WorkItem[] | null {
    const known: {[id: string]: WorkItem} = {}
    for (let i = 0; i < this.items.length; i++) known[this.items[i].id] = this.items[i]

    const merged: WorkItem[] = []
    const seen: {[id: string]: boolean} = {}
    let changed = false

    for (let i = 0; i < fetched.length; i++) {
      const row = fetched[i]
      seen[row.id] = true
      const mine = known[row.id]
      if (!mine) {
        merged.push(row)
        changed = true
        continue
      }
      // Never let an open row from the server overwrite a claim this session made.
      merged.push(mine.status === "claimed" ? mine : row)
    }

    // Anything claimed is kept even though the fetch cannot return it.
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      if (seen[it.id]) continue
      if (it.status === "claimed") {
        merged.push(it)
        continue
      }
      // An open row that has vanished server-side is genuinely gone.
      changed = true
    }

    return changed ? merged : null
  }

  // ---------------------------------------------------------------------------
  // Gemini triage
  // ---------------------------------------------------------------------------

  /**
   * Triage whatever is not already triaged, then re-broadcast and re-render.
   *
   * Every failure path here is a no-op on the visible scene: the queue that was painted
   * before this ran stays exactly as it is. Triage can only ever improve the view.
   */
  private async triageAndRefine(
    network: RelayHostNetwork,
    items: WorkItem[],
    source: QueueSource
  ): Promise<void> {
    const pending = items.filter((it) => needsTriage(it))
    if (pending.length === 0) {
      print(
        "[Relay] All " + items.length + " items already carry priority and summary. " +
          "Skipping Gemini entirely."
      )
      return
    }
    print(
      "[Relay] " + pending.length + " of " + items.length +
        " items need triage; " + (items.length - pending.length) + " served from cache."
    )

    const triage = RelayTriage.grantIfAuthoritative(this.syncEntity, this)
    if (triage === null) return

    let verdicts
    try {
      verdicts = await triage.triage(pending)
    } catch (error) {
      print("[Relay] Triage failed (" + error + "). Keeping existing priorities.")
      return
    }

    const byId: {[id: string]: {priority: number; summary: string}} = {}
    for (let i = 0; i < verdicts.length; i++) byId[verdicts[i].id] = verdicts[i]

    const refined: WorkItem[] = []
    for (let i = 0; i < items.length; i++) {
      const v = byId[items[i].id]
      refined.push(v ? withTriage(items[i], v.priority, v.summary) : items[i])
    }

    const spread: number[] = []
    for (let i = 0; i < refined.length; i++) spread.push(refined[i].priority)
    print("[Relay] Gemini returned " + verdicts.length + " verdicts. Priorities: " + spread.join(", "))
    for (let i = 0; i < refined.length; i++) {
      if (byId[refined[i].id]) {
        print("[Relay]   p" + refined[i].priority + "  " + refined[i].summary)
      }
    }

    this.broadcast({source: source, items: refined})
    this.applyQueueState(refined, source)

    // Persist last, and only for rows that actually exist in Supabase. A failed write
    // costs a re-triage next run; it must never touch what is already on screen.
    if (source !== "supabase") {
      print("[Relay] Fallback data is not persisted — nothing to write back.")
      return
    }
    let written = 0
    for (let i = 0; i < refined.length; i++) {
      const item = refined[i]
      if (!byId[item.id]) continue
      const ok = await network.writeTriage(item.id, item.priority, item.summary as string)
      if (ok) written++
    }
    print("[Relay] Persisted " + written + " of " + verdicts.length + " triage results to Supabase.")
  }

  /** Host-only write. A non-owner's setPendingValue would be silently dropped anyway. */
  private broadcast(payload: QueuePayload): void {
    if (this.syncEntity.doIOwnStore() !== true) return
    try {
      this.queueProp.setPendingValue(JSON.stringify(payload))
    } catch (error) {
      print("[Relay] Could not encode the queue for broadcast: " + error)
    }
  }

  // ---------------------------------------------------------------------------
  // Receiving + rendering
  // ---------------------------------------------------------------------------

  private onQueuePayload(raw: string): void {
    if (!raw || raw === "") return
    let decoded: {source?: unknown; items?: unknown}
    try {
      decoded = JSON.parse(raw)
    } catch (error) {
      print("[Relay] Ignoring an unreadable queue broadcast: " + error)
      return
    }
    // An empty ITEMS ARRAY is a legitimate state — the queue is clear, and the guest
    // must show that. Only a payload with no items array at all is unreadable.
    if (!Array.isArray(decoded.items)) {
      print("[Relay] Ignoring a queue broadcast with no items array.")
      return
    }
    const items = parseWorkItems(decoded.items)
    const source: QueueSource = decoded.source === "supabase" ? "supabase" : "fallback"
    this.applyQueueState(items, source)
  }

  /**
   * Take a new authoritative queue and make the view agree with it.
   *
   * The claim ANIMATIONS are driven by diffing this state against the last one, not by
   * the claim message itself. That is deliberate: host and guest run identical code, so
   * a card cannot animate on one client and silently fail to on the other.
   */
  /** Partner present = more than just me in the session. Brightness only, no new hue. */
  private refreshPresence(): void {
    const users = SessionController.getInstance().getUsers()
    const present = users !== null && users.length > 1
    this.queueUI.setPartnerPresent(present)
    print("[Relay] partner present=" + present + " users=" + (users ? users.length : 0))
  }

  private applyQueueState(items: WorkItem[], source: QueueSource): void {
    const prevStatus: {[id: string]: string} = {}
    const prevConn: {[id: string]: string | null} = {}
    for (let i = 0; i < this.items.length; i++) {
      prevStatus[this.items[i].id] = this.items[i].status
      prevConn[this.items[i].id] = this.items[i].claimed_conn
    }

    const jade = hexToVec4(RELAY_HEX_YOURS, 1)
    const lilac = hexToVec4(RELAY_HEX_PARTNERS, 1)

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.status !== "claimed") continue
      const mine = it.claimed_conn !== null && it.claimed_conn === this.localConnectionId

      if (prevStatus[it.id] === "open") {
        if (mine) {
          // Mine: it lifts out of the arc and settles into my lane, in jade.
          this.queueUI.claimToLane(it.id, jade)
        } else {
          // Theirs: it dissolves upward in their colour and is gone. The vanish is
          // the message; the lilac is what says who took it.
          this.queueUI.dissolveForPartner(it.id, lilac)
        }
        continue
      }

      // Already claimed, but by someone else than before: a direct pass.
      if (prevStatus[it.id] === "claimed" && prevConn[it.id] !== it.claimed_conn) {
        if (mine) {
          this.queueUI.receiveToLane(it, jade, Date.now())
        } else if (prevConn[it.id] === this.localConnectionId) {
          this.queueUI.passAway(it.id, lilac)
        }
      }
    }

    this.items = items
    this.source = source
    this.render(items, source)
  }


  private render(items: WorkItem[], source: QueueSource): void {
    // Only OPEN items occupy the arc. A claimed card has left the queue — for its
    // claimer it lives in the lane, for the partner it no longer exists at all.
    const open: WorkItem[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "open") open.push(items[i])
    }
    items = open

    const placements = computePlacements(
      items,
      {
        arcSpanDegrees: this.arcSpanDegrees,
        nearDistanceCm: this.nearDistanceCm,
        farDistanceCm: this.farDistanceCm,
        minHeightCm: this.minHeightCm,
        maxHeightCm: this.maxHeightCm,
        cardWidthCm: RELAY_CARD_WIDTH_CM,
        maxVisibleCards: this.maxVisibleCards
      },
      Date.now()
    )

    // Connection id, not user id — colour must distinguish the two panes.
    this.queueUI.setCards(placements, this.localConnectionId)

    const live = source === "supabase"
    if (items.length === 0) {
      // A true empty state, never fallback data wearing a queue's clothes.
      this.queueUI.setStatus("Queue clear - no open work", live)
    } else {
      const hidden = items.length - placements.length
      const shown = hidden > 0 ? placements.length + " of " + items.length : String(items.length)
      this.queueUI.setStatus(
        shown + (live ? " items - live from Supabase" : " items - local fallback"),
        live
      )
    }
    // The header's counter reads from the layout, not from the sentence above.
    this.queueUI.setQueueCounts(placements.length, items.length)
    this.hasRendered = true
  }

  /**
   * A guest that never hears a broadcast still gets a working scene. This renders the
   * LOCAL dataset — it is not a network call, so host authority is not violated.
   * The wait deliberately exceeds the host's 20 s request timeout.
   */
  private armGuestWatchdog(): void {
    const watchdog = this.createEvent("DelayedCallbackEvent")
    watchdog.bind(() => {
      if (this.hasRendered) return
      print("[Relay] No queue broadcast arrived in time. Rendering the local dataset.")
      this.applyQueueState(RELAY_FALLBACK_ITEMS, "fallback")
    })
    watchdog.reset(this.guestWaitSeconds)
  }
}
