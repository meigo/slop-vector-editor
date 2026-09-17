import type { Doc, Node } from "../doc/document";
import { findNode } from "../doc/tree";
import { nodeBounds } from "../geom/bounds";
import { boxCenter, boxMap, unionBox, type Box } from "../geom/box";
import { applyMat, IDENTITY, isSkewed, multiply, rotate, rotationOf, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";

/** A rotated box around a selection. `box` is in coordinates rotated by `-angle`. */
export type Frame = { angle: number; box: Box };

/** `rotate`, but exactly the identity for 0 (avoids -0 entries from `sin(-0)`). */
const rot = (a: number): Mat => (a === 0 ? IDENTITY : rotate(a));

function nodesOf(doc: Doc, ids: readonly string[]): Node[] {
  const out: Node[] = [];
  for (const id of ids) {
    const f = findNode(doc, id);
    if (f) out.push(f.node);
  }
  return out;
}

export function selectionFrame(doc: Doc, ids: readonly string[]): Frame | null {
  const nodes = nodesOf(doc, ids);
  if (nodes.length === 0) return null;
  const single = nodes.length === 1 && !isSkewed(nodes[0].transform);
  const angle = single ? rotationOf(nodes[0].transform) : 0;
  const m = rot(-angle);
  let box: Box | null = null;
  for (const n of nodes) box = unionBox(box, nodeBounds(n, m));
  return box ? { angle, box } : null;
}

export function selectionBounds(doc: Doc, ids: readonly string[]): Box | null {
  let box: Box | null = null;
  for (const n of nodesOf(doc, ids)) box = unionBox(box, nodeBounds(n, IDENTITY));
  return box;
}

export function frameToDoc(f: Frame, p: Vec): Vec {
  return applyMat(rot(f.angle), p);
}

export function docToFrame(f: Frame, p: Vec): Vec {
  return applyMat(rot(-f.angle), p);
}

export function frameCenter(f: Frame): Vec {
  return frameToDoc(f, boxCenter(f.box));
}

/** The doc-space map for resizing a frame's box from `from` to `to`. */
export function frameResizeMap(angle: number, from: Box, to: Box): Mat {
  return multiply(rot(angle), multiply(boxMap(from, to), rot(-angle)));
}
