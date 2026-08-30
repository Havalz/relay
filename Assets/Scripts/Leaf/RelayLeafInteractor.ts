/**
 * RelayLeafInteractor — shared actions the Relay scenarios perform.
 *
 * Kept separate from the scenarios so the "how do I claim a card" knowledge lives in one
 * place: several scenarios claim, and they must all claim the same way.
 */

import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractablesByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {findSceneObjectsByName, sleep} from "Leaf.lspkg/Utils/common/Utils"

import {RELAY_LANE_Y_CM} from "../RelayConfig"

/**
 * Lane cards sit at this world height; arc cards never do.
 *
 * IMPORTED, NOT COPIED. This was a hand-written -24 duplicating the config, and when the
 * lane moved down to clear the arc the test silently stopped recognising lane cards: the
 * claim still worked, the assertion still failed, and the failure pointed at claiming
 * rather than at the test. A test that keeps its own copy of a layout constant does not
 * test the layout, it tests the copy.
 */
export const LANE_Y_CM = RELAY_LANE_Y_CM
const LANE_Y_TOLERANCE = 1.5

export class RelayLeafInteractor extends DefaultLeafInteractor {
  /** Every card object currently in the scene, arc and lane alike. */
  public allCards(): SceneObject[] {
    return findSceneObjectsByName("RelayCard").filter((o) => o.enabled)
  }

  /**
   * Cards still in the queue. A lane card is excluded by HEIGHT rather than by a flag:
   * the lane is the only place a card sits at y = -24, and the test should assert on
   * what is actually on screen rather than on internal state it cannot see.
   */
  public arcCards(): SceneObject[] {
    return this.allCards().filter(
      (o) => Math.abs(o.getTransform().getWorldPosition().y - LANE_Y_CM) > LANE_Y_TOLERANCE
    )
  }

  public laneCards(): SceneObject[] {
    return this.allCards().filter(
      (o) => Math.abs(o.getTransform().getWorldPosition().y - LANE_Y_CM) <= LANE_Y_TOLERANCE
    )
  }

  /**
   * LEAF resets the Lens before every scenario, which lands it on the SIK start menu with
   * no session and therefore no queue. Every scenario has to get past that first.
   *
   * Idempotent: if the queue is already up, this does nothing.
   */
  public async ensureSession(): Promise<void> {
    if (this.allCards().length > 0) return
    const start = findInteractablesByName("MultiplayerButton", undefined, true)[0]
    if (!start) return
    await this.trigger(start)
    // Session handshake, colocated setup, Supabase round trip, first paint.
    await sleep(9000)
  }

  /** Claim the card highest in the arc — the top-priority one, and always reachable. */
  public async claimTopCard(): Promise<string> {
    const cards = findInteractablesByName("RelayCard", undefined, true)
    if (cards.length === 0) throw new Error("No claimable cards in the arc")

    let best = cards[0]
    let bestY = best.sceneObject.getTransform().getWorldPosition().y
    for (let i = 1; i < cards.length; i++) {
      const y = cards[i].sceneObject.getTransform().getWorldPosition().y
      if (Math.abs(y - LANE_Y_CM) <= LANE_Y_TOLERANCE) continue // never re-grab a lane card
      if (y > bestY) {
        best = cards[i]
        bestY = y
      }
    }
    const label = this.headlineOf(best.sceneObject)
    await this.trigger(best)
    // Rise 300 + hold 90 + settle 520, plus the reflow of what is left behind.
    await sleep(1400)
    return label
  }

  /** The card's visible headline, read from its middle text row. */
  public headlineOf(card: SceneObject): string {
    let longest = ""
    for (let i = 0; i < card.getChildrenCount(); i++) {
      const child = card.getChild(i)
      for (let j = 0; j < child.getChildrenCount(); j++) {
        const row = child.getChild(j)
        const text = row.getComponent("Component.Text") as Text
        if (text && text.text.length > longest.length) longest = text.text
      }
    }
    return longest
  }

  public statusText(): string {
    const labels = findSceneObjectsByName("StatusLabel")
    for (let i = 0; i < labels.length; i++) {
      const t = labels[i].getComponent("Component.Text") as Text
      if (t) return t.text
    }
    return ""
  }
}
