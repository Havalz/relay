/**
 * RelayHostNetwork — the ONLY code path in Relay that reaches the network.
 *
 * OWNS:      the Supabase GET, the 20-second timeout, and JSON -> WorkItem[] decoding.
 * EXPECTS:   a host BaseScriptComponent (used purely to create the timeout event).
 * MUST NOT:  be constructible by a guest client.
 *
 * HOST AUTHORITY
 * The constructor is private, and the only way to obtain an instance is to hand
 * `grantIfAuthoritative()` the live SyncEntity — which calls `doIOwnStore()` itself
 * and returns null to anyone who does not own the store. The ownership test cannot be
 * separated from the grant, so a caller cannot assert authority it does not have; a
 * guest receives null and holds no reference through which Supabase could be reached.
 * Two clients hitting the same endpoint would produce divergent state; this is the
 * mechanism that makes that unreachable.
 */

import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

import {
  RELAY_REQUEST_TIMEOUT_MS,
  relayAuthHeaders,
  relayWorkItemsUrl,
  relayWorkItemUrl
} from "./RelayConfig"
import {parseWorkItems, WorkItem} from "./RelayWorkItem"

export class RelayHostNetwork {
  private readonly internetModule: InternetModule = require("LensStudio:InternetModule")

  private constructor(private readonly host: BaseScriptComponent) {}

  /**
   * Returns a network handle ONLY to the client that owns the queue's store.
   *
   * Ownership is tested HERE, against the live SyncEntity, rather than trusted from a
   * boolean the caller supplies. A caller therefore cannot claim authority it does not
   * hold, and a future call site cannot forget to check first — the check is the grant.
   */
  public static grantIfAuthoritative(
    syncEntity: SyncEntity | null,
    host: BaseScriptComponent
  ): RelayHostNetwork | null {
    if (syncEntity === null || syncEntity === undefined) return null
    if (syncEntity.doIOwnStore() !== true) return null
    return new RelayHostNetwork(host)
  }

  /**
   * GET /rest/v1/work_items?select=*&status=eq.open
   *
   * Rejects ONLY on timeout, transport failure, or non-200 — i.e. on "I could not find
   * out what the queue contains". A successful response carrying zero rows resolves to
   * an empty array, because that is a true and useful answer: the queue is clear. The
   * caller must keep those cases apart. Substituting fallback data for an empty queue
   * would present fabricated work as real work.
   */
  public async fetchOpenWorkItems(): Promise<WorkItem[]> {
    const url = relayWorkItemsUrl()
    return await this.withTimeout(this.performFetch(url), RELAY_REQUEST_TIMEOUT_MS, url)
  }

  private async performFetch(url: string): Promise<WorkItem[]> {
    const response = await this.internetModule.fetch(url, {
      method: "GET",
      headers: relayAuthHeaders()
    })

    if (response.status !== 200) {
      throw new Error("Supabase request failed with status " + response.status)
    }

    const raw = await response.text()
    let decoded: unknown
    try {
      decoded = JSON.parse(raw)
    } catch (e) {
      throw new Error("Supabase returned a body that is not JSON")
    }

    // No zero-row throw: an empty queue is a successful answer, not a failure.
    return parseWorkItems(decoded)
  }

  /**
   * Persist one item's triage output. PATCHes ONLY priority and summary — the two
   * columns the publishable key is granted, and the only two triage may change.
   *
   * Resolves true on success and false on any failure. It deliberately does NOT throw:
   * losing the cache write is a degradation (the item gets re-triaged next run), never
   * a reason to stop rendering a queue the user is already looking at.
   */
  public async writeTriage(id: string, priority: number, summary: string): Promise<boolean> {
    const headers = relayAuthHeaders()
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=minimal"

    try {
      const response = await this.withTimeout(
        this.internetModule.fetch(relayWorkItemUrl(id), {
          method: "PATCH",
          headers: headers,
          body: JSON.stringify({priority: priority, summary: summary})
        }),
        RELAY_REQUEST_TIMEOUT_MS,
        "PATCH " + id
      )
      // PostgREST answers 204 to a return=minimal PATCH.
      if (response.status === 204 || response.status === 200) return true
      print("[Relay] Triage write rejected for " + id + " (HTTP " + response.status + ")")
      return false
    } catch (error) {
      print("[Relay] Triage write failed for " + id + ": " + error)
      return false
    }
  }

  /**
   * Persist a claim. PATCHes status + claimed_by, the other two columns the publishable
   * key is granted. Host-only by construction, like every call in this class.
   *
   * Resolves true on success, false on any failure — a lost write means the row still
   * reads 'open' in Postgres while the session shows it claimed, which the next fetch
   * corrects. It is never a reason to refuse the claim the user just made.
   */
  public async writeClaim(id: string, claimedBy: string): Promise<boolean> {
    const headers = relayAuthHeaders()
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=minimal"
    try {
      const response = await this.withTimeout(
        this.internetModule.fetch(relayWorkItemUrl(id), {
          method: "PATCH",
          headers: headers,
          body: JSON.stringify({status: "claimed", claimed_by: claimedBy})
        }),
        RELAY_REQUEST_TIMEOUT_MS,
        "PATCH claim " + id
      )
      if (response.status === 204 || response.status === 200) return true
      print("[Relay] Claim write rejected for " + id + " (HTTP " + response.status + ")")
      return false
    } catch (error) {
      print("[Relay] Claim write failed for " + id + ": " + error)
      return false
    }
  }

  /**
   * Persist one item's translations map. PATCHes only the translations column.
   *
   * Same contract as the other writes: resolves false rather than throwing. A lost
   * translation write costs one extra Gemini call next session; it is never a reason to
   * withhold text the user can already read on screen.
   */
  public async writeTranslations(
    id: string,
    translations: Record<string, unknown>
  ): Promise<boolean> {
    const headers = relayAuthHeaders()
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=minimal"
    try {
      const response = await this.withTimeout(
        this.internetModule.fetch(relayWorkItemUrl(id), {
          method: "PATCH",
          headers: headers,
          body: JSON.stringify({translations: translations})
        }),
        RELAY_REQUEST_TIMEOUT_MS,
        "PATCH translations " + id
      )
      if (response.status === 204 || response.status === 200) return true
      print("[Relay] Translation write rejected for " + id + " (HTTP " + response.status + ")")
      return false
    } catch (error) {
      print("[Relay] Translation write failed for " + id + ": " + error)
      return false
    }
  }

  /**
   * Hard 20 s ceiling on every network call. Uses a DelayedCallbackEvent rather than
   * setTimeout so the timer is owned by the Lens lifecycle and dies with the component.
   */
  private withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    const timeout = new Promise<T>((_resolve, reject) => {
      const delayed = this.host.createEvent("DelayedCallbackEvent")
      delayed.bind(() => {
        reject(new Error("Request timed out after " + timeoutMs + " ms: " + label))
      })
      delayed.reset(timeoutMs / 1000)
    })
    return Promise.race([work, timeout])
  }
}
