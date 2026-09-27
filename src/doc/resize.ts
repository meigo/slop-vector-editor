import {
  applyMat,
  inParent,
  invert,
  isAxisAligned,
  isIdentity,
  multiply,
  type Mat,
} from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import {
  mapStyle,
  scaleTextMeta,
  withBakedSubpaths,
  type Doc,
  type Node,
  type PolygonShape,
  type Shape,
} from "./document";
import { findNode, mapNodes } from "./tree";

/** Spec (M2a) §1: move/rotate touch the matrix; resize is baked into geometry so stroke widths
 *  and corner radii never scale. `L` is the resize expressed in the shape's own space.
 *
 *  Spec (M15) §5: each branch also maps the style with EXACTLY the matrix it applies to that
 *  branch's geometry — for the title's uniform-scale branch that is the scale-only matrix, not the
 *  full `L`, because the translation goes onto `transform` rather than into the own-space points
 *  (see that branch). Mapping with the wrong matrix there would double-count the translation. */
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
        style: mapStyle(s.style, L),
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w,
        h,
        rx: Math.min(s.rx, w / 2, h / 2),
      };
    }
    case "ellipse": {
      const c = applyMat(L, { x: s.cx, y: s.cy });
      return {
        ...s,
        style: mapStyle(s.style, L),
        cx: c.x,
        cy: c.y,
        rx: s.rx * Math.abs(L[0]),
        ry: s.ry * Math.abs(L[3]),
      };
    }
    case "polygon": {
      const c = applyMat(L, { x: s.cx, y: s.cy });
      const out: PolygonShape = {
        ...s,
        // cx/cy/rx/ry are baked by L, so the gradient maps by L too.
        style: mapStyle(s.style, L),
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
    case "path": {
      // A title survives a UNIFORM resize, because that is expressible as a text size and the
      // metadata can be kept in step with the baked outlines (spec M10e §7). Anything else — a
      // stretch, a flip — cannot be, so the title becomes an ordinary path rather than one that
      // would snap back to its old shape on the next keystroke.
      const k = s.text ? uniformScale(L) : null;
      if (k !== null && s.text) {
        // Scale about the local origin only. A Shift-drag is a scale about a corner, so `L` also
        // carries a translation; baking that into the outlines makes the next re-outline (which
        // anchors the baseline at y = 0) jump the title. The translation belongs on the transform.
        const scaleOnly: Mat = [k, 0, 0, k, 0, 0];
        const subpaths = transformSubpaths(s.subpaths, scaleOnly);
        const tx = L[4];
        const ty = L[5];
        const transform =
          tx === 0 && ty === 0 ? s.transform : multiply(s.transform, [1, 0, 0, 1, tx, ty]);
        // The gradient's own-space points are baked by the same scale-only matrix as the outlines:
        // the translation already lives on `transform`, so mapping by `L` here would apply it twice.
        return {
          ...s,
          transform,
          subpaths,
          text: scaleTextMeta(s.text, k),
          style: mapStyle(s.style, scaleOnly),
        };
      }
      return {
        ...withBakedSubpaths(s, transformSubpaths(s.subpaths, L)),
        style: mapStyle(s.style, L),
      };
    }
  }
}

/** Floating-point slack for the uniform test. The resize matrix is composed from a frame and a
 *  pointer position, so an intended square drag arrives a few ULPs off being exactly uniform. */
const UNIFORM_EPS = 1e-9;

/** `k` if `L` is a uniform scale (with any translation), else null.
 *
 *  A rotation or shear (`b`/`c`) is not an axis-aligned resize, and a **flip** — a negative
 *  factor — mirrors the outlines, which no text size can express: re-outlining at `|k|` would come
 *  back un-mirrored. Both fall through to the bake. */
export function uniformScale(L: Mat): number | null {
  const [a, b, c, d] = L;
  if (Math.abs(b) > UNIFORM_EPS || Math.abs(c) > UNIFORM_EPS) return null;
  if (a <= 0 || d <= 0) return null;
  if (Math.abs(a - d) > UNIFORM_EPS * Math.max(1, Math.abs(a))) return null;
  return a;
}

/** Whether a resize turned a title into an ordinary path — the one thing about a resize the user
 *  cannot see happening, so it is worth a notice.
 *
 *  Deliberately compares the two documents rather than re-deriving the rule from the matrix: a
 *  second copy of "is this uniform, in the node's own space, through its parent" is a copy that
 *  can drift from `bakeShape`, and this is the kind of quiet data loss where a drift would not be
 *  noticed. `ids` keeps the walk to what was resized. */
function titleDropped(before: Doc, after: Doc, id: string): boolean {
  const b = findNode(before, id)?.node;
  if (!b) return false;
  if (b.kind === "path" && b.text) {
    const a = findNode(after, id)?.node;
    return !!a && a.kind === "path" && !a.text;
  }
  // A group resize bakes every descendant. The notice has to see a title that was not itself selected.
  if (b.kind === "group") return b.children.some((c) => titleDropped(before, after, c.id));
  return false;
}

export function droppedTitle(before: Doc, after: Doc, ids: readonly string[]): boolean {
  return ids.some((id) => titleDropped(before, after, id));
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
  // Spec M15 §5: each `bakeShape` branch maps the style with the exact matrix it applies to that
  // branch's geometry (see `bakeShape`'s doc comment) — mapping here too would use the wrong
  // matrix for the title's uniform-scale branch, which bakes translation onto `transform` instead
  // of into the outlines.
  return bakeShape(node, L);
}

export function resizeNodes(doc: Doc, ids: readonly string[], A: Mat): Doc {
  if (isIdentity(A)) return doc;
  return mapNodes(doc, ids, (n, parent) => {
    const local = inParent(parent, A);
    return local ? resizeNode(n, local) : n;
  });
}
