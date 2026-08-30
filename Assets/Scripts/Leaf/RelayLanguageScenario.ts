/**
 * The language chip: every row must be reachable, English included.
 *
 * English is the default and the language a viewer is most likely to switch back to, so
 * it cannot be the one row the chip swallows. The bottom row used to sit 0.2 cm from the
 * chip's top edge and the pinch landed on the chip instead; this scenario is the guard
 * against that returning.
 *
 * It also covers the collapsed state being genuinely inert rather than merely invisible.
 */

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findInteractablesByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectsByName, sleep} from "Leaf.lspkg/Utils/common/Utils"

import {RelayLeafInteractor} from "./RelayLeafInteractor"

const LANGUAGE_CODES = ["en", "ar", "ku", "es", "fr", "pl"]

@component
export class RelayLanguageScenario extends Scenario {
  async run(): Promise<void> {
    const relay = new RelayLeafInteractor()
    await relay.ensureSession()
    await sleep(1500)

    // Collapsed: the rows exist but must not be targetable.
    for (let i = 0; i < LANGUAGE_CODES.length; i++) {
      const name = "RelayLangRow_" + LANGUAGE_CODES[i]
      const objs = findSceneObjectsByName(name)
      expect(objs.length).toBeGreaterThan(0)
      expect(objs[0].enabled).toBe(false)
    }

    const chip = findInteractablesByName("RelayLangChip", undefined, true)[0]
    expect(chip).toBeTruthy()

    await this.expand(relay, chip)

    // Expanded: every row enabled, and — the actual fix — every row clear of the chip's
    // hit volume. A row that overlaps the chip is unhittable.
    //
    // The menu opens DOWNWARD (RELAY_LANG_ROW_DIR = -1), so "clear of the chip" means
    // each row's TOP edge sits below the chip's BOTTOM edge. This assertion used to read
    // rowBottom > chipTop, which described an upward menu and silently stopped matching
    // the design when the drop direction was settled; it is the separation that matters,
    // not the direction, so it is now stated in the direction the menu actually opens.
    const chipPos = chip.sceneObject.getTransform().getWorldPosition()
    const chipBottom = chipPos.y - 2.6 / 2

    for (let i = 0; i < LANGUAGE_CODES.length; i++) {
      const name = "RelayLangRow_" + LANGUAGE_CODES[i]
      const objs = findSceneObjectsByName(name)
      expect(objs[0].enabled).toBe(true)

      const rowTop = objs[0].getTransform().getWorldPosition().y + 2.0 / 2
      print("[LEAF] " + name + " top=" + rowTop.toFixed(2) + " chipBottom=" + chipBottom.toFixed(2))
      expect(rowTop < chipBottom).toBe(true)
    }

    // Selecting English must actually register — this is the row that used to be lost.
    const enRow = findInteractablesByName("RelayLangRow_en", undefined, true)[0]
    expect(enRow).toBeTruthy()
    await relay.trigger(enRow)
    await sleep(800)

    // Picking a language collapses the list again.
    const after = findSceneObjectsByName("RelayLangRow_en")
    expect(after[0].enabled).toBe(false)
  }

  private async expand(relay: RelayLeafInteractor, chip): Promise<void> {
    await relay.trigger(chip)
    await sleep(600)
  }
}
