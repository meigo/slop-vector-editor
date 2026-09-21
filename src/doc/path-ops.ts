import { IDENTITY, invert, multiply } from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import { idFor, type Doc, type Node, type PathShape, type Subpath } from "./document";
import { deleteNodes } from "./edits";
import { reversePath, subdividePath } from "./path-edit";
import { findNode, isAfter, mapNodes, paintKey, replaceNode, type Found } from "./tree";

/** Spec (M11) §2. */
export type PathOp = "subdivide" | "reverse" | "breakApart" | "combine" | "simplify";

export const PATH_OPS: readonly PathOp[] = [
  "subdivide",
  "reverse",
  "breakApart",
  "combine",
  "simplify",
];

/** The command names, used by every surface and by the notices, so they cannot drift apart. */
export const PATH_LABEL: Readonly<Record<PathOp, string>> = {
  subdivide: "Subdivide",
  reverse: "Reverse direction",
  breakApart: "Break apart",
  combine: "Combine",
  simplify: "Simplify",
};

/** Tooltips read as actions, because every title is also the status-bar hint (invariant 24). */
export const PATH_TITLE: Readonly<Record<PathOp, string>> = {
  subdivide: "Add a node in the middle of every segment",
  reverse: "Reverse the direction the path is drawn in",
  breakApart: "Split a path's subpaths into separate objects",
  combine: "Join the selected shapes into one path",
  simplify: "Remove nodes without changing the shape much",
};

const REASON = {
  noPath: "select a path",
  few: "select two or more shapes",
  group: "a group can't take part",
  single: "select a path with more than one subpath",
} as const;

const foundFor = (doc: Doc, ids: readonly string[]): Found[] =>
  [...new Set(ids)].flatMap((id) => findNode(doc, id) ?? []);

const paths = (found: readonly Found[]): PathShape[] =>
  found.flatMap((f) => (f.node.kind === "path" ? [f.node] : []));

/** The one place that decides whether an operation can run, so the menus and the edits can never
 *  disagree about it (spec M11 §7; the shape is `booleanRefusal`'s). Returns the reason text
 *  itself rather than a code — there is one surface, and a second table to keep in step would be a
 *  second thing that can drift. */
export function pathOpRefusal(doc: Doc, ids: readonly string[], op: PathOp): string | null {
  const found = foundFor(doc, ids);
  if (op === "combine") {
    if (found.length < 2) return REASON.few;
    if (found.some((f) => f.node.kind === "group")) return REASON.group;
    return null;
  }
  const ps = paths(found);
  if (ps.length === 0) return REASON.noPath;
  if (op === "breakApart" && !ps.some((p) => p.subpaths.length > 1)) return REASON.single;
  return null;
}

/** Spec (M11) §5. */
export function subdivideSelection(doc: Doc, ids: readonly string[]): Doc {
  return mapNodes(doc, [...new Set(ids)], (n) => (n.kind === "path" ? subdividePath(n) : n));
}

/** Spec (M11) §4. */
export function reverseSelection(doc: Doc, ids: readonly string[]): Doc {
  return mapNodes(doc, [...new Set(ids)], (n) => (n.kind === "path" ? reversePath(n) : n));
}

/** Spec (M11) §3. Each selected path with more than one subpath becomes one node per subpath, in
 *  its own place in the z-order. The first fragment keeps the original's id, so the operation is
 *  visible in the layers panel as a split rather than as a delete and five inserts.
 *
 *  `text` is deliberately not carried over: a title's outlines stop describing its string the
 *  moment they are split up (invariant 40). The fragments are built fresh rather than cleared,
 *  so no bake funnel is involved. */
export function breakApart(doc: Doc, ids: readonly string[]): { doc: Doc; ids: string[] } {
  const targets = paths(foundFor(doc, ids)).filter((p) => p.subpaths.length > 1);
  if (targets.length === 0) return { doc, ids: [] };
  let next = doc;
  let nextId = doc.nextId;
  const made: string[] = [];
  for (const p of targets) {
    const frags: Node[] = p.subpaths.map((sp, k) => {
      const frag: PathShape = {
        kind: "path",
        id: k === 0 ? p.id : idFor(nextId++),
        transform: p.transform,
        style: p.style,
        subpaths: [sp],
      };
      // Optional fields are written only when set, so a fragment of an ordinary path is
      // structurally identical to one drawn that way (invariant 39).
      if (p.name !== undefined) frag.name = p.name;
      if (p.hidden === true) frag.hidden = true;
      if (p.locked === true) frag.locked = true;
      return frag;
    });
    made.push(...frags.map((n) => n.id));
    next = replaceNode(next, p.id, frags);
  }
  return { doc: { ...next, nextId }, ids: made };
}

/** Spec (M11) §3. The inverse of `breakApart`, and `booleanShapes`' rule for where a result goes:
 *  the frontmost operand gives the result its id, place, style and name, and every other operand's
 *  subpaths are mapped into that node's parent space before being gathered in. */
export function combine(doc: Doc, ids: readonly string[]): { doc: Doc; id: string } | null {
  const unique = [...new Set(ids)];
  if (pathOpRefusal(doc, unique, "combine")) return null;
  const found = foundFor(doc, unique);
  const shapes = found.map((f) => ({
    found: f,
    path: f.node.kind === "path" ? f.node : toPath(f.node as Parameters<typeof toPath>[0]),
    key: paintKey(f.layerIndex, f.path),
  }));
  const front = shapes.reduce((a, b) => (isAfter(a.key, b.key) ? a : b));
  const toParent = invert(front.found.parent);
  if (!toParent) return null;

  const subpaths: Subpath[] = [];
  for (const s of shapes) {
    const world = multiply(s.found.parent, s.path.transform);
    // A singular world matrix contributes nothing, as in `booleanOf`.
    const into = multiply(toParent, world);
    if (!invert(into)) continue;
    subpaths.push(...transformSubpaths(s.path.subpaths, into));
  }
  if (subpaths.length === 0) return null;

  const shape: PathShape = {
    kind: "path",
    id: front.path.id,
    transform: IDENTITY,
    style: front.path.style,
    subpaths,
  };
  if (front.path.name !== undefined) shape.name = front.path.name;
  const replaced = mapNodes(doc, [front.path.id], () => shape as Node);
  const others = shapes.filter((s) => s !== front).map((s) => s.path.id);
  return { doc: deleteNodes(replaced, others), id: shape.id };
}
