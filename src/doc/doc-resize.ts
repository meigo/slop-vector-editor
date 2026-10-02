import { isValidArtboardSize, MAX_ARTBOARD, type Doc, type Node, type Shape } from "./document";
import { nodeBounds } from "../geom/bounds";
import { IDENTITY, multiply, scale, type Mat } from "../geom/mat";
import { resizeNode } from "./resize";
import { mapShapes } from "./tree";

// MAX_COORD = svg/parse.ts's value; imported here would cause a cycle
const MAX_COORD = 1e9;

/** Spec M23 §2: where a crop/extend keeps the drawing — 0 = left/top, 0.5 = centre, 1 = right/bottom. */
export type Anchor = 0 | 0.5 | 1;

export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Crop/extend's Keep ratio (slop-paint's `linkedSize`): the other side in whole pixels. */
export function linkedSize(v: number, from: number, to: number): number {
  return Math.max(1, Math.round((v * to) / from));
}

/** Scale drawing's other side: exact to 2 decimals, as the artboard is set (spec M23 §2). */
export function scaledSide(v: number, from: number, to: number): number {
  return round2((v * to) / from);
}

/** Why a page of `w × h` can't be set, or null. The dialog shows it under the fields. */
export function sizeRefusal(w: unknown, h: unknown): string | null {
  if (typeof w !== "number" || typeof h !== "number" || !Number.isFinite(w) || !Number.isFinite(h))
    return "Enter a width and a height";
  if (w > MAX_ARTBOARD || h > MAX_ARTBOARD) return `Too large — at most ${MAX_ARTBOARD} px a side`;
  if (!isValidArtboardSize(w) || !isValidArtboardSize(h))
    return "Too small — a side must be more than 0 px";
  return null;
}

/** Only the translation changes (invariant 26): nothing is baked, so everything stays live. */
function shift(n: Node, dx: number, dy: number): Node {
  const [a, b, c, d, e, f] = n.transform;
  return { ...n, transform: [a, b, c, d, e + dx, f + dy] };
}

/** Spec M23 §3: the page becomes `w × h` and every top-level node of every layer — hidden and
 *  locked ones too, since this changes the page, not the art — moves so the anchored part of the
 *  drawing keeps its place. Layers have no transform, so top-level nodes are in document space;
 *  nested ones move with their parents. */
export function extendCanvas(doc: Doc, w: number, h: number, ax: Anchor, ay: Anchor): Doc {
  const reason = sizeRefusal(w, h);
  if (reason) throw new RangeError(reason);
  const { w: w0, h: h0 } = doc.artboard;
  if (w === w0 && h === h0) return doc;
  const dx = ax * (w - w0);
  const dy = ay * (h - h0);
  const artboard = { ...doc.artboard, w, h };
  if (dx === 0 && dy === 0) return { ...doc, artboard };
  const layers = doc.layers.map((l) =>
    l.children.length === 0 ? l : { ...l, children: l.children.map((n) => shift(n, dx, dy)) },
  );
  return { ...doc, artboard, layers };
}

/** Spec M23 §3: what a handle resize keeps fixed (invariant 11) but Scale drawing must scale for
 *  the drawing to look the same — the stroke width and a rectangle's corner radius. Applied BEFORE
 *  the bake: `bakeShape` then clamps `min(k·rx, k·w/2, k·h/2)`, which is `k · min(rx, w/2, h/2)`;
 *  after it, a scale-down would be clamped twice. */
export function scaleDetails(s: Shape, k: number): Shape {
  const style =
    s.style.stroke === null ? s.style : { ...s.style, strokeWidth: s.style.strokeWidth * k };
  if (s.kind === "rect" && s.rx !== 0) return { ...s, style, rx: s.rx * k };
  return style === s.style ? s : { ...s, style };
}

/** The largest |coordinate| a node reaches in document space — hidden descendants included, which
 *  `nodeBounds` skips, because they are scaled too and the file must still load. */
function extent(node: Node, m: Mat): number {
  if (node.kind === "group") {
    const t = multiply(m, node.transform);
    return node.children.reduce((a, c) => Math.max(a, extent(c, t)), 0);
  }
  const b = nodeBounds(node, m);
  return b ? Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.x + b.w), Math.abs(b.y + b.h)) : 0;
}

/** Why Scale drawing by `k` can't be applied, or null. The dialog and the store both read this, so
 *  they cannot disagree (the `booleanRefusal` pattern). */
export function scaleRefusal(doc: Doc, k: number): string | null {
  if (!Number.isFinite(k) || k <= 0) return "Enter a width and a height";
  const size = sizeRefusal(round2(doc.artboard.w * k), round2(doc.artboard.h * k));
  if (size) return size;
  let max = 0;
  for (const l of doc.layers) for (const n of l.children) max = Math.max(max, extent(n, IDENTITY));
  if (max * k > MAX_COORD) return `Scaling by ${round2(k)}× would put the drawing out of range`;
  return null;
}

/** Spec M23 §3: everything scales by `k` about the page's top-left, uniformly, so the handle
 *  resize's bake keeps titles, polygons, rectangles, ellipses and gradients live (invariants 11,
 *  44, 46). Hidden and locked content scales too. */
export function scaleDrawing(doc: Doc, k: number): Doc {
  if (k === 1) return doc;
  const reason = scaleRefusal(doc, k);
  if (reason) throw new RangeError(reason);
  const S = scale(k);
  const layers = doc.layers.map((l) =>
    l.children.length === 0
      ? l
      : {
          ...l,
          children: l.children.map((n) =>
            resizeNode(
              mapShapes(n, (s) => scaleDetails(s, k)),
              S,
            ),
          ),
        },
  );
  const artboard = {
    ...doc.artboard,
    w: round2(doc.artboard.w * k),
    h: round2(doc.artboard.h * k),
  };
  return { ...doc, artboard, layers };
}
