/**
 * RelaySlab — the box mesh that turns a card from a billboard into an object.
 *
 * OWNS:      one shared box RenderMesh, built once.
 * MUST NOT:  touch the card's face. The BackPlate, its text, border, collider and
 *            Interactable are all load-bearing and verified; this is a BODY placed behind
 *            them, never a replacement.
 *
 * WHY REAL GEOMETRY
 * Five sessions established that this preview will not render soft light — every glow,
 * beam and pool came back as a flat white blob. It renders solid form, depth and motion
 * perfectly. So depth is built rather than implied: an actual six-sided box with actual
 * normals, whose sides become visible as the viewer's head moves. Nothing about it
 * depends on bloom.
 *
 * ONE MESH, MANY CARDS
 * The box is unit-sized and scaled per card, so five slabs plus the lane share a single
 * RenderMesh and a single draw setup. Building a mesh per card would be the obvious way
 * and the wrong one.
 */

/** Half-extents of the unit box: 1 x 1 x 1 centred on the origin, scaled by the caller. */
function unitBox(): RenderMesh {
  const builder = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3},
    {name: "texture0", components: 2}
  ])
  builder.topology = MeshTopology.Triangles
  builder.indexType = MeshIndexType.UInt16

  const h = 0.5
  // Six faces, four verts each. Faces are NOT shared between sides: a shared vertex would
  // have to average two perpendicular normals, and the whole effect depends on each face
  // reporting its own direction so the shader can tell a face from an edge.
  // Two parallel arrays instead of one nested one: a mixed [normal, corners] tuple makes
  // TypeScript infer a single element type across a vec3 and an array of vec3s.
  const normals: number[][] = [
    [0, 0, 1],  // front
    [0, 0, -1], // back
    [1, 0, 0],  // right
    [-1, 0, 0], // left
    [0, 1, 0],  // top
    [0, -1, 0]  // bottom
  ]
  const quads: number[][][] = [
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
    [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]],
    [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]],
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
    [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]],
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]]
  ]

  const uv: number[][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const verts: number[] = []
  const indices: number[] = []

  for (let f = 0; f < quads.length; f++) {
    const n = normals[f]
    const corners = quads[f]
    const base = f * 4
    for (let c = 0; c < 4; c++) {
      const p = corners[c]
      verts.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[c][0], uv[c][1])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  builder.appendVerticesInterleaved(verts)
  builder.appendIndices(indices)
  builder.updateMesh()
  return builder.getMesh()
}

let SHARED: RenderMesh | null = null

/** The one box every slab uses. Built on first request, reused forever after. */
export function slabMesh(): RenderMesh {
  if (SHARED === null) SHARED = unitBox()
  return SHARED
}
