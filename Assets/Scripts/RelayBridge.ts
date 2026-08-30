/**
 * RelayBridge — the ribbon a passed card rides between two people.
 *
 * OWNS:      the swept mesh, its material, and the crossing's lifecycle.
 * EXPECTS:   to be told a pass started, with the card's origin and destination.
 * MUST NOT:  touch pass logic, ownership transfer or targeting. It REACTS to the same
 *            event the card already animates on; deleting it would change nothing about
 *            how a pass behaves.
 *
 * WHY A SWEPT MESH AND NOT BEADS
 * The first version strung 22 small quads along the curve. At distance that reads as a
 * dotted line — the gaps between beads are visible, the "beam" has no continuous surface,
 * and it looks exactly as cheap as it is. A ribbon is one continuous strip of geometry
 * with real UVs, so the gradient, the wake and the leading pulse are all sampled smoothly
 * across a surface rather than quantised to 22 points.
 *
 * WHY GEOMETRY AND NOT LIGHT
 * Five sessions established this preview will not render soft light. The ribbon is an
 * ordinary alpha-blended surface; nothing about it depends on bloom.
 */

import {
  RELAY_BRIDGE_BOW_CM,
  RELAY_BRIDGE_BOW_NEAR,
  RELAY_BRIDGE_FADE_MS,
  RELAY_BRIDGE_PULSE_LEAD,
  RELAY_BRIDGE_PULSE_WIDTH,
  RELAY_BRIDGE_SEGMENTS,
  RELAY_BRIDGE_SPRING_MS,
  RELAY_BRIDGE_WIDTH_CM,
  easeOut
} from "./RelayConfig"

const RIBBON_MATERIAL: Material = requireAsset("../Materials/relay_ribbon.mat") as Material

/**
 * A point on the bridge. Shared with the card so the sheet rides the ribbon EXACTLY — if
 * the card used its own curve the two would drift apart and the illusion would die.
 */
export function bridgePoint(from: vec3, to: vec3, t: number, bow: number): vec3 {
  const k = Math.sin(Math.PI * (t < 0 ? 0 : t > 1 ? 1 : t))
  return new vec3(
    from.x + (to.x - from.x) * t,
    from.y + (to.y - from.y) * t + bow * k,
    from.z + (to.z - from.z) * t + bow * RELAY_BRIDGE_BOW_NEAR * k
  )
}

export class RelayBridge {
  private obj: SceneObject | null = null
  private visual: RenderMeshVisual | null = null
  private mat: Material | null = null
  private builder: MeshBuilder | null = null

  private active = false
  private startMs = 0
  private durMs = 0

  private built = false

  constructor(private readonly parent: SceneObject) {}

  public build(): void {
    if (this.built || isNull(this.parent)) return
    this.built = true

    const obj = global.scene.createSceneObject("RelayBridgeRibbon")
    obj.setParent(this.parent)
    obj.enabled = false
    this.obj = obj

    this.visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.mat = RIBBON_MATERIAL.clone()
    this.visual.clearMaterials()
    this.visual.addMaterial(this.mat)
  }

  public bow(): number {
    return RELAY_BRIDGE_BOW_CM
  }

  /**
   * Sweep a fresh ribbon along this crossing.
   *
   * The mesh is rebuilt per pass rather than deformed, because only one pass is ever in
   * flight and a 2 x 26 vertex strip is cheaper to regenerate than to skin.
   */
  private sweep(from: vec3, to: vec3): void {
    const n = RELAY_BRIDGE_SEGMENTS
    const builder = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3},
      {name: "texture0", components: 2}
    ])
    builder.topology = MeshTopology.Triangles
    builder.indexType = MeshIndexType.UInt16

    const verts: number[] = []
    const indices: number[] = []

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const p = bridgePoint(from, to, t, RELAY_BRIDGE_BOW_CM)

      // Tangent by sampling slightly ahead, so the ribbon's width is always perpendicular
      // to the direction of travel rather than to the straight chord.
      const ahead = bridgePoint(from, to, Math.min(t + 0.02, 1), RELAY_BRIDGE_BOW_CM)
      const tx = ahead.x - p.x
      const ty = ahead.y - p.y
      const len = Math.sqrt(tx * tx + ty * ty) || 1

      // Perpendicular in the vertical plane: the ribbon presents its face to the viewer
      // rather than its edge, which is what a flat strip in world Z would do.
      const rx = -ty / len
      const ry = tx / len

      // Tapered: full width through the middle, drawn to a point at both ends, so the
      // ribbon enters and leaves the world rather than starting as a blunt rectangle.
      const taper = Math.sin(Math.PI * t)
      const w = (RELAY_BRIDGE_WIDTH_CM * (0.25 + 0.75 * taper)) / 2

      verts.push(p.x + rx * w, p.y + ry * w, p.z, 0, 0, 1, t, 0)
      verts.push(p.x - rx * w, p.y - ry * w, p.z, 0, 0, 1, t, 1)

      if (i < n - 1) {
        const b = i * 2
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
      }
    }

    builder.appendVerticesInterleaved(verts)
    builder.appendIndices(indices)
    builder.updateMesh()
    this.builder = builder
    if (this.visual !== null) this.visual.mesh = builder.getMesh()
  }

  /** A pass has begun. One ribbon at a time — a second crossing replaces the first. */
  public spring(from: vec3, to: vec3, jade: vec4, lilac: vec4, travelMs: number, now: number): void {
    if (this.obj === null || this.mat === null) return
    this.sweep(from, to)

    this.active = true
    this.startMs = now
    this.durMs = travelMs + RELAY_BRIDGE_FADE_MS
    this.obj.enabled = true

    const m = this.mat.mainPass as any
    m.jade = jade
    m.lilac = lilac
    m.progress = 0
    m.fade = 0
    m.pulseWidth = RELAY_BRIDGE_PULSE_WIDTH
  }

  public tick(now: number): void {
    if (!this.active || this.obj === null || this.mat === null) return

    const life = (now - this.startMs) / this.durMs
    if (life >= 1) {
      this.active = false
      this.obj.enabled = false
      return
    }

    const travel = (this.durMs - RELAY_BRIDGE_FADE_MS) / this.durMs
    // The card's own progress, on the same easing its tween uses.
    const cardT = easeOut(life / travel)
    // The pulse runs ahead of it, so the eye reaches the destination first.
    const progress = Math.min(cardT + RELAY_BRIDGE_PULSE_LEAD, 1)

    // Springs in over the first moments, holds, then dissolves once the card has landed.
    const springIn = easeOut(life / (RELAY_BRIDGE_SPRING_MS / this.durMs))
    const out = life > travel ? 1 - easeOut((life - travel) / (1 - travel)) : 1
    const fade = Math.min(springIn, 1) * out

    const m = this.mat.mainPass as any
    m.progress = progress
    m.fade = fade
  }
}
