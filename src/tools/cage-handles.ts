import type { Vec } from "../geom/vec";
import type { Cage } from "../geom/warp";

/** Spec M14 §5: what a press on the cage grabs — one of the four corners, or one of an edge's two
 *  handles (in the edge's own direction, see `Cage`). */
export type CagePart =
  { kind: "corner"; i: 0 | 1 | 2 | 3 } | { kind: "handle"; edge: 0 | 1 | 2 | 3; j: 0 | 1 };

type EdgeIndex = 0 | 1 | 2 | 3;
type HandleIndex = 0 | 1;
const QUAD = [0, 1, 2, 3] as const;

/** Plan ruling 4: the two near handles a corner carries. P00 → Top 0, Left 0; P10 → Top 1,
 *  Right 0; P11 → Right 1, Bottom 1; P01 → Bottom 0, Left 1. */
const CORNER_HANDLES: readonly (readonly [EdgeIndex, HandleIndex])[][] = [
  [
    [0, 0],
    [3, 0],
  ],
  [
    [0, 1],
    [1, 0],
  ],
  [
    [1, 1],
    [2, 1],
  ],
  [
    [2, 0],
    [3, 1],
  ],
];

/** The corner each handle hangs from: edge `[start corner, end corner]`, in the edge's own
 *  direction — Top P00→P10, Right P10→P11, Bottom P01→P11, Left P00→P01. */
const EDGE_CORNERS: readonly (readonly [EdgeIndex, EdgeIndex])[] = [
  [0, 1],
  [1, 2],
  [3, 2],
  [0, 3],
];

/** The corner a handle belongs to — the pivot a Shift-drag of it turns about (plan ruling 4). */
export function handleCorner(cage: Cage, edge: EdgeIndex, j: HandleIndex): Vec {
  return cage.corners[EDGE_CORNERS[edge][j]];
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Plan ruling 5: corners first, the nearest within `tol`; then handles, the nearest within `tol`.
 *  No small-object padding — a handle that sits on a corner loses to it. */
export function pickCage(cage: Cage, p: Vec, tol: number): CagePart | null {
  let best: CagePart | null = null;
  let bestD = tol;
  for (const i of QUAD) {
    const d = dist(cage.corners[i], p);
    if (d <= bestD) {
      best = { kind: "corner", i };
      bestD = d;
    }
  }
  if (best) return best;
  for (const edge of QUAD) {
    for (const j of [0, 1] as const) {
      const d = dist(cage.edges[edge][j], p);
      if (d <= bestD) {
        best = { kind: "handle", edge, j };
        bestD = d;
      }
    }
  }
  return best;
}

/** Plan ruling 4: a corner moves by `to − from` and carries its two adjacent near handles by the
 *  same delta; a handle is set to `to` alone. Returns a new cage; `cage` is untouched. */
export function moveCagePart(cage: Cage, part: CagePart, to: Vec, from: Vec): Cage {
  const edges = cage.edges.map((e): [Vec, Vec] => [e[0], e[1]]);
  const asEdges = (): Cage["edges"] => [edges[0], edges[1], edges[2], edges[3]];
  if (part.kind === "handle") {
    edges[part.edge][part.j] = to;
    return { corners: cage.corners, edges: asEdges() };
  }
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const shift = (v: Vec): Vec => ({ x: v.x + dx, y: v.y + dy });
  for (const [edge, j] of CORNER_HANDLES[part.i]) edges[edge][j] = shift(edges[edge][j]);
  const corners = [...cage.corners] as [Vec, Vec, Vec, Vec];
  corners[part.i] = shift(corners[part.i]);
  return { corners, edges: asEdges() };
}
