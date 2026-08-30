/**
 * Zero open rows must produce a real empty state, never fabricated work.
 *
 * PRECONDITION, set from outside the Lens: every row in `work_items` is non-open.
 *   update work_items set status='claimed' where status='open';
 *
 * The Lens has no way to empty its own queue, so this scenario asserts rather than
 * arranges. Run it only against that database state; against a populated queue it will
 * fail, and that failure is correct — it means the precondition was not met.
 *
 * The distinction being guarded is a real one and was a live bug: a zero-row response
 * used to be treated as a fetch failure, which substituted the eight local fallback
 * items and presented invented work as real.
 */

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"

import {RelayLeafInteractor} from "./RelayLeafInteractor"

@component
export class RelayEmptyStateScenario extends Scenario {
  async run(): Promise<void> {
    const relay = new RelayLeafInteractor()
    await relay.ensureSession()
    await sleep(1500)

    const status = relay.statusText()
    print("[LEAF] status: " + status)

    // The empty state says so in words...
    expect(status.includes("Queue clear")).toBe(true)

    // ...and, more importantly, shows nothing.
    expect(relay.arcCards().length).toBe(0)

    // The fallback dataset must not have been substituted. Its headlines are distinctive,
    // so their absence is a direct check that no invented work reached the screen.
    const fabricated = ["Waveguide shader", "Session rejoin", "Warehouse partner"]
    const all = relay.allCards()
    for (let i = 0; i < all.length; i++) {
      const headline = relay.headlineOf(all[i])
      for (let j = 0; j < fabricated.length; j++) {
        expect(headline.includes(fabricated[j])).toBe(false)
      }
    }
  }
}
