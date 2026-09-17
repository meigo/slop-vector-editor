import type { Vec } from "./vec";

/** An affine matrix in SVG's `matrix(a b c d e f)` order:
 *  x' = a·x + c·y + e,  y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m ∘ n`: the result applies `n` first, then `m` (same as SVG `transform="m n"`). */
export function multiply(m: Mat, n: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

export function applyMat(m: Mat, p: Vec): Vec {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Mat): Mat | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function translate(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy: number = sx): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function skewX(rad: number): Mat {
  return [1, 0, Math.tan(rad), 1, 0, 0];
}

export function skewY(rad: number): Mat {
  return [1, Math.tan(rad), 0, 1, 0, 0];
}

export function isIdentity(m: Mat, eps = 1e-9): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) <= eps);
}

/** The rotation of the matrix's x axis, in radians. */
export function rotationOf(m: Mat): number {
  return Math.atan2(m[1], m[0]);
}

/** True when the matrix maps a rectangle to a non-rectangle (shear, or a collapsed axis). */
export function isSkewed(m: Mat, eps = 1e-6): boolean {
  const la = Math.hypot(m[0], m[1]);
  const lb = Math.hypot(m[2], m[3]);
  if (la === 0 || lb === 0) return true;
  return Math.abs(m[0] * m[2] + m[1] * m[3]) / (la * lb) > eps;
}

/** Skew measured against the matrix's own scale: a tiny matrix with a proportionally large shear
 *  is not axis-aligned, and a huge one is not skewed by float dust. */
export function isAxisAligned(m: Mat, eps = 1e-9): boolean {
  const scale = Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  if (scale === 0) return true;
  return Math.abs(m[1]) <= eps * scale && Math.abs(m[2]) <= eps * scale;
}

/** Spec (M3b) §2.2. `W`, a document-space map, expressed in the space of a child under `parent`.
 *  Null when `parent` is singular — the caller then leaves that node alone. */
export function inParent(parent: Mat, W: Mat): Mat | null {
  const inv = invert(parent);
  return inv ? multiply(inv, multiply(W, parent)) : null;
}

/** The transform a node needs to keep its place on screen when its parent changes from `from` to
 *  `to`. Its world matrix is `from ∘ t`, and must stay that under `to`. */
export function reparent(from: Mat, to: Mat, t: Mat): Mat | null {
  const inv = invert(to);
  return inv ? multiply(inv, multiply(from, t)) : null;
}

/** Exact element-wise equality; used to tell "the parent did not change" from "it did". */
export function sameMat(a: Mat, b: Mat): boolean {
  return a.every((v, i) => v === b[i]);
}

export function rotateAbout(rad: number, c: Vec): Mat {
  return multiply(translate(c.x, c.y), multiply(rotate(rad), translate(-c.x, -c.y)));
}
