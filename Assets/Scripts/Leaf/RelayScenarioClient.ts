/**
 * RelayScenarioClient — runs the LEAF scenarios from inside the Lens.
 *
 * WHY THIS EXISTS
 * The LeafPlugin's panel widget will not initialize in this Lens Studio session, so
 * `run_leaf_scenario` fails with "Widget is not initialized" before any scenario starts.
 * `DefaultScenarioManager` is the same Lens-side manager the panel drives; calling it
 * directly runs the identical scenarios and writes the identical pass/fail lines to the
 * log, without depending on the panel.
 *
 * Disabled by default. Enable this SceneObject to run the suite; leave it disabled for
 * the demo build so the scenarios never fire during a recording.
 */

import {DefaultScenarioManager} from "Leaf.lspkg/Scenarios/scenario/manager/DefaultLeafScenarioManager"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"

@component
export class RelayScenarioClient extends BaseScriptComponent {
  @input
  @hint("Scenario ids to run, in order. Empty runs every registered scenario.")
  scenarioIds: string[] = []

  private scenarioManager = DefaultScenarioManager.getInstance()

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.runAll()
        .then(() => print("[RELAY-LEAF] ===== suite finished ====="))
        .catch((e) => print("[RELAY-LEAF] ===== suite aborted: " + e + " ====="))
    })
  }

  private async runAll(): Promise<void> {
    // Let the Lens settle before the first reset so the start menu is actually present.
    await sleep(2000)

    const ids =
      this.scenarioIds && this.scenarioIds.length > 0
        ? this.scenarioIds
        : this.scenarioManager.listScenarioIds()

    print("[RELAY-LEAF] running " + ids.length + " scenario(s)")

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      print("[RELAY-LEAF] >>> START " + id)
      try {
        await this.scenarioManager.startScenario(id)
        print("[RELAY-LEAF] <<< PASS  " + id)
      } catch (error) {
        // Keep going: one failing assertion should not hide the state of the rest.
        print("[RELAY-LEAF] <<< FAIL  " + id + " :: " + error)
      }
      await sleep(1500)
    }
  }
}
