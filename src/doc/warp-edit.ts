import { type Box, unionBox } from "../geom/box";
import { nodeBounds } from "../geom/bounds";
import { applyMat, invert, multiply, type Mat } from "../geom/mat";
import { toPath } from "../geom/shapes";
import type { Vec } from "../geom/vec";
import { type Cage, isIdentityCage, warpPoint, warpSubpaths } from "../geom/warp";
import {
  flatIfDegenerate,
  isGradient,
  withBakedSubpaths,
  type Doc,
  type Fill,
  type Node,
  type Style,
} from "./document";
import { findNode, mapNodes, shapesOf } from "./tree";

/** Spec M14 §3: maps `n`'s geometry through the cage, in its own world space (`world =
 *  multiply(parent, n.transform)`), and returns `n` unchanged if that matrix is singular — the same
 *  rule `inParent` already applies to a resize. `n`'s own `transform` is never touched (invariant
 *  26): a group recurses into its children with `world` as their parent, and a leaf shape goes
 *  through `toPath` first (invariant 21's polygon, a rect's live corner radius, invariant 39's
 *  ellipse) and then `withBakedSubpaths` (invariant 40 — this is the new bake site that drops a
 *  title's `text`, exactly as `resize.ts` and `flattenTransform` already do for their own bakes). */
function warpNode(n: Node, parent: Mat, cage: Cage, box: Box): Node {
  const world = multiply(parent, n.transform);
  if (!invert(world)) return n;

  if (n.kind === "group") {
    let changed = false;
    const children = n.children.map((c) => {
      const w = warpNode(c, world, cage, box);
      if (w !== c) changed = true;
      return w;
    });
    return changed ? { ...n, children } : n;
  }

  const p = n.kind === "path" ? n : toPath(n);
  const baked = withBakedSubpaths(p, warpSubpaths(p.subpaths, world, cage, box));
  return { ...baked, style: warpStyle(p.style, world, cage, box) };
}

/** Spec M14 §0.3, §3: a warp is the first bake that is not a matrix, so a gradient's own-space
 *  points travel the exact path the geometry does — `local —M→ world —S→ world′ —M⁻¹→ local′` —
 *  rather than through invariant 46's "map the style by the same matrix". Returns the SAME `style`
 *  object when neither paint is a gradient, so a gradient-free document keeps every reference it
 *  keeps today (invariant 46). `mid`/`midPaint` ride along unchanged via the spread; a result that
 *  collapses goes through `flatIfDegenerate`, as every other bake does. */
export function warpStyle(style: Style, world: Mat, cage: Cage, box: Box): Style {
  if (!isGradient(style.fill) && !isGradient(style.stroke)) return style;
  const inv = invert(world);
  if (!inv) return style; // world is invertible by contract — the caller already checked.

  const warpP = (q: Vec): Vec => applyMat(inv, warpPoint(cage, box, applyMat(world, q)));
  const mapFill = (f: Fill | null): Fill | null => {
    if (!isGradient(f)) return f;
    return f.kind === "linear"
      ? flatIfDegenerate({ ...f, from: warpP(f.from), to: warpP(f.to) })
      : flatIfDegenerate({ ...f, center: warpP(f.center), a: warpP(f.a), b: warpP(f.b) });
  };
  return { ...style, fill: mapFill(style.fill), stroke: mapFill(style.stroke) };
}

/** Spec M14 §3: `isIdentityCage(cage, box)` short-circuits to `doc` itself (invariant 1) — an
 *  undragged cage warps nothing. Otherwise every selected node (and everything inside a selected
 *  group) is baked through `warpNode`. */
export function warpNodes(doc: Doc, ids: readonly string[], cage: Cage, box: Box): Doc {
  if (isIdentityCage(cage, box)) return doc;
  return mapNodes(doc, ids, (n, parent) => warpNode(n, parent, cage, box));
}

const article = (n: number, word: string, vowel: boolean): string =>
  n === 1 ? `${vowel ? "an" : "a"} ${word}` : `${n} ${word}s`;

/** Standard list join, no Oxford comma: "a", "a and b", "a, b and c". */
function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Spec M14 §6: `droppedLive` compares the two documents rather than re-deriving the rule from the
 *  cage — a second copy of "what does this operation destroy" is a copy that can drift from the
 *  code that destroys it (invariant 44's reasoning). Walks every leaf under each selected id (the
 *  same walk `shapesOf` gives the tree helpers) and counts a `before` polygon/rect/ellipse that
 *  became a `path` in `after`, and a `before` title (a path with `text`) whose `after` lost it. One
 *  notice for the whole commit, never one per object; `null` when nothing was dropped. */
export function droppedLive(before: Doc, after: Doc, ids: readonly string[]): string | null {
  let polygons = 0;
  let rectangles = 0;
  let ellipses = 0;
  let titles = 0;

  for (const id of ids) {
    const found = findNode(before, id);
    if (!found) continue;
    for (const shape of shapesOf(found.node)) {
      const afterFound = findNode(after, shape.id);
      if (!afterFound) continue;
      const afterNode = afterFound.node;
      if (shape.kind === "polygon" && afterNode.kind === "path") polygons++;
      else if (shape.kind === "rect" && afterNode.kind === "path") rectangles++;
      else if (shape.kind === "ellipse" && afterNode.kind === "path") ellipses++;
      else if (
        shape.kind === "path" &&
        shape.text !== undefined &&
        afterNode.kind === "path" &&
        afterNode.text === undefined
      ) {
        titles++;
      }
    }
  }

  const parts: string[] = [];
  if (polygons) parts.push(article(polygons, "polygon", false));
  if (rectangles) parts.push(article(rectangles, "rectangle", false));
  if (ellipses) parts.push(article(ellipses, "ellipse", true));
  if (titles) parts.push(article(titles, "title", false));
  if (parts.length === 0) return null;

  const total = polygons + rectangles + ellipses + titles;
  const verb = total === 1 ? "is now an ordinary path" : "are now ordinary paths";
  return `Warped — ${joinList(parts)} ${verb}.`;
}

/** The union of `nodeBounds` over `ids`, exactly as `selectionBounds` (`src/tools/frame.ts`)
 *  computes it — reimplemented here rather than imported, since `src/doc/` must not depend on
 *  `src/tools/` (the architecture map's layering runs the other way: tools depend on doc, never
 *  back). */
function selectionBoundsLocal(doc: Doc, ids: readonly string[]): Box | null {
  let box: Box | null = null;
  for (const id of ids) {
    const found = findNode(doc, id);
    if (!found) continue;
    box = unionBox(box, nodeBounds(found.node, found.parent));
  }
  return box;
}

/** Spec M14 §7: the Warp tool's title/`aria-disabled` reason (invariant 24). */
export function warpRefusal(doc: Doc, ids: readonly string[]): string | null {
  if (ids.length === 0) return "Warp — select something to warp";
  const box = selectionBoundsLocal(doc, ids);
  if (!box || box.w <= 0 || box.h <= 0) return "Warp — select something with width and height";
  return null;
}
