import { booleanOf, type BoolOp } from "../geom/boolean";
import { applyMat, invert, multiply, IDENTITY } from "../geom/mat";
import { toPath } from "../geom/shapes";
import type { Doc, Node, PathShape, Subpath } from "./document";
import { deleteNodes } from "./edits";
import { findNode, mapNodes } from "./tree";

/** Why an operation cannot run (spec M7 §7). */
export type BoolRefusal = "few" | "group" | "open";

export type BoolOutcome =
  | { kind: "ok"; doc: Doc; id: string }
  /** The operation ran and left no area: the document must not change (spec M7 §7). */
  | { kind: "empty" }
  | { kind: "refused"; why: BoolRefusal };

/** Paint order: later children sit in front, so the greatest key is the frontmost. */
const order = (layerIndex: number, path: readonly number[]) => [layerIndex, ...path];
const after = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x > y;
  }
  return false;
};

const mapSubpath = (sp: Subpath, m: import("../geom/mat").Mat): Subpath => ({
  closed: sp.closed,
  nodes: sp.nodes.map((n) => ({
    ...n,
    p: applyMat(m, n.p),
    in: n.in ? applyMat(m, n.in) : null,
    out: n.out ? applyMat(m, n.out) : null,
  })),
});

/** The one place that decides whether an operation can run, so the menus and the edit itself can
 *  never disagree about it (spec M7 §7). */
export function booleanRefusal(doc: Doc, ids: readonly string[]): BoolRefusal | null {
  const found = ids.flatMap((id) => findNode(doc, id) ?? []);
  if (found.length < 2) return "few";
  if (found.some((f) => f.node.kind === "group")) return "group";
  const open = found.some(
    (f) => f.node.kind === "path" && f.node.subpaths.some((sp) => !sp.closed),
  );
  return open ? "open" : null;
}

/** Spec (M7) §4–§7. Combines the selected shapes and returns a new document, or says why not. */
export async function booleanShapes(
  doc: Doc,
  ids: readonly string[],
  op: BoolOp,
): Promise<BoolOutcome> {
  const why = booleanRefusal(doc, ids);
  if (why) return { kind: "refused", why };
  const found = ids.flatMap((id) => findNode(doc, id) ?? []);

  const shapes = found.map((f) => ({
    found: f,
    path: f.node.kind === "path" ? f.node : toPath(f.node as Parameters<typeof toPath>[0]),
    key: order(f.layerIndex, f.path),
  }));

  // Front to back by paint order, so the operands go into paper in the order the user sees.
  const back = shapes.reduce((a, b) => (after(a.key, b.key) ? b : a));
  const front = shapes.reduce((a, b) => (after(a.key, b.key) ? a : b));
  const ordered = op === "subtract" ? [back, ...shapes.filter((s) => s !== back)] : shapes;

  const operands: Subpath[][] = [];
  for (const s of ordered) {
    const world = multiply(s.found.parent, s.path.transform);
    operands.push(s.path.subpaths.map((sp) => mapSubpath(sp, world)));
  }
  const result = await booleanOf(operands, op);
  if (result.length === 0) return { kind: "empty" };

  // The result lands where the frontmost input was, so it must be expressed in that node's parent
  // space rather than in document space.
  const toParent = invert(front.found.parent);
  if (!toParent) return { kind: "empty" };
  // Subtract's front shape is the knife: only the backmost shape's area survives, so its style is
  // the one still on screen (spec M7 §4).
  const styleFrom = op === "subtract" ? back : front;
  const shape: PathShape = {
    kind: "path",
    id: front.path.id,
    transform: IDENTITY,
    style: styleFrom.path.style,
    subpaths: result.map((sp) => mapSubpath(sp, toParent)),
  };
  const replaced = mapNodes(doc, [front.path.id], () => shape as Node);
  const others = shapes.filter((s) => s !== front).map((s) => s.path.id);
  return { kind: "ok", doc: deleteNodes(replaced, others), id: shape.id };
}
