/**
 * Claiming: three in a row, by hand, on one client.
 *
 * This is the local half of "a claim on pane A removes that card from pane B" — the
 * card leaving THIS arc and arriving in THIS lane. The partner's side of that is not
 * observable from inside one Lens instance and stays a manual check.
 *
 * It is also the regression guard for the targeting bug: destroying card SceneObjects
 * used to poison SIK's interactable cache and kill targeting for the whole client after
 * the first claim. Three consecutive claims is exactly the shape that caught it.
 */

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"

import {RelayLeafInteractor} from "./RelayLeafInteractor"

@component
export class RelayClaimScenario extends Scenario {
  async run(): Promise<void> {
    const relay = new RelayLeafInteractor()
    await relay.ensureSession()
    await sleep(1500)

    const arcBefore = relay.arcCards().length
    const laneBefore = relay.laneCards().length
    print("[LEAF] before: arc=" + arcBefore + " lane=" + laneBefore)
    expect(arcBefore).toBeGreaterThan(2)

    // Deltas, not absolutes: scenarios share Lens state and the queue may already
    // carry claims from an earlier run.
    for (let i = 0; i < 3; i++) {
      const claimed = await relay.claimTopCard()
      print("[LEAF] claim " + (i + 1) + ": " + claimed)

      const lane = relay.laneCards().length
      expect(lane).toBe(laneBefore + i + 1)
    }

    const laneAfter = relay.laneCards().length
    expect(laneAfter).toBe(laneBefore + 3)

    // Lane cards are records, not controls: each sits at the lane height and is scaled
    // down. If one is still full size it never completed its settle.
    const lane = relay.laneCards()
    for (let i = 0; i < lane.length; i++) {
      const s = lane[i].getTransform().getLocalScale()
      expect(s.x).toBeCloseTo(0.7, 1)
    }
  }
}
