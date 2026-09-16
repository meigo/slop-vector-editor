import type { Doc, LineCap, LineJoin, Paint, Style } from "../doc/document";
import { rotateNodes, translateNodes } from "../doc/edits";
import { resizeNodes } from "../doc/resize";
import { findTopLevel, shapesOf } from "../doc/tree";
import { isIdentity } from "../geom/mat";
import { frameCenter, frameResizeMap, selectionBounds, selectionFrame } from "../tools/frame";
import { normalizeAngle } from "../tools/gizmo";

export type Field<T> = { mixed: true } | { mixed: false; value: T };

export type StyleSummary = {
  fill: Field<Paint | null>;
  stroke: Field<Paint | null>;
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
    strokeWidth: merge(styles.map((s) => s.strokeWidth)),
    cap: merge(styles.map((s) => s.cap)),
    join: merge(styles.map((s) => s.join)),
    opacity: merge(styles.map((s) => s.opacity)),
  };
}

export type SelectionActions = { canConvert: boolean; canFlatten: boolean };

/** Which shape actions apply to the selection (shared by the context bar and the context menu). */
export function selectionActions(doc: Doc, ids: readonly string[]): SelectionActions {
  const nodes = ids.flatMap((id) => findTopLevel(doc, id)?.node ?? []);
  return {
    canConvert: nodes.some((n) => n.kind === "rect" || n.kind === "ellipse"),
    canFlatten: nodes.some((n) => n.kind === "path" && !isIdentity(n.transform)),
  };
}

export function selectionStyles(doc: Doc, ids: readonly string[]): Style[] {
  return ids.flatMap((id) => {
    const f = findTopLevel(doc, id);
    return f ? shapesOf(f.node).map((s) => s.style) : [];
  });
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
