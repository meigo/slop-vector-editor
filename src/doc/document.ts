import { applyMat, isIdentity, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";

/** The document is plain, immutable data: every edit returns a new object and never mutates its
 *  input. That is what lets undo keep references instead of clones. */

export const DOC_VERSION = 1;
export const MAX_ARTBOARD = 100000;
export const MIN_SIDES = 3;
export const MAX_SIDES = 32;
export const MIN_INNER = 0.1;
export const MAX_INNER = 0.95;

export type Paint = { color: string /* #rrggbb, lowercase */; opacity: number };
/** Spec M15 §2: two stops, always at offsets 0 and 1. `from`/`to` are in the shape's OWN space —
 *  the space its geometry lives in, under its `transform` — so move and rotate carry the gradient
 *  for free and every geometry bake must map it (`mapStyle`). */
export type LinearGradient = { kind: "linear"; from: Vec; to: Vec; start: Paint; end: Paint };
/** Spec M16 §2: the unit circle carried by the affine map whose columns are `a − center` and
 *  `b − center`. Perpendicular and equal is a circle; anything else is an ellipse — and because it
 *  is three points under an affine map, every bake stays exact by mapping the three points. */
export type RadialGradient = {
  kind: "radial";
  center: Vec;
  a: Vec;
  b: Vec;
  start: Paint;
  end: Paint;
};
export type Gradient = LinearGradient | RadialGradient;
export type Fill = Paint | Gradient;
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

export type Style = {
  fill: Fill | null;
  stroke: Fill | null;
  strokeWidth: number;
  cap: LineCap;
  join: LineJoin;
  opacity: number;
};
/** The defaults for new shapes, and the artboard's world: flat paints only (spec M15 §2). */
export type FlatStyle = Omit<Style, "fill" | "stroke"> & {
  fill: Paint | null;
  stroke: Paint | null;
};

export function isGradient(f: Fill | null | undefined): f is Gradient {
  return f !== null && f !== undefined && "kind" in f;
}
export const isLinear = (f: Fill | null | undefined): f is LinearGradient =>
  isGradient(f) && f.kind === "linear";
export const isRadial = (f: Fill | null | undefined): f is RadialGradient =>
  isGradient(f) && f.kind === "radial";

/** `[a−c, b−c, c]` in SVG `matrix()` order: the unit circle → the end-stop ellipse. */
export function radialMatrix(g: RadialGradient): Mat {
  const { center: c, a, b } = g;
  return [a.x - c.x, a.y - c.y, b.x - c.x, b.y - c.y, c.x, c.y];
}

export const samePaint = (a: Paint, b: Paint): boolean =>
  a.color === b.color && a.opacity === b.opacity;

const sameVec = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;

/** Exact: what an edit compares to decide it changed nothing (invariant 1). Kinds must match — a
 *  linear and a radial with identical stops are still different fills (spec M16 §2). */
export function sameFill(a: Fill | null, b: Fill | null): boolean {
  if (a === null || b === null) return a === b;
  if (isGradient(a) !== isGradient(b)) return false;
  if (isGradient(a) && isGradient(b)) {
    const pointsMatch =
      a.kind === "linear" && b.kind === "linear"
        ? sameVec(a.from, b.from) && sameVec(a.to, b.to)
        : a.kind === "radial" && b.kind === "radial"
          ? sameVec(a.center, b.center) && sameVec(a.a, b.a) && sameVec(a.b, b.b)
          : false;
    return pointsMatch && samePaint(a.start, b.start) && samePaint(a.end, b.end);
  }
  return samePaint(a as Paint, b as Paint);
}

/** The colours only (spec M15 §2): what Select Same and the panel's summaries compare. Two
 *  gradients' points are in two different shapes' own spaces, so comparing them means nothing.
 *  Kinds must still match — a flat paint never matches a gradient, and (spec M16 §2) a linear
 *  never matches a radial. */
export function sameColours(a: Fill | null, b: Fill | null): boolean {
  if (a === null || b === null) return a === b;
  if (isGradient(a) !== isGradient(b)) return false;
  if (isGradient(a) && isGradient(b)) {
    if (a.kind !== b.kind) return false;
    return samePaint(a.start, b.start) && samePaint(a.end, b.end);
  }
  return samePaint(a as Paint, b as Paint);
}

/** The 6-decimal rounding `svg/fmt.ts` writes with. Inlined rather than imported because nothing
 *  under `doc/` depends on `svg/`. */
const written = (v: number) => Math.round(v * 1e6) / 1e6;

/** SVG paints a gradient whose points coincide (or, for a radial, whose rim collapses to a line or
 *  a point) as its last stop's colour, so that is what we store (spec M15 §2, M16 §2). Judged on
 *  the WRITTEN numbers: a gradient 1e-7 long would otherwise save as one and reload as flat. */
export function flatIfDegenerate(g: Gradient): Fill {
  if (g.kind === "linear") {
    return written(g.from.x) === written(g.to.x) && written(g.from.y) === written(g.to.y)
      ? g.end
      : g;
  }
  const ax = written(g.a.x - g.center.x);
  const ay = written(g.a.y - g.center.y);
  const bx = written(g.b.x - g.center.x);
  const by = written(g.b.y - g.center.y);
  return ax * by - bx * ay === 0 ? g.end : g;
}

function mapFill(f: Fill | null, m: Mat): Fill | null {
  if (!isGradient(f)) return f;
  return f.kind === "linear"
    ? flatIfDegenerate({ ...f, from: applyMat(m, f.from), to: applyMat(m, f.to) })
    : flatIfDegenerate({
        ...f,
        center: applyMat(m, f.center),
        a: applyMat(m, f.a),
        b: applyMat(m, f.b),
      });
}

/** Spec M15 §5: every site that bakes a matrix into a shape's geometry maps the gradient points
 *  through the same matrix, here. Returns the SAME style when there is nothing to map, so
 *  documents without gradients keep every reference they kept before. */
export function mapStyle(s: Style, m: Mat): Style {
  if ((!isGradient(s.fill) && !isGradient(s.stroke)) || isIdentity(m)) return s;
  return { ...s, fill: mapFill(s.fill, m), stroke: mapFill(s.stroke, m) };
}

export type NodeType = "corner" | "smooth" | "symmetric";

/** Handles are absolute document coordinates (in the shape's own space); null = no handle. */
export type PathNode = { p: Vec; in: Vec | null; out: Vec | null; type: NodeType };
export type Subpath = { nodes: PathNode[]; closed: boolean };

/** Absent means normal — a node carries a flag only in its `true` state, so "not hidden" has
 *  exactly one representation and a no-op edit can return the same reference (spec M9 §3). */
type NodeFlags = { hidden?: true; locked?: true };

type ShapeBase = { id: string; name?: string; transform: Mat; style: Style } & NodeFlags;
export type RectShape = ShapeBase & {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
};
export type EllipseShape = ShapeBase & {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};
/** Spec (M2c) §2. Corners sit on the ellipse (rx, ry); rotation lives in `transform`. */
export type PolygonShape = ShapeBase & {
  kind: "polygon";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Integer MIN_SIDES–MAX_SIDES; for a star, the number of points. */
  sides: number;
  star: boolean;
  /** MIN_INNER–MAX_INNER; kept while `star` is off. */
  innerRatio: number;
};
/** A title's metadata (spec M10 §3). Present only on a path generated from text, and dropped by
 *  any structural node edit — the geometry is hand-edited from then on and re-typing would destroy
 *  it. Absent means an ordinary path, so the 23 places that test `kind === "path"` are unaffected. */
export type TextMeta = {
  text: string;
  font: string;
  size: number;
  letterSpacing: number;
  /** A multiple of `size`. Absent from files written before M10d; see `parseTextOpts`. */
  lineHeight: number;
  align: "left" | "center" | "right";
  seed: number;
  amounts: { rotate: number; scale: number; offset: number; skew: number };
  overrides: Record<number, { r?: number; s?: number; dx?: number; dy?: number; k?: number }>;
};

export type PathShape = ShapeBase & { kind: "path"; subpaths: Subpath[]; text?: TextMeta };

/** Replaces a path's outlines and **drops its `text`** (spec M10 §3). Every place that bakes
 *  geometry into a path must go through here: re-typing a title re-derives its outlines from the
 *  font, so any baked-in reshaping, resize or flatten would be silently thrown away on the next
 *  keystroke. `path-edit.ts` had this funnel from the start; `resize.ts` and `flattenTransform`
 *  did not, and both lost the change on the next edit — a resize snapped back, and a flattened
 *  title teleported to the origin. */
export function withBakedSubpaths(p: PathShape, subpaths: Subpath[]): PathShape {
  const next = { ...p, subpaths };
  delete next.text;
  return next;
}

/** A **uniform** scale IS expressible as a text size, so a title survives one (spec M10e §7).
 *  Glyph outlines scale linearly with size, so outlines scaled by `k` are exactly the outlines
 *  the font would give at `size * k` — which is what lets the baked subpaths and the metadata
 *  stay in agreement, so the next keystroke re-derives the same shape instead of snapping back.
 *
 *  Only the lengths scale. `size` and `letterSpacing` are px; `amounts.offset` is a px baseline
 *  shift and each override's `dx`/`dy` are px. `lineHeight` is already a MULTIPLE of the size, and
 *  `rotate`, `scale` and `skew` — with the matching `r`, `s`, `k` overrides — are degrees and
 *  ratios. Scaling those would rotate and skew the characters as the title is resized. */
export function scaleTextMeta(m: TextMeta, k: number): TextMeta {
  return {
    ...m,
    size: m.size * k,
    letterSpacing: m.letterSpacing * k,
    amounts: { ...m.amounts, offset: m.amounts.offset * k },
    overrides: Object.fromEntries(
      Object.entries(m.overrides).map(([i, o]) => [
        i,
        {
          ...o,
          ...(o.dx === undefined ? {} : { dx: o.dx * k }),
          ...(o.dy === undefined ? {} : { dy: o.dy * k }),
        },
      ]),
    ),
  };
}
export type Shape = RectShape | EllipseShape | PolygonShape | PathShape;

export type Group = NodeFlags & {
  kind: "group";
  id: string;
  name?: string;
  transform: Mat;
  opacity: number;
  children: Node[];
};
export type Node = Group | Shape;

/** Nothing reads `hidden`/`locked` directly (spec M9 §3). */
export const isHidden = (n: Node): boolean => n.hidden === true;
export const isLocked = (n: Node): boolean => n.locked === true;

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  children: Node[];
};

export type Artboard = { w: number; h: number; background: Paint | null };

export type Doc = {
  version: typeof DOC_VERSION;
  artboard: Artboard;
  layers: Layer[];
  nextId: number;
};

export const DEFAULT_STYLE: FlatStyle = {
  fill: { color: "#d9d9d9", opacity: 1 },
  stroke: { color: "#000000", opacity: 1 },
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
  opacity: 1,
};

export function idFor(n: number): string {
  return `n${n}`;
}

export function createDoc(w: number, h: number): Doc {
  return {
    version: DOC_VERSION,
    artboard: { w, h, background: { color: "#ffffff", opacity: 1 } },
    layers: [{ id: idFor(1), name: "Layer 1", visible: true, locked: false, children: [] }],
    nextId: 2,
  };
}

export function isValidArtboardSize(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_ARTBOARD;
}
