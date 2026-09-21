import { booleanOf, type BoolOp } from "../geom/boolean";
import { invert, multiply, IDENTITY } from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import type { Doc, Node, PathShape, Subpath } from "./document";
import { deleteNodes } from "./edits";
import { findNode, isAfter, mapNodes, paintKey } from "./tree";

/** Why an operation cannot run (spec M7 §7). */
export type BoolRefusal = "few" | "group" | "open";

export type BoolOutcome =
  | { kind: "ok"; doc: Doc; id: string }
  /** The operation ran and left no area: the document must not change (spec M7 §7). */
  | { kind: "empty" }
  | { kind: "refused"; why: BoolRefusal };

/** The one place that decides whether an operation can run, so the menus and the edit itself can
 *  never disagree about it (spec M7 §7). */
export function booleanRefusal(doc: Doc, ids: readonly string[]): BoolRefusal | null {
  // The same id twice must not read as two shapes: it would pass this test and then, in
  // `booleanShapes`, make one node both the frontmost input and one of the inputs to delete.
  const found = [...new Set(ids)].flatMap((id) => findNode(doc, id) ?? []);
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
  const unique = [...new Set(ids)];
  const why = booleanRefusal(doc, unique);
  if (why) return { kind: "refused", why };
  const found = unique.flatMap((id) => findNode(doc, id) ?? []);

  const shapes = found.map((f) => ({
    found: f,
    path: f.node.kind === "path" ? f.node : toPath(f.node as Parameters<typeof toPath>[0]),
    key: paintKey(f.layerIndex, f.path),
  }));

  // Only the two extremes of the paint order are picked out: the frontmost gives the result its id,
  // place and name, and Subtract has to hand the backmost to paper first, because every later
  // operand is removed from the first. The operands otherwise stay in selection order — the other
  // three operations are commutative, and subtracting several shapes is order-independent too.
  const back = shapes.reduce((a, b) => (isAfter(a.key, b.key) ? b : a));
  const front = shapes.reduce((a, b) => (isAfter(a.key, b.key) ? a : b));
  const ordered = op === "subtract" ? [back, ...shapes.filter((s) => s !== back)] : shapes;

  const operands: Subpath[][] = [];
  for (const s of ordered) {
    const world = multiply(s.found.parent, s.path.transform);
    operands.push(transformSubpaths(s.path.subpaths, world));
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
    subpaths: transformSubpaths(result, toParent),
  };
  // The name follows the style, not the place: it is a label on the shape whose area survived, and
  // for Subtract that is the backmost one. Naming the result after the knife would leave the user's
  // "Logo" gone and "Knife" in its place. Written only when there is one, as `toPath` does, so an
  // unnamed shape stays unnamed in the file.
  if (styleFrom.path.name !== undefined) shape.name = styleFrom.path.name;
  const replaced = mapNodes(doc, [front.path.id], () => shape as Node);
  const others = shapes.filter((s) => s !== front).map((s) => s.path.id);
  return { kind: "ok", doc: deleteNodes(replaced, others), id: shape.id };
}
