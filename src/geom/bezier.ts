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

/** Appends points along `c` (excluding its start) to `out`. */
export function flattenCubic(c: Cubic, out: Vec[]): void {
  const len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
  const n = Math.min(64, Math.max(4, Math.ceil(len / 4)));
  for (let i = 1; i <= n; i++) out.push(cubicPoint(c, i / n));
}

/** A subpath as a polyline. A closed subpath ends back at its first point. */
export function flattenSubpath(sp: Subpath): Vec[] {
  const n = sp.nodes;
  if (n.length === 0) return [];
  const out: Vec[] = [n[0].p];
  const segment = (a: PathNode, b: PathNode) => {
    const c = segmentCubic(a, b);
    if (c) flattenCubic(c, out);
    else out.push(b.p);
  };
  for (let i = 1; i < n.length; i++) segment(n[i - 1], n[i]);
  if (sp.closed && n.length > 1) segment(n[n.length - 1], n[0]);
  return out;
}
