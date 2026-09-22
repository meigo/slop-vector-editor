import {
  isHidden,
  type Doc,
  type EllipseShape,
  type Node,
  type PathShape,
  type PolygonShape,
  type RectShape,
  type Shape,
  type Subpath,
} from "../doc/document";
import { enteredReach, reachableNodes, topLevelReach, type Reachable } from "../doc/tree";
import { flattenSubpath } from "./bezier";
import { nodeBounds } from "./bounds";
import { boxContains, type Box } from "./box";
import { applyMat, IDENTITY, invert } from "./mat";
import { polygonSubpath, rectPath } from "./shapes";
import type { Vec } from "./vec";

export type Hit = { layerId: string; nodeId: string };

/** Flattened subpaths, cached per (immutable) subpath array and per scale bucket, so moving or
 *  rotating a path keeps the cache and zooming only adds one entry per power of two. */
const flatCache = new WeakMap<readonly Subpath[], Map<number, Vec[][]>>();

const bucketOf = (scale: number) =>
  scale > 0 && Number.isFinite(scale) ? 2 ** Math.round(Math.log2(scale)) : 1;

function polylines(s: PathShape, scale: number): Vec[][] {
  const bucket = bucketOf(scale);
  let perScale = flatCache.get(s.subpaths);
  if (!perScale) {
    perScale = new Map();
    flatCache.set(s.subpaths, perScale);
  }
  let polys = perScale.get(bucket);
  if (!polys) {
    polys = s.subpaths.map((sp) => flattenSubpath(sp, bucket));
    perScale.set(bucket, polys);
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

/** Rounded-rect outline, cached per (immutable) rect. A zero radius never comes here. */
const rectCache = new WeakMap<RectShape, Vec[][]>();

function rectRadius(s: RectShape): number {
  return Math.min(Math.max(s.rx, 0), s.w / 2, s.h / 2);
}

function rectPolylines(s: RectShape): Vec[][] {
  let polys = rectCache.get(s);
  if (!polys) {
    const r = rectRadius(s);
    polys = [flattenSubpath(rectPath(s.x, s.y, s.w, s.h, r, r))];
    rectCache.set(s, polys);
  }
  return polys;
}

/** Polygon outline, cached per (immutable) polygon object. */
const polygonCache = new WeakMap<PolygonShape, Vec[][]>();

function polygonPolylines(s: PolygonShape): Vec[][] {
  let polys = polygonCache.get(s);
  if (!polys) {
    polys = [flattenSubpath(polygonSubpath(s))];
    polygonCache.set(s, polys);
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

function shapeHit(s: Shape, p: Vec, tol: number, scale = 1): boolean {
  const reach = tol + (s.style.stroke ? s.style.strokeWidth / 2 : 0);
  switch (s.kind) {
    case "rect": {
      // A corner radius is drawn; the sharp box both hits empty corners and misses the arc.
      if (rectRadius(s) > 0) {
        const polys = rectPolylines(s);
        if (s.style.fill && insideNonzero(p, polys)) return true;
        return distToPolylines(p, polys) <= reach;
      }
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
    case "polygon": {
      const polys = polygonPolylines(s);
      if (s.style.fill && insideNonzero(p, polys)) return true;
      return distToPolylines(p, polys) <= reach;
    }
    case "path": {
      const polys = polylines(s, scale);
      if (s.style.fill && insideNonzero(p, polys)) return true;
      return distToPolylines(p, polys) <= reach;
    }
  }
}

function nodeHit(n: Node, p: Vec, tol: number, scale = 1): boolean {
  // A hidden descendant of a group is not offered to hitTest on its own — the group is — so the
  // check has to happen here, before the walk. A locked child stays hittable: it is visible, and
  // the click selects the group.
  if (isHidden(n)) return false;
  const inv = invert(n.transform);
  if (!inv) return false;
  const m = n.transform;
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const lp = applyMat(inv, p);
  const lt = tol / s;
  if (n.kind === "group") return n.children.some((c) => nodeHit(c, lp, lt, scale * s));
  return shapeHit(n, lp, lt, scale * s);
}

function hitIn(reach: readonly Reachable[], p: Vec, tol: number): Hit | null {
  for (let i = reach.length - 1; i >= 0; i--) {
    const { node, layer, parent } = reach[i];
    if (parent === IDENTITY) {
      if (nodeHit(node, p, tol)) return { layerId: layer.id, nodeId: node.id };
      continue;
    }
    const inv = invert(parent);
    if (!inv) continue;
    const scale = Math.sqrt(Math.abs(parent[0] * parent[3] - parent[1] * parent[2]));
    if (nodeHit(node, applyMat(inv, p), tol / scale, scale)) {
      return { layerId: layer.id, nodeId: node.id };
    }
  }
  return null;
}

/** Hit-testing searches in **two tiers** when the user is inside a group: the group's children
 *  first, then the top level. That second tier is not an oversight — it is what lets a click on a
 *  sibling outside the group select it, and a click on empty canvas leave the group (invariant 28).
 *  `selectableIds` and `marqueeSelect` stop at the first tier, which is why all three share
 *  `enteredReach`/`topLevelReach` rather than a single verdict. */
export function hitTest(
  doc: Doc,
  p: Vec,
  tol: number,
  enteredGroupId: string | null = null,
): Hit | null {
  const inner = enteredReach(doc, enteredGroupId);
  return (inner && hitIn(inner, p, tol)) ?? hitIn(topLevelReach(doc), p, tol);
}

export function marqueeSelect(doc: Doc, box: Box, enteredGroupId: string | null = null): string[] {
  const out: string[] = [];
  for (const { node, parent } of reachableNodes(doc, enteredGroupId)) {
    const b = nodeBounds(node, parent);
    if (b && boxContains(box, b)) out.push(node.id);
  }
  return out;
}
