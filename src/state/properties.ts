import { booleanRefusal, type BoolRefusal } from "../doc/boolean-edit";
import type { GradientKind, PaintSlot } from "../doc/paint-edit";
import { pathOpRefusals, type PathOp } from "../doc/path-ops";
import {
  isGradient,
  midOf,
  sameColours,
  samePaint,
  type Doc,
  type Fill,
  type LineCap,
  type LineJoin,
  type NodeType,
  type Paint,
  type PolygonShape,
  type RectShape,
  type Style,
} from "../doc/document";
import { rotateNodes, translateNodes } from "../doc/edits";
import type { NodeRef } from "../doc/path-edit";
import { resizeNodes } from "../doc/resize";
import { findNode, shapesOf } from "../doc/tree";
import { isIdentity } from "../geom/mat";
import type { Vec } from "../geom/vec";
import { frameCenter, frameResizeMap, selectionBounds, selectionFrame } from "../tools/frame";
import { normalizeAngle } from "../tools/gizmo";

export type Field<T> = { mixed: true } | { mixed: false; value: T };

export type StyleSummary = {
  fill: Field<Fill | null>;
  stroke: Field<Fill | null>;
  fillOn: Field<boolean>;
  strokeOn: Field<boolean>;
  strokeWidth: Field<number>;
  cap: Field<LineCap>;
  join: Field<LineJoin>;
  opacity: Field<number>;
};

export type Geometry = { x: number; y: number; w: number; h: number; r: number };
export type GeometryField = keyof Geometry;

const EPS = 1e-9;

function merge<T>(values: readonly T[], eq: (a: T, b: T) => boolean = (a, b) => a === b): Field<T> {
  const first = values[0];
  return values.every((v) => eq(v, first)) ? { mixed: false, value: first } : { mixed: true };
}

export function summarizeStyles(styles: readonly Style[]): StyleSummary | null {
  if (styles.length === 0) return null;
  return {
    fill: merge(
      styles.map((s) => s.fill),
      sameColours,
    ),
    stroke: merge(
      styles.map((s) => s.stroke),
      sameColours,
    ),
    fillOn: merge(styles.map((s) => s.fill !== null)),
    strokeOn: merge(styles.map((s) => s.stroke !== null)),
    strokeWidth: merge(styles.map((s) => s.strokeWidth)),
    cap: merge(styles.map((s) => s.cap)),
    join: merge(styles.map((s) => s.join)),
    opacity: merge(styles.map((s) => s.opacity)),
  };
}

export type GradientSummary = {
  kind: Field<"flat" | "linear" | "radial">;
  stops: { start: Field<Paint>; end: Field<Paint> } | null;
  /** Spec M17 §5: null exactly when `stops` is. */
  mid: Field<number> | null;
};

/** Spec M15 §6, M16 §5: which kind each non-null paint is (its own kind for a gradient), and —
 *  when every one is a gradient — each stop merged across them. Null when no selected shape has
 *  this paint. */
export function summarizeGradient(
  styles: readonly Style[],
  which: "fill" | "stroke",
): GradientSummary | null {
  const fills = styles.map((s) => s[which]).filter((f): f is Fill => f !== null);
  if (fills.length === 0) return null;
  const kind = merge(
    fills.map((f) => (isGradient(f) ? f.kind : "flat") as "flat" | "linear" | "radial"),
  );
  const grads = fills.filter(isGradient);
  const stops =
    grads.length === fills.length
      ? {
          start: merge(
            grads.map((g) => g.start),
            samePaint,
          ),
          end: merge(
            grads.map((g) => g.end),
            samePaint,
          ),
        }
      : null;
  const mid = stops ? merge(grads.map(midOf)) : null;
  return { kind, stops, mid };
}

/** Spec M16 §5: the Type row's value — the kind of the selection's gradients on `which`, or
 *  `fallback` (the kind the tool draws) when none of them is one. Flat paints don't count towards
 *  the merge, so a mix of one gradient and one flat paint still reads as that gradient's kind. */
export function gradientTypeShown(
  styles: readonly Style[],
  which: PaintSlot,
  fallback: GradientKind,
): Field<GradientKind> {
  const grads = styles.map((s) => s[which]).filter(isGradient);
  return grads.length === 0 ? { mixed: false, value: fallback } : merge(grads.map((g) => g.kind));
}

export type SelectionActions = {
  canConvert: boolean;
  canFlatten: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  /** A group has no Style, so the paint commands need at least one non-group (spec M6 §6). */
  canSelectSameStyle: boolean;
  canSelectSameKind: boolean;
  /** null when a boolean operation can run; otherwise why it cannot (spec M7 §7). */
  booleanRefusal: BoolRefusal | null;
  /** null per operation when it can run; otherwise why it cannot (spec M11 §7). */
  pathReason: Readonly<Record<PathOp, string | null>>;
};

/** Which shape actions apply to the selection (shared by the top bar and the context menu). */
export function selectionActions(doc: Doc, ids: readonly string[]): SelectionActions {
  const nodes = ids.flatMap((id) => findNode(doc, id)?.node ?? []);
  return {
    canConvert: nodes.some(
      (n) => n.kind === "rect" || n.kind === "ellipse" || n.kind === "polygon",
    ),
    canFlatten: nodes.some((n) => n.kind === "path" && !isIdentity(n.transform)),
    canGroup: nodes.length > 0,
    canUngroup: nodes.some((n) => n.kind === "group"),
    canSelectSameStyle: nodes.some((n) => n.kind !== "group"),
    canSelectSameKind: nodes.length > 0,
    booleanRefusal: booleanRefusal(doc, ids),
    pathReason: pathOpRefusals(doc, ids),
  };
}

export type PolygonSummary = {
  sides: number | null;
  star: boolean | "mixed";
  innerRatio: number | null;
  anyStar: boolean;
};

/** Shape-section values for a selection made only of polygons (spec M2c §5); null otherwise. */
export function summarizePolygons(doc: Doc, ids: readonly string[]): PolygonSummary | null {
  const nodes = ids.flatMap((id) => findNode(doc, id)?.node ?? []);
  const polys = nodes.filter((n): n is PolygonShape => n.kind === "polygon");
  if (polys.length === 0 || polys.length !== nodes.length) return null;
  const same = <T>(values: T[]): T | null =>
    values.every((v) => v === values[0]) ? values[0] : null;
  const stars = polys.map((p) => p.star);
  return {
    sides: same(polys.map((p) => p.sides)),
    star: same(stars) ?? "mixed",
    innerRatio: same(polys.map((p) => p.innerRatio)),
    anyStar: stars.some(Boolean),
  };
}

export type RectSummary = { radius: number | null };

/** Shape-section value for a selection made only of rects (spec M2e §5); null otherwise. */
export function summarizeRects(doc: Doc, ids: readonly string[]): RectSummary | null {
  const nodes = ids.flatMap((id) => findNode(doc, id)?.node ?? []);
  const rects = nodes.filter((n): n is RectShape => n.kind === "rect");
  if (rects.length === 0 || rects.length !== nodes.length) return null;
  return { radius: rects.every((r) => r.rx === rects[0].rx) ? rects[0].rx : null };
}

export function selectionStyles(doc: Doc, ids: readonly string[]): Style[] {
  return ids.flatMap((id) => {
    const f = findNode(doc, id);
    return f ? shapesOf(f.node).map((s) => s.style) : [];
  });
}

/** Spec (M3b) §7: the opacity the Opacity field edits — a group's own, or a shape's style. */
export function selectionOpacity(doc: Doc, ids: readonly string[]): Field<number> | null {
  const values = ids.flatMap((id) => {
    const f = findNode(doc, id);
    if (!f) return [];
    return [f.node.kind === "group" ? f.node.opacity : f.node.style.opacity];
  });
  return values.length === 0 ? null : merge(values);
}

export function selectionGeometry(doc: Doc, ids: readonly string[]): Geometry | null {
  const b = selectionBounds(doc, ids);
  const f = selectionFrame(doc, ids);
  if (!b || !f) return null;
  return { x: b.x, y: b.y, w: f.box.w, h: f.box.h, r: (normalizeAngle(f.angle) * 180) / Math.PI };
}

export function applyGeometryField(
  doc: Doc,
  ids: readonly string[],
  field: GeometryField,
  value: number,
): Doc {
  if (!Number.isFinite(value)) return doc;
  if (field === "x" || field === "y") {
    const b = selectionBounds(doc, ids);
    if (!b) return doc;
    const d = value - (field === "x" ? b.x : b.y);
    if (Math.abs(d) < EPS) return doc;
    return field === "x" ? translateNodes(doc, ids, d, 0) : translateNodes(doc, ids, 0, d);
  }
  const f = selectionFrame(doc, ids);
  if (!f) return doc;
  if (field === "r") {
    const delta = normalizeAngle((value * Math.PI) / 180 - f.angle);
    if (Math.abs(delta) < EPS) return doc;
    return rotateNodes(doc, ids, delta, frameCenter(f));
  }
  const current = field === "w" ? f.box.w : f.box.h;
  if (value <= 0 || current === 0 || Math.abs(value - current) < EPS) return doc;
  const to = field === "w" ? { ...f.box, w: value } : { ...f.box, h: value };
  return resizeNodes(doc, ids, frameResizeMap(f.angle, f.box, to));
}

/** Spec (M4a) §9: the Node section's values. */
export function selectedNodeSummary(
  doc: Doc,
  nodeTarget: string | null,
  nodeSel: readonly NodeRef[],
): { type: NodeType | "mixed"; point: Vec | null } | null {
  if (nodeTarget === null || nodeSel.length === 0) return null;
  const found = findNode(doc, nodeTarget);
  if (!found || found.node.kind !== "path") return null;
  const nodes = nodeSel.flatMap((r) =>
    found.node.kind === "path" ? (found.node.subpaths[r.sub]?.nodes[r.i] ?? []) : [],
  );
  if (nodes.length === 0) return null;
  const type = nodes.every((n) => n.type === nodes[0].type) ? nodes[0].type : "mixed";
  return { type, point: nodes.length === 1 ? nodes[0].p : null };
}
