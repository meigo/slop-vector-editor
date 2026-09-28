import { nodeBounds } from "../geom/bounds";
import { unionBox, type Box } from "../geom/box";
import { inParent, multiply, translate } from "../geom/mat";
import type { Vec } from "../geom/vec";
import type { Doc } from "./document";
import { outermost } from "./group";
import { findNode, mapNodes } from "./tree";

/** Align and distribute (spec M19). Every command is a move: each node gets its own translation,
 *  composed into its transform in its parent's space, exactly as `translateNodes` does (invariant
 *  26) — so titles, polygons, gradients and strokes stay live. */

export type AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "h" | "v";

/** Each selected node's document-space bounds — the ones the selection frame and snapping use. A
 *  node with no bounds (nothing drawable) is left out, and so is a node whose ancestor is also
 *  selected: the layers panel can select a group and its own child, and the child moves with the
 *  group (`mapNodes` never looks inside a node it changed). `outermost` also returns document
 *  order, so no result depends on the order things were selected in. */
function boundsOf(doc: Doc, ids: readonly string[]): { id: string; box: Box }[] {
  const out: { id: string; box: Box }[] = [];
  for (const id of outermost(doc, ids)) {
    const f = findNode(doc, id);
    const box = f ? nodeBounds(f.node, f.parent) : null;
    if (box) out.push({ id, box });
  }
  return out;
}

/** Below this a delta is float drift, not a move: bounds that pass through a rotated matrix come
 *  back ~1e-14 off, and without it pressing Align twice would add an empty undo step. */
const EPS = 1e-9;

/** Applies a per-node document-space translation. A (near-)zero delta leaves that node — and,
 *  when every delta is, the whole document — as the same reference (invariant 1). */
function moveEach(doc: Doc, deltas: Map<string, Vec>): Doc {
  const moving = [...deltas]
    .filter(([, d]) => Math.abs(d.x) > EPS || Math.abs(d.y) > EPS)
    .map(([id]) => id);
  if (moving.length === 0) return doc;
  return mapNodes(doc, moving, (n, parent) => {
    const d = deltas.get(n.id)!;
    const local = inParent(parent, translate(d.x, d.y));
    return local ? { ...n, transform: multiply(local, n.transform) } : n;
  });
}

/** How many objects a command would actually act on — the outermost selected nodes with bounds.
 *  The panel and the menu decide "several (to each other) vs one (to the artboard)" and whether
 *  distribute is available from this, so their hints match what happens. */
export function alignTargetCount(doc: Doc, ids: readonly string[]): number {
  return boundsOf(doc, ids).length;
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

/** Equal gaps between neighbours along one axis, for three or more nodes (spec M19 §1). The span
 *  runs from the smallest leading edge to the largest trailing edge; the node that starts first
 *  stays put, the rest are laid out in order of their leading edge (ties: trailing edge, then
 *  document order), and the last one ends on the span's far edge — usually, but not always, the
 *  node that ended there already. The gap is negative when the nodes overlap. */
export function distributeNodes(doc: Doc, ids: readonly string[], axis: DistributeAxis): Doc {
  const items = boundsOf(doc, ids);
  if (items.length < 3) return doc;
  const lead = (b: Box) => (axis === "h" ? b.x : b.y);
  const size = (b: Box) => (axis === "h" ? b.w : b.h);
  const trail = (b: Box) => lead(b) + size(b);
  // Stable sort over document order, so equal edges never depend on selection order.
  const sorted = [...items].sort(
    (p, q) => lead(p.box) - lead(q.box) || trail(p.box) - trail(q.box),
  );
  const start = lead(sorted[0].box);
  const end = Math.max(...items.map((it) => trail(it.box)));
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
