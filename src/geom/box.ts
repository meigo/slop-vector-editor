import type { Mat } from "./mat";
import type { Vec } from "./vec";

/** An axis-aligned rectangle. Sizes are non-negative, except a resize target passed to `boxMap`,
 *  whose negative size means "mirrored". */
export type Box = { x: number; y: number; w: number; h: number };

export function boxFromPoints(points: readonly Vec[]): Box | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function boxContains(outer: Box, inner: Box, eps = 1e-9): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

export function boxCenter(b: Box): Vec {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** nw, ne, se, sw */
export function boxCorners(b: Box): [Vec, Vec, Vec, Vec] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** The affine map taking `from` onto `to`. A negative `to` size mirrors. An axis where `from` has
 *  zero size (e.g. a horizontal line's height) keeps scale 1 and only moves. */
export function boxMap(from: Box, to: Box): Mat {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return [sx, 0, 0, sy, to.x - sx * from.x, to.y - sy * from.y];
}
