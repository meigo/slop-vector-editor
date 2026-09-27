import type { NodeType, PathNode, Subpath } from "../doc/document";
import { type Cubic, cubicPoint, splitCubic } from "./bezier";
import type { Box } from "./box";
import { applyMat, invert, type Mat } from "./mat";
import type { Vec } from "./vec";

/** Spec M14 §2: the two handles of one boundary curve, in the edge's own direction. */
export type Edge = readonly [Vec, Vec];

/** Spec M14 §2: a Coons patch — four corners and four cubic boundary curves. `Top` runs
 *  P00→P10, `Right` P10→P11, `Bottom` P01→P11, `Left` P00→P01: every edge stored in increasing
 *  u/v, so none needs reversing when it is evaluated. */
export type Cage = {
  corners: readonly [Vec, Vec, Vec, Vec]; // P00 TL, P10 TR, P11 BR, P01 BL
  edges: readonly [Edge, Edge, Edge, Edge]; // Top P00→P10, Right P10→P11, Bottom P01→P11, Left P00→P01
};

const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Spec M14 §2: the cage that maps `box` to itself — corners at the box's own corners, each edge's
 *  handles at ⅓ and ⅔ along the straight edge, in the edge's own direction. Undragged, this cage
 *  is the identity (see `warpPoint`). */
export function identityCage(box: Box): Cage {
  const P00 = { x: box.x, y: box.y };
  const P10 = { x: box.x + box.w, y: box.y };
  const P11 = { x: box.x + box.w, y: box.y + box.h };
  const P01 = { x: box.x, y: box.y + box.h };
  const edge = (a: Vec, b: Vec): Edge => [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3)];
  return {
    corners: [P00, P10, P11, P01],
    edges: [edge(P00, P10), edge(P10, P11), edge(P01, P11), edge(P00, P01)],
  };
}

/** Spec M14 §2: whether `cage` is exactly `identityCage(box)` — every coordinate compared with
 *  `===`, which is what lets a warp edit short-circuit to the same document reference
 *  (invariant 1) when nothing was dragged. */
export function isIdentityCage(cage: Cage, box: Box): boolean {
  const id = identityCage(box);
  const sameVec = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;
  const sameEdge = (a: Edge, b: Edge) => sameVec(a[0], b[0]) && sameVec(a[1], b[1]);
  return (
    cage.corners.every((c, i) => sameVec(c, id.corners[i])) &&
    cage.edges.every((e, i) => sameEdge(e, id.edges[i]))
  );
}

/** Spec M14 §4: `WARP_TOL = max(1e-4, max(B.w, B.h) × 1e-4)` — relative to the cage, with a floor. */
export function warpTolerance(box: Box): number {
  return Math.max(1e-4, Math.max(box.w, box.h) * 1e-4);
}

/** Spec M14 §2: one of the cage's four boundary curves, in cage order (Top, Right, Bottom, Left) —
 *  used both for drawing the cage and by `warpPoint` below. */
export function edgeCubic(cage: Cage, i: 0 | 1 | 2 | 3): Cubic {
  const [P00, P10, P11, P01] = cage.corners;
  const ends: readonly [Vec, Vec][] = [
    [P00, P10],
    [P10, P11],
    [P01, P11],
    [P00, P01],
  ];
  const [a, b] = ends[i];
  const [h0, h1] = cage.edges[i];
  return [a, h0, h1, b];
}

/** Spec M14 §2: the Coons patch map. `q` is a document-space point; `box` is the selection's world
 *  bounds `B` that `u`/`v` normalise against. */
export function warpPoint(cage: Cage, box: Box, q: Vec): Vec {
  const u = (q.x - box.x) / box.w;
  const v = (q.y - box.y) / box.h;
  const [P00, P10, P11, P01] = cage.corners;
  const Top = cubicPoint(edgeCubic(cage, 0), u);
  const Right = cubicPoint(edgeCubic(cage, 1), v);
  const Bottom = cubicPoint(edgeCubic(cage, 2), u);
  const Left = cubicPoint(edgeCubic(cage, 3), v);
  const bilinear = (k00: number, k10: number, k01: number, k11: number) =>
    (1 - u) * (1 - v) * k00 + u * (1 - v) * k10 + (1 - u) * v * k01 + u * v * k11;
  return {
    x:
      (1 - v) * Top.x +
      v * Bottom.x +
      (1 - u) * Left.x +
      u * Right.x -
      bilinear(P00.x, P10.x, P01.x, P11.x),
    y:
      (1 - v) * Top.y +
      v * Bottom.y +
      (1 - u) * Left.y +
      u * Right.y -
      bilinear(P00.y, P10.y, P01.y, P11.y),
  };
}

/** Spec M14 §4: inverts the cubic Bernstein basis to recover the cubic through four points sampled
 *  at `t = 0, ⅓, ⅔, 1`. */
export function cubicThrough4(q0: Vec, q1: Vec, q2: Vec, q3: Vec): Cubic {
  const p1 = {
    x: (-5 * q0.x + 18 * q1.x - 9 * q2.x + 2 * q3.x) / 6,
    y: (-5 * q0.y + 18 * q1.y - 9 * q2.y + 2 * q3.y) / 6,
  };
  const p2 = {
    x: (2 * q0.x - 9 * q1.x + 18 * q2.x - 5 * q3.x) / 6,
    y: (2 * q0.y - 9 * q1.y + 18 * q2.y - 5 * q3.y) / 6,
  };
  return [q0, p1, p2, q3];
}

const vsub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const vlen = (a: Vec): number => Math.hypot(a.x, a.y);
const vdist = (a: Vec, b: Vec): number => vlen(vsub(a, b));

const MAX_DEPTH = 6;

/** Spec M14 §4: samples the world-space cubic `C` at `t = 0, ⅓, ⅔, 1`, maps through the patch,
 *  fits a cubic through the four warped points (`cubicThrough4`), and — when the fit strays more
 *  than `tol` from the true warped curve at `t = ⅙, ½, ⅚` — recurses on `C` split at 0.5
 *  (`splitCubic`), up to `MAX_DEPTH`. Splitting the original curve rather than the fit keeps error
 *  from compounding across levels. */
function fit(cage: Cage, box: Box, C: Cubic, tol: number, depth: number): Cubic[] {
  const S = (t: number) => warpPoint(cage, box, cubicPoint(C, t));
  const F = cubicThrough4(S(0), S(1 / 3), S(2 / 3), S(1));
  let error = 0;
  for (const t of [1 / 6, 1 / 2, 5 / 6]) {
    const d = vdist(S(t), cubicPoint(F, t));
    if (d > error) error = d;
  }
  if (error > tol && depth < MAX_DEPTH) {
    const [a, b] = splitCubic(C, 0.5);
    return [...fit(cage, box, a, tol, depth + 1), ...fit(cage, box, b, tol, depth + 1)];
  }
  return [F];
}

/** One fitted piece of a refit segment, in world space: `p` is the piece's end point (a new node's
 *  position), `outH`/`inH` are the previous/new node's handles (both null when the piece is
 *  straight — spec M14 §4). */
type Piece = { p: Vec; outH: Vec | null; inH: Vec | null };

/** Converts a fitted cubic into a `Piece`, emitting a straight piece when both interior control
 *  points land within `tol × 1e-3` of the corresponding third of the chord (spec M14 §4). */
function pieceOf(F: Cubic, tol: number): Piece {
  const [P0, P1, P2, P3] = F;
  const straightTol = tol * 1e-3;
  const straight =
    vdist(P1, lerp(P0, P3, 1 / 3)) <= straightTol && vdist(P2, lerp(P0, P3, 2 / 3)) <= straightTol;
  return straight ? { p: P3, outH: null, inH: null } : { p: P3, outH: P1, inH: P2 };
}

/** Spec M14 §4: node types recomputed from the fitted handles — a non-affine map does not preserve
 *  collinearity, so carrying the old type across would be a lie. */
function typeFromHandles(p: Vec, inH: Vec | null, outH: Vec | null): NodeType {
  if (!inH || !outH) return "corner";
  const toOut = vsub(outH, p);
  const toIn = vsub(p, inH);
  const lenOut = vlen(toOut);
  const lenIn = vlen(toIn);
  if (lenOut === 0 || lenIn === 0) return "corner";
  const cross = toOut.x * toIn.y - toOut.y * toIn.x;
  const dot = toOut.x * toIn.x + toOut.y * toIn.y;
  if (Math.abs(cross) > 1e-6 * lenOut * lenIn || dot <= 0) return "corner";
  return Math.abs(lenOut - lenIn) <= 1e-6 * Math.max(lenOut, lenIn) ? "symmetric" : "smooth";
}

/** The world-space cubic for the segment `a → b`. A straight segment — both handles null — is the
 *  cubic `[a, a+(b−a)/3, a+2(b−a)/3, b]` (spec M14 §4): the uniform-parametrization degree
 *  elevation of the line, not the endpoint-repeated `[a, a, b, b]`, which would make `t` run at a
 *  non-linear speed along it and break the exactness result for a straight edge. `world` is
 *  affine, so mapping these control points through it keeps the same property in world space. */
function segmentWorldCubic(a: Vec, aOut: Vec | null, bIn: Vec | null, b: Vec, world: Mat): Cubic {
  const local: Cubic =
    aOut === null && bIn === null
      ? [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b]
      : [a, aOut ?? a, bIn ?? b, b];
  return local.map((p) => applyMat(world, p)) as unknown as Cubic;
}

/** Appends one segment's fitted `pieces` (world space) onto `outNodes` (local space, via
 *  `toLocal`): the previous node's `out` becomes the piece's `outH` and a new node is pushed at the
 *  piece's `p`, carrying `inH` as its `in` (spec M14 §4 assembly rule). Both endpoints' types are
 *  recomputed from the handles now known. */
function appendPieces(
  outNodes: PathNode[],
  pieces: readonly Piece[],
  toLocal: (p: Vec) => Vec,
): void {
  for (const piece of pieces) {
    const prev = outNodes[outNodes.length - 1];
    const outLocal = piece.outH ? toLocal(piece.outH) : null;
    const inLocal = piece.inH ? toLocal(piece.inH) : null;
    const pLocal = toLocal(piece.p);
    outNodes[outNodes.length - 1] = {
      ...prev,
      out: outLocal,
      type: typeFromHandles(prev.p, prev.in, outLocal),
    };
    outNodes.push({
      p: pLocal,
      in: inLocal,
      out: null,
      type: typeFromHandles(pLocal, inLocal, null),
    });
  }
}

/** Spec M14 §3–§4: warps `subpaths` (in a node's local space) through the world matrix `world`,
 *  refits every segment against `cage`/`box` (a Coons patch is not affine, so a cubic mapped
 *  through it is refitted rather than transformed), and maps the fitted points and handles back to
 *  local space through `invert(world)`. `world` must be invertible — callers check; this function
 *  returns `subpaths` unchanged if it is not. */
export function warpSubpaths(
  subpaths: readonly Subpath[],
  world: Mat,
  cage: Cage,
  box: Box,
): Subpath[] {
  const inv = invert(world);
  if (!inv) return subpaths.slice();
  const tol = warpTolerance(box);
  const toLocal = (p: Vec): Vec => applyMat(inv, p);
  const fitSegment = (a: PathNode, b: PathNode): Piece[] => {
    const C = segmentWorldCubic(a.p, a.out, b.in, b.p, world);
    return fit(cage, box, C, tol, 0).map((F) => pieceOf(F, tol));
  };

  return subpaths.map((sp) => {
    const n = sp.nodes;
    if (n.length < 2) return sp;

    const outNodes: PathNode[] = [
      {
        p: toLocal(warpPoint(cage, box, applyMat(world, n[0].p))),
        in: null,
        out: null,
        type: n[0].type,
      },
    ];
    for (let i = 1; i < n.length; i++) appendPieces(outNodes, fitSegment(n[i - 1], n[i]), toLocal);

    if (sp.closed) {
      // The wrap segment (last node → node 0): its final piece ends back at node 0, so fold that
      // piece's handles onto the existing endpoints instead of appending a duplicate node
      // (spec M14 §4 — invariant 30 forbids a closed subpath's last node repeating its first).
      const wrapPieces = fitSegment(n[n.length - 1], n[0]);
      appendPieces(outNodes, wrapPieces.slice(0, -1), toLocal);
      const last = wrapPieces[wrapPieces.length - 1];
      const prev = outNodes[outNodes.length - 1];
      const outLocal = last.outH ? toLocal(last.outH) : null;
      const inLocal = last.inH ? toLocal(last.inH) : null;
      outNodes[outNodes.length - 1] = {
        ...prev,
        out: outLocal,
        type: typeFromHandles(prev.p, prev.in, outLocal),
      };
      const first = outNodes[0];
      outNodes[0] = { ...first, in: inLocal, type: typeFromHandles(first.p, inLocal, first.out) };
    }

    return { closed: sp.closed, nodes: outNodes };
  });
}
