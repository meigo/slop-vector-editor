// Ported from slop-paint/src/brush.ts (widthRange, decimationSmoothing, strokeOutline), with the
// canvas drawing dropped: here the outline becomes a document path. This is the ONLY module that
// imports perfect-freehand.
import getStroke from "perfect-freehand";
import type { Subpath, PathNode } from "../doc/document";
import type { Vec } from "../geom/vec";
import { smoothPath, type StrokePoint } from "./smoothing";

export type OutlineOpts = {
  size: number; // nominal width, document px
  pressureRange: number; // 1 = constant width (mouse, finger)
  taper: boolean;
  smoothRadius: number; // document px; pathSmoothRadius(smooth, zoom)
  last: boolean; // true once the pen has lifted
};

/**
 * Pressure → width. `size` is the nominal width: light pressure thins to `size / sizeRange`
 * (floored at 0.5px), full pressure widens to `size * sizeRange`. `sizeRange === 1` is a
 * constant width — the mouse path, which has no pressure.
 */
export function widthRange(size: number, sizeRange: number): { min: number; max: number } {
  const floored = Math.max(0.5, size);
  return { min: Math.max(0.5, floored / sizeRange), max: floored * sizeRange };
}

/**
 * perfect-freehand's `smoothing` is a DECIMATION DISTANCE: an outline point is dropped unless it
 * is farther than `pfSize * smoothing` from the last kept one. `pfSize` comes from the stroke's
 * MAXIMUM radius, so where the stroke is thin the spacing can exceed its own width; both walls
 * then bridge that run with chords that cross, and the nonzero fill leaves a hole (dashed
 * strokes at high Size range). Capping the spacing at the thinnest width the stroke actually
 * reaches fixes it without over-correcting strokes that never get thin. Ported from
 * slop-animator, where it removed 89% of gap cases in a parameter sweep.
 */
export function decimationSmoothing(
  smoothing: number,
  minStrokeWidth: number,
  pfSize: number,
): number {
  if (!(pfSize > 0)) return Math.max(0, smoothing);
  const cap = Math.max(0, minStrokeWidth) / pfSize;
  return Math.max(0, Math.min(smoothing, cap));
}

/** perfect-freehand's outline point spacing (its `smoothing`), before the thin-stroke cap. It
 *  was the Smooth slider once, but it only rounds the outline's edge; Smooth now smooths the path. */
const OUTLINE_SPACING = 0.5;

/** Closed outline polygon, document px; [] for no points. */
export function brushOutline(points: readonly StrokePoint[], o: OutlineOpts): Vec[] {
  if (points.length === 0) return [];
  // We map pressure → size ourselves and tell pf thinning=1 so it uses our mapped pressure directly.
  const { min: minSize, max: maxSize } = widthRange(o.size, o.pressureRange);
  const smoothed = smoothPath([...points], o.smoothRadius);
  // A stroke shorter than its own width tapers to nothing at both ends and leaves a sliver: a
  // tap must be a round dot (spec M21 §3), so taper applies only past one width of travel.
  let length = 0;
  for (let i = 1; i < smoothed.length; i++)
    length += Math.hypot(smoothed[i].x - smoothed[i - 1].x, smoothed[i].y - smoothed[i - 1].y);
  const taper = o.taper && length > o.size;
  let minStrokeWidth = Infinity;
  const input = smoothed.map((p) => {
    const want = minSize + p.pressure * (maxSize - minSize);
    if (want < minStrokeWidth) minStrokeWidth = want;
    return [p.x, p.y, maxSize > 0 ? want / maxSize : 1];
  });
  // perfect-freehand's `size` is a RADIUS basis (diameter = 2 * size * pressure), so pass half:
  // the rendered diameter then equals the wanted width.
  const pfSize = maxSize / 2;
  return getStroke(input, {
    size: pfSize,
    thinning: 1,
    smoothing: decimationSmoothing(OUTLINE_SPACING, minStrokeWidth, pfSize),
    streamline: 0.3,
    start: { taper, cap: !taper },
    end: { taper, cap: !taper },
    last: o.last,
    // Always use our supplied (mapped) pressure: simulatePressure is velocity-based and would
    // override our size mapping.
    simulatePressure: false,
  }).map(([x, y]) => ({ x, y }));
}

/** The exact midpoint-quadratic curve slop-paint fills, as a closed cubic subpath; null for
 *  fewer than 3 distinct points. */
export function outlineSubpath(outline: readonly Vec[]): Subpath | null {
  const pts: Vec[] = [];
  for (const p of outline) {
    const prev = pts[pts.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) pts.push(p);
  }
  while (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y)
    pts.pop();
  const n = pts.length;
  if (n < 3) return null;
  const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const toward = (m: Vec, c: Vec): Vec => ({
    x: m.x + (2 / 3) * (c.x - m.x),
    y: m.y + (2 / 3) * (c.y - m.y),
  });
  const nodes: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    // Node i sits at the midpoint of edge i→i+1; the quadratic through it has control p_i
    // on the way in and p_{i+1} on the way out.
    const c = pts[(i + 1) % n];
    const m = mid(pts[i], c);
    nodes.push({ p: m, in: toward(m, pts[i]), out: toward(m, c), type: "smooth" });
  }
  return { nodes, closed: true };
}

/** |signed area| of a polygon (shoelace). */
export function polygonArea(pts: readonly Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}
