/**
 * LeafIndex — the scenarios LEAF can run against Relay.
 *
 * Ordering matters: the queue scenario asserts a populated arc, and the claim scenario
 * consumes cards out of it. Empty-state is listed last because it requires a database
 * state the others would fail against.
 */

import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"

import {RelayClaimScenario} from "./RelayClaimScenario"
import {RelayEmptyStateScenario} from "./RelayEmptyStateScenario"
import {RelayLanguageScenario} from "./RelayLanguageScenario"
import {RelayQueueScenario} from "./RelayQueueScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "relay-queue-renders", typename: RelayQueueScenario.getTypeName()},
    {id: "relay-language-chip", typename: RelayLanguageScenario.getTypeName()},
    {id: "relay-claim-three", typename: RelayClaimScenario.getTypeName()},
    {id: "relay-empty-state", typename: RelayEmptyStateScenario.getTypeName()}
  ]
}
