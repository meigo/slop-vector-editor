import type { EllipseShape, PathNode, PathShape, RectShape, Subpath } from "../doc/document";
import { applyMat, type Mat } from "./mat";
import type { Vec } from "./vec";

/** Handle length for a quarter-ellipse cubic. */
export const KAPPA = 0.5522847498;

const node = (p: Vec, inH: Vec | null = null, out: Vec | null = null): PathNode => ({
  p,
  in: inH,
  out,
  type: "corner",
});

/** Merges consecutive nodes at the same point (including last → first of a closed path). */
function mergeCoincident(nodes: PathNode[]): PathNode[] {
  const same = (a: PathNode, b: PathNode) => a.p.x === b.p.x && a.p.y === b.p.y;
  const merge = (a: PathNode, b: PathNode): PathNode => ({
    p: a.p,
    in: a.in,
    out: b.out,
    type: a.in && b.out ? "smooth" : a.type,
  });
  const out: PathNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && same(last, n)) out[out.length - 1] = merge(last, n);
    else out.push(n);
  }
  if (out.length > 1 && same(out[out.length - 1], out[0])) {
    out[0] = merge(out[out.length - 1], out[0]);
    out.pop();
  }
  return out;
}

/** A rectangle as a closed path, clockwise from the top edge. */
export function rectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): Subpath {
  if (rx <= 0 || ry <= 0) {
    return {
      closed: true,
      nodes: [
        node({ x, y }),
        node({ x: x + w, y }),
        node({ x: x + w, y: y + h }),
        node({ x, y: y + h }),
      ],
    };
  }
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const r = x + w;
  const b = y + h;
  return {
    closed: true,
    nodes: mergeCoincident([
      node({ x: x + rx, y }, { x: x + rx - kx, y }, null),
      node({ x: r - rx, y }, null, { x: r - rx + kx, y }),
      node({ x: r, y: y + ry }, { x: r, y: y + ry - ky }, null),
      node({ x: r, y: b - ry }, null, { x: r, y: b - ry + ky }),
      node({ x: r - rx, y: b }, { x: r - rx + kx, y: b }, null),
      node({ x: x + rx, y: b }, null, { x: x + rx - kx, y: b }),
      node({ x, y: b - ry }, { x, y: b - ry + ky }, null),
      node({ x, y: y + ry }, null, { x, y: y + ry - ky }),
    ]),
  };
}

export function linePath(a: Vec, b: Vec): Subpath {
  return { closed: false, nodes: [node(a), node(b)] };
}

export function polygonPath(c: Vec, r: number, sides: number, rotation: number): Subpath {
  const nodes: PathNode[] = [];
  for (let i = 0; i < sides; i++) {
    const t = rotation + (i * 2 * Math.PI) / sides;
    nodes.push(node({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }));
  }
  return { closed: true, nodes };
}

export function starPath(
  c: Vec,
  r: number,
  innerRatio: number,
  points: number,
  rotation: number,
): Subpath {
  const nodes: PathNode[] = [];
  for (let i = 0; i < 2 * points; i++) {
    const t = rotation + (i * Math.PI) / points;
    const radius = i % 2 === 0 ? r : r * innerRatio;
    nodes.push(node({ x: c.x + radius * Math.cos(t), y: c.y + radius * Math.sin(t) }));
  }
  return { closed: true, nodes };
}

/** A closed ellipse from four symmetric nodes: right, bottom, left, top (clockwise on screen). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const sym = (p: Vec, inH: Vec, out: Vec): PathNode => ({ p, in: inH, out, type: "symmetric" });
  return {
    closed: true,
    nodes: [
      sym({ x: cx + rx, y: cy }, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
      sym({ x: cx, y: cy + ry }, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
      sym({ x: cx - rx, y: cy }, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
      sym({ x: cx, y: cy - ry }, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
    ],
  };
}

export function transformSubpaths(subpaths: readonly Subpath[], m: Mat): Subpath[] {
  const f = (p: Vec) => applyMat(m, p);
  return subpaths.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      p: f(n.p),
      in: n.in && f(n.in),
      out: n.out && f(n.out),
      type: n.type,
    })),
  }));
}

/** An equivalent path in the same local space, with the same id, name, transform and style. */
export function toPath(s: RectShape | EllipseShape): PathShape {
  let sp: Subpath;
  if (s.kind === "rect") {
    const r = Math.min(s.rx, s.w / 2, s.h / 2);
    sp = rectPath(s.x, s.y, s.w, s.h, r, r);
  } else {
    sp = ellipsePath(s.cx, s.cy, s.rx, s.ry);
  }
  const out: PathShape = {
    kind: "path",
    id: s.id,
    transform: s.transform,
    style: s.style,
    subpaths: [sp],
  };
  if (s.name !== undefined) out.name = s.name;
  return out;
}
