import { nodeBounds } from "../geom/bounds";
import { unionBox, type Box } from "../geom/box";
import { inParent, multiply, translate } from "../geom/mat";
import type { Vec } from "../geom/vec";
import type { Doc } from "./document";
import { findNode, mapNodes } from "./tree";

/** Align and distribute (spec M19). Every command is a move: each node gets its own translation,
 *  composed into its transform in its parent's space, exactly as `translateNodes` does (invariant
 *  26) — so titles, polygons, gradients and strokes stay live. */

export type AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "h" | "v";

/** Each selected node's document-space bounds — the ones the selection frame and snapping use. A
 *  node with no bounds (nothing drawable) is left out. */
function boundsOf(doc: Doc, ids: readonly string[]): { id: string; box: Box }[] {
  const out: { id: string; box: Box }[] = [];
  for (const id of ids) {
    const f = findNode(doc, id);
    const box = f ? nodeBounds(f.node, f.parent) : null;
    if (box) out.push({ id, box });
  }
  return out;
}

/** Applies a per-node document-space translation. A zero delta leaves that node — and, when every
 *  delta is zero, the whole document — as the same reference (invariant 1). */
function moveEach(doc: Doc, deltas: Map<string, Vec>): Doc {
  const moving = [...deltas].filter(([, d]) => d.x !== 0 || d.y !== 0).map(([id]) => id);
  if (moving.length === 0) return doc;
  return mapNodes(doc, moving, (n, parent) => {
    const d = deltas.get(n.id)!;
    const local = inParent(parent, translate(d.x, d.y));
    return local ? { ...n, transform: multiply(local, n.transform) } : n;
  });
}

/** Aligns the selection. Two or more nodes align to the selection's bounds; a single node aligns
 *  to the artboard (spec M19 §1). */
export function alignNodes(doc: Doc, ids: readonly string[], op: AlignOp): Doc {
  const items = boundsOf(doc, ids);
  if (items.length === 0) return doc;
  const ref: Box =
    items.length === 1
      ? { x: 0, y: 0, w: doc.artboard.w, h: doc.artboard.h }
      : items.reduce<Box | null>((u, it) => unionBox(u, it.box), null)!;
  const deltas = new Map<string, Vec>();
  for (const { id, box: b } of items) {
    let dx = 0;
    let dy = 0;
    if (op === "left") dx = ref.x - b.x;
    else if (op === "right") dx = ref.x + ref.w - (b.x + b.w);
    else if (op === "hcenter") dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    else if (op === "top") dy = ref.y - b.y;
    else if (op === "bottom") dy = ref.y + ref.h - (b.y + b.h);
    else dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    deltas.set(id, { x: dx, y: dy });
  }
  return moveEach(doc, deltas);
}

/** Equal gaps between neighbours along one axis, for three or more nodes (spec M19 §1): the node
 *  with the smallest leading edge and the one with the largest trailing edge stay put; the rest are
 *  laid out in order of their leading edge. The gap is negative when the nodes overlap. */
export function distributeNodes(doc: Doc, ids: readonly string[], axis: DistributeAxis): Doc {
  const items = boundsOf(doc, ids);
  if (items.length < 3) return doc;
  const lead = (b: Box) => (axis === "h" ? b.x : b.y);
  const size = (b: Box) => (axis === "h" ? b.w : b.h);
  const sorted = [...items].sort((p, q) => lead(p.box) - lead(q.box));
  const start = lead(sorted[0].box);
  const end = Math.max(...items.map((it) => lead(it.box) + size(it.box)));
  const total = items.reduce((s, it) => s + size(it.box), 0);
  const gap = (end - start - total) / (items.length - 1);
  const deltas = new Map<string, Vec>();
  let at = start;
  for (const { id, box: b } of sorted) {
    const d = at - lead(b);
    deltas.set(id, axis === "h" ? { x: d, y: 0 } : { x: 0, y: d });
    at += size(b) + gap;
  }
  return moveEach(doc, deltas);
}
