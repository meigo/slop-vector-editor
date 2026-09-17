import type {
  Doc,
  LineCap,
  LineJoin,
  NodeType,
  Paint,
  PolygonShape,
  RectShape,
  Style,
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
  fill: Field<Paint | null>;
  stroke: Field<Paint | null>;
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

function samePaint(a: Paint | null, b: Paint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.color === b.color && a.opacity === b.opacity;
}

function merge<T>(values: readonly T[], eq: (a: T, b: T) => boolean = (a, b) => a === b): Field<T> {
  const first = values[0];
  return values.every((v) => eq(v, first)) ? { mixed: false, value: first } : { mixed: true };
}

export function summarizeStyles(styles: readonly Style[]): StyleSummary | null {
  if (styles.length === 0) return null;
  return {
    fill: merge(
      styles.map((s) => s.fill),
      samePaint,
    ),
    stroke: merge(
      styles.map((s) => s.stroke),
      samePaint,
    ),
    fillOn: merge(styles.map((s) => s.fill !== null)),
    strokeOn: merge(styles.map((s) => s.stroke !== null)),
    strokeWidth: merge(styles.map((s) => s.strokeWidth)),
    cap: merge(styles.map((s) => s.cap)),
    join: merge(styles.map((s) => s.join)),
    opacity: merge(styles.map((s) => s.opacity)),
  };
}

export type SelectionActions = {
  canConvert: boolean;
  canFlatten: boolean;
  canGroup: boolean;
  canUngroup: boolean;
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
