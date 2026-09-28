import { nodeBounds } from "../geom/bounds";
import { boxCenter, unionBox, type Box } from "../geom/box";
import { inParent, multiply, type Mat } from "../geom/mat";
import type { Doc } from "./document";
import { findNode, mapNodes } from "./tree";

/** Flip horizontal / vertical (2026-09-28). */
export type FlipAxis = "h" | "v";

/** The selection's document-space bounds — the same union `selectionBounds` (tools/frame.ts)
 *  builds; `doc/` does not import `tools/`. */
function boundsOf(doc: Doc, ids: readonly string[]): Box | null {
  let box: Box | null = null;
  for (const id of ids) {
    const f = findNode(doc, id);
    if (f) box = unionBox(box, nodeBounds(f.node, f.parent));
  }
  return box;
}

/** Mirrors the selection about the centre of its bounds, in document space, by composing the
 *  mirror into each selected node's transform (converted into its parent's space, invariant 26) —
 *  the way move and rotate work, never a geometry bake. So a title stays editable (mirrored), a
 *  polygon stays live, gradients and stroke widths are untouched (invariant 11), a group flips as a
 *  unit with its children's transforms left alone, and flipping twice restores the transform. A
 *  node under a singular parent is left alone, as `inParent` returns null for it. */
export function flipNodes(doc: Doc, ids: readonly string[], axis: FlipAxis): Doc {
  const box = boundsOf(doc, ids);
  if (!box) return doc;
  const c = boxCenter(box);
  const F: Mat = axis === "h" ? [-1, 0, 0, 1, 2 * c.x, 0] : [1, 0, 0, -1, 0, 2 * c.y];
  return mapNodes(doc, ids, (n, parent) => {
    const local = inParent(parent, F);
    return local ? { ...n, transform: multiply(local, n.transform) } : n;
  });
}
