import { applyMat, invert, isAxisAligned, isIdentity, multiply, type Mat } from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import type { Doc, Node, PolygonShape, Shape } from "./document";
import { mapNodes } from "./tree";

/** Spec (M2a) §1: move/rotate touch the matrix; resize is baked into geometry so stroke widths
 *  and corner radii never scale. `L` is the resize expressed in the shape's own space. */
function bakeShape(s: Shape, L: Mat): Shape {
  if (isIdentity(L)) return s;
  if (s.kind !== "path" && !isAxisAligned(L)) return bakeShape(toPath(s), L);
  switch (s.kind) {
    case "rect": {
      const a = applyMat(L, { x: s.x, y: s.y });
      const b = applyMat(L, { x: s.x + s.w, y: s.y + s.h });
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      return {
        ...s,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w,
        h,
        rx: Math.min(s.rx, w / 2, h / 2),
      };
    }
    case "ellipse": {
      const c = applyMat(L, { x: s.cx, y: s.cy });
      return { ...s, cx: c.x, cy: c.y, rx: s.rx * Math.abs(L[0]), ry: s.ry * Math.abs(L[3]) };
    }
    case "polygon": {
      const c = applyMat(L, { x: s.cx, y: s.cy });
      const out: PolygonShape = {
        ...s,
        cx: c.x,
        cy: c.y,
        rx: s.rx * Math.abs(L[0]),
        ry: s.ry * Math.abs(L[3]),
      };
      // Spec (M2c) §4: the corners are left-right symmetric, so a horizontal flip needs nothing.
      // A vertical flip of an odd polygon must point down: add an exact half-turn about the centre.
      if (L[3] < 0 && s.sides % 2 === 1) {
        const half: Mat = [-1, 0, 0, -1, 2 * c.x, 2 * c.y];
        out.transform = multiply(s.transform, half);
      }
      return out;
    }
    case "path":
      return { ...s, subpaths: transformSubpaths(s.subpaths, L) };
  }
}

/** Resize `node` by `A`, given in the node's parent space. */
export function resizeNode(node: Node, A: Mat): Node {
  const inv = invert(node.transform);
  if (!inv) return node;
  const L = multiply(inv, multiply(A, node.transform));
  if (isIdentity(L)) return node;
  if (node.kind === "group") {
    let changed = false;
    const children = node.children.map((c) => {
      const r = resizeNode(c, L);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? { ...node, children } : node;
  }
  return bakeShape(node, L);
}

export function resizeNodes(doc: Doc, ids: readonly string[], A: Mat): Doc {
  if (isIdentity(A)) return doc;
  return mapNodes(doc, ids, (n) => resizeNode(n, A));
}
