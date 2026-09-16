import type { Doc, EllipseShape, Node, PathShape, Shape } from "../doc/document";
import { flattenSubpath } from "./bezier";
import { nodeBounds } from "./bounds";
import { boxContains, type Box } from "./box";
import { applyMat, IDENTITY, invert } from "./mat";
import type { Vec } from "./vec";

export type Hit = { layerId: string; nodeId: string };

/** Flattened subpaths, cached per (immutable) path object. */
const flatCache = new WeakMap<PathShape, Vec[][]>();

function polylines(s: PathShape): Vec[][] {
  let polys = flatCache.get(s);
  if (!polys) {
    polys = s.subpaths.map(flattenSubpath);
    flatCache.set(s, polys);
  }
  return polys;
}

/** Ellipse outline sampled as a closed polyline, cached per (immutable) ellipse object. */
const ellipseCache = new WeakMap<EllipseShape, Vec[][]>();

function ellipsePolylines(s: EllipseShape): Vec[][] {
  let polys = ellipseCache.get(s);
  if (!polys) {
    const n = 64;
    const pts: Vec[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (2 * Math.PI * (i % n)) / n;
      pts.push({ x: s.cx + s.rx * Math.cos(t), y: s.cy + s.ry * Math.sin(t) });
    }
    polys = [pts];
    ellipseCache.set(s, polys);
  }
  return polys;
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolylines(p: Vec, polys: Vec[][]): number {
  let best = Infinity;
  for (const poly of polys) {
    if (poly.length === 1) best = Math.min(best, Math.hypot(p.x - poly[0].x, p.y - poly[0].y));
    for (let i = 1; i < poly.length; i++)
      best = Math.min(best, distToSegment(p, poly[i - 1], poly[i]));
  }
  return best;
}

/** Nonzero winding over all polylines, each implicitly closed. */
function insideNonzero(p: Vec, polys: Vec[][]): boolean {
  let winding = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) {
        if (b.y > p.y && cross > 0) winding++;
      } else if (b.y <= p.y && cross < 0) {
        winding--;
      }
    }
  }
  return winding !== 0;
}

function shapeHit(s: Shape, p: Vec, tol: number): boolean {
  const reach = tol + (s.style.stroke ? s.style.strokeWidth / 2 : 0);
  switch (s.kind) {
    case "rect": {
      const inside = p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
      if (inside && s.style.fill) return true;
      const d = inside
        ? Math.min(p.x - s.x, s.x + s.w - p.x, p.y - s.y, s.y + s.h - p.y)
        : Math.hypot(
            Math.max(s.x - p.x, 0, p.x - (s.x + s.w)),
            Math.max(s.y - p.y, 0, p.y - (s.y + s.h)),
          );
      return d <= reach;
    }
    case "ellipse": {
      const nx = (p.x - s.cx) / s.rx;
      const ny = (p.y - s.cy) / s.ry;
      const q = Math.sqrt(nx * nx + ny * ny);
      if (q <= 1 && s.style.fill) return true;
      return distToPolylines(p, ellipsePolylines(s)) <= reach;
    }
    case "path": {
      const polys = polylines(s);
      if (s.style.fill && insideNonzero(p, polys)) return true;
      return distToPolylines(p, polys) <= reach;
    }
  }
}

function nodeHit(n: Node, p: Vec, tol: number): boolean {
  const inv = invert(n.transform);
  if (!inv) return false;
  const m = n.transform;
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const lp = applyMat(inv, p);
  const lt = tol / s;
  if (n.kind === "group") return n.children.some((c) => nodeHit(c, lp, lt));
  return shapeHit(n, lp, lt);
}

export function hitTest(doc: Doc, p: Vec, tol: number): Hit | null {
  for (let li = doc.layers.length - 1; li >= 0; li--) {
    const layer = doc.layers[li];
    if (!layer.visible || layer.locked) continue;
    for (let i = layer.children.length - 1; i >= 0; i--) {
      const n = layer.children[i];
      if (nodeHit(n, p, tol)) return { layerId: layer.id, nodeId: n.id };
    }
  }
  return null;
}

export function marqueeSelect(doc: Doc, box: Box): string[] {
  const out: string[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const n of layer.children) {
      const b = nodeBounds(n, IDENTITY);
      if (b && boxContains(box, b)) out.push(n.id);
    }
  }
  return out;
}
