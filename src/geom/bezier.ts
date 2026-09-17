import type { PathNode, Subpath } from "../doc/document";
import { boxFromPoints, type Box } from "./box";
import { dist, type Vec } from "./vec";

export type Cubic = readonly [Vec, Vec, Vec, Vec];

export function cubicPoint(c: Cubic, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

/** Parameters in (0, 1) where one coordinate of the cubic has a derivative of zero. */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  const u = p1 - p0;
  const v = p2 - p1;
  const w = p3 - p2;
  const A = u - 2 * v + w;
  const B = 2 * (v - u);
  const C = u;
  const roots: number[] = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) roots.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-B + s) / (2 * A), (-B - s) / (2 * A));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

export function cubicBounds(c: Cubic): Box {
  const pts: Vec[] = [c[0], c[3]];
  for (const t of extremaT(c[0].x, c[1].x, c[2].x, c[3].x)) pts.push(cubicPoint(c, t));
  for (const t of extremaT(c[0].y, c[1].y, c[2].y, c[3].y)) pts.push(cubicPoint(c, t));
  return boxFromPoints(pts)!;
}

/** The segment from `a` to `b` as a cubic, or null when it is a straight line. */
export function segmentCubic(a: PathNode, b: PathNode): Cubic | null {
  if (!a.out && !b.in) return null;
  return [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
}

/** de Casteljau: `c` split at `t` into the two cubics that together draw the same curve. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (a: Vec, b: Vec): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(c[0], c[1]);
  const b = lerp(c[1], c[2]);
  const d = lerp(c[2], c[3]);
  const e = lerp(a, b);
  const f = lerp(b, d);
  const m = lerp(e, f);
  return [
    [c[0], a, e, m],
    [m, f, d, c[3]],
  ];
}

/** Appends points along `c` (excluding its start) to `out`. `scale` is how many device pixels a
 *  document unit covers, so a curve drawn large is sampled finely (spec M4a §5). */
export function flattenCubic(c: Cubic, out: Vec[], scale = 1): void {
  const len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
  const n = Math.min(256, Math.max(4, Math.ceil((len * scale) / 4)));
  for (let i = 1; i <= n; i++) out.push(cubicPoint(c, i / n));
}

/** A subpath as a polyline. A closed subpath ends back at its first point. */
export function flattenSubpath(sp: Subpath, scale = 1): Vec[] {
  const n = sp.nodes;
  if (n.length === 0) return [];
  const out: Vec[] = [n[0].p];
  const segment = (a: PathNode, b: PathNode) => {
    const c = segmentCubic(a, b);
    if (c) flattenCubic(c, out, scale);
    else out.push(b.p);
  };
  for (let i = 1; i < n.length; i++) segment(n[i - 1], n[i]);
  if (sp.closed && n.length > 1) segment(n[n.length - 1], n[0]);
  return out;
}

export type NearestOnPath = { seg: number; t: number; point: Vec; dist: number };

/** The point on `sp` nearest to `p`. `seg` is the index of the segment's first node; for a closed
 *  subpath the last segment runs from the last node back to node 0. */
export function nearestOnSubpath(sp: Subpath, p: Vec): NearestOnPath | null {
  const n = sp.nodes;
  if (n.length < 2) return null;
  const segments: { a: PathNode; b: PathNode; seg: number }[] = [];
  for (let i = 1; i < n.length; i++) segments.push({ a: n[i - 1], b: n[i], seg: i - 1 });
  if (sp.closed) segments.push({ a: n[n.length - 1], b: n[0], seg: n.length - 1 });

  let best: NearestOnPath | null = null;
  for (const { a, b, seg } of segments) {
    const c = segmentCubic(a, b);
    const at = (t: number): Vec =>
      c ? cubicPoint(c, t) : { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t };
    const SAMPLES = 24;
    let coarse = 0;
    let coarseDist = Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const d = dist(p, at(t));
      if (d < coarseDist) {
        coarseDist = d;
        coarse = t;
      }
    }
    let lo = Math.max(0, coarse - 1 / SAMPLES);
    let hi = Math.min(1, coarse + 1 / SAMPLES);
    for (let k = 0; k < 48; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (dist(p, at(m1)) <= dist(p, at(m2))) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const point = at(t);
    const d = dist(p, point);
    if (!best || d < best.dist) best = { seg, t, point, dist: d };
  }
  return best;
}
