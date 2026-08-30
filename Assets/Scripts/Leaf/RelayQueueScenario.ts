/**
 * Does this client join the session and render the shared queue, capped at five?
 *
 * This is the single-pane half of "two panes render the same card set". LEAF runs inside
 * ONE Lens instance and cannot observe the other pane, so cross-pane equality is checked
 * by hand; what is automatable is that THIS pane joined, fetched, and honoured the cap.
 *
 * Requires the queue to have more than five open rows, so the cap is actually exercised.
 */

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"

import {RelayLeafInteractor} from "./RelayLeafInteractor"

@component
export class RelayQueueScenario extends Scenario {
  async run(): Promise<void> {
    const relay = new RelayLeafInteractor()

    await relay.ensureSession()
    await sleep(1500)

    const status = relay.statusText()
    print("[LEAF] status: " + status)

    // An empty queue is a legitimate state but not what this scenario is testing —
    // fail loudly rather than passing vacuously on zero cards.
    expect(status.includes("live from Supabase")).toBe(true)

    const arc = relay.arcCards()
    print("[LEAF] arc cards: " + arc.length)

    // The cap, not an exact count: how many are visible depends on how many are open.
    expect(arc.length).toBeGreaterThan(0)
    expect(arc.length <= 5).toBe(true)

    // Every arc card carries a headline; a blank card means the fallback chain broke.
    for (let i = 0; i < arc.length; i++) {
      const headline = relay.headlineOf(arc[i])
      expect(headline.length).toBeGreaterThan(0)
    }
  }
}
