import { describe, expect, it } from "vitest";
import type { PathNode, Subpath } from "../doc/document";
import { cubicPoint, type Cubic } from "../geom/bezier";
import { IDENTITY, translate } from "../geom/mat";
import type { Vec } from "../geom/vec";
import {
  cubicThrough4,
  identityCage,
  isIdentityCage,
  warpPoint,
  warpSubpaths,
  warpTolerance,
  type Cage,
} from "../geom/warp";

const box = { x: 0, y: 0, w: 100, h: 50 };
const node = (x: number, y: number, extra: Partial<PathNode> = {}): PathNode => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
  ...extra,
});
const rectSub = (): Subpath => ({
  closed: true,
  nodes: [node(0, 0), node(100, 0), node(100, 50), node(0, 50)],
});
/** A straight-edged perspective cage: the right edge pulled in. */
function perspective(): Cage {
  const c = identityCage(box);
  const P10 = { x: 100, y: 10 };
  const P11 = { x: 100, y: 40 };
  const third = (a: Vec, b: Vec, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const [P00, , , P01] = c.corners;
  return {
    corners: [P00, P10, P11, P01],
    edges: [
      [third(P00, P10, 1 / 3), third(P00, P10, 2 / 3)],
      [third(P10, P11, 1 / 3), third(P10, P11, 2 / 3)],
      [third(P01, P11, 1 / 3), third(P01, P11, 2 / 3)],
      c.edges[3],
    ],
  };
}
/** A curved cage: the top edge bowed upwards. For a fixed v (any v, not just 0), the patch is a
 *  single cubic in u — see `warpPoint` — so an axis-parallel segment never subdivides against this
 *  cage; the tests below that need real subdivision use a diagonal segment instead. */
function bowed(): Cage {
  const c = identityCage(box);
  return {
    ...c,
    edges: [
      [
        { x: 33, y: -30 },
        { x: 67, y: -30 },
      ],
      c.edges[1],
      c.edges[2],
      c.edges[3],
    ],
  };
}
/** A curved cage with TWO opposite-ish edges bowed (top and right), so neither a horizontal nor a
 *  vertical segment reduces to a single cubic — used to check the refit against a less contrived
 *  cage than `bowed()`. */
function twoBowed(): Cage {
  const c = identityCage(box);
  return {
    ...c,
    edges: [
      [
        { x: 33, y: -30 },
        { x: 67, y: -30 },
      ],
      [
        { x: 130, y: 50 / 3 },
        { x: 130, y: 100 / 3 },
      ],
      c.edges[2],
      c.edges[3],
    ],
  };
}

/** Nearest distance from `p` to the parametric curve `truth` (`t` in [0, 1]): a coarse scan
 *  followed by a ternary-search refine, exact to float precision for a well-behaved single arc. */
function nearestDistOnCurve(truth: (t: number) => Vec, p: Vec): number {
  const dist = (t: number) => Math.hypot(truth(t).x - p.x, truth(t).y - p.y);
  const SAMPLES = 64;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const d = dist(t);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  let lo = Math.max(0, bestT - 1 / SAMPLES);
  let hi = Math.min(1, bestT + 1 / SAMPLES);
  for (let k = 0; k < 60; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist(m1) <= dist(m2)) hi = m2;
    else lo = m1;
  }
  return dist((lo + hi) / 2);
}

/** A point at `t` along the OUTPUT segment `a → b` (a real cubic when both handles are present,
 *  otherwise the straight chord) — the same curve the app would actually draw. */
function sampleOutputSegment(a: PathNode, b: PathNode, t: number): Vec {
  if (a.out && b.in) return cubicPoint([a.p, a.out, b.in, b.p] as Cubic, t);
  return { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t };
}

/** Warps the single straight open segment `from → to` under `cage`, asserts it genuinely
 *  subdivided, and checks that every OUTPUT cubic — sampled at 16 interior points each, not just at
 *  the nodes — lies within `warpTolerance(box)` of the true warped line. */
function checkRefitAccuracy(cage: Cage, from: Vec, to: Vec): void {
  const sp: Subpath = { closed: false, nodes: [node(from.x, from.y), node(to.x, to.y)] };
  const [out] = warpSubpaths([sp], IDENTITY, cage, box);
  expect(out.nodes.length).toBeGreaterThan(2); // genuinely subdivided
  expect(out.nodes.length).toBeLessThanOrEqual(65);

  const truth = (t: number) =>
    warpPoint(cage, box, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  const tol = warpTolerance(box);
  for (let i = 0; i < out.nodes.length - 1; i++) {
    for (let k = 1; k < 16; k++) {
      const p = sampleOutputSegment(out.nodes[i], out.nodes[i + 1], k / 16);
      expect(nearestDistOnCurve(truth, p)).toBeLessThanOrEqual(tol + 1e-9);
    }
  }
}

describe("warp geometry (spec M14 §2, §4)", () => {
  it("an identity cage maps points to themselves", () => {
    const c = identityCage(box);
    expect(isIdentityCage(c, box)).toBe(true);
    for (const q of [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 37, y: 12 },
      { x: 50, y: 0 },
    ]) {
      const w = warpPoint(c, box, q);
      expect(w.x).toBeCloseTo(q.x, 9);
      expect(w.y).toBeCloseTo(q.y, 9);
    }
  });

  it("cubicThrough4 recovers a cubic from its own samples", () => {
    const c = [
      { x: 0, y: 0 },
      { x: 10, y: 40 },
      { x: 60, y: -20 },
      { x: 90, y: 10 },
    ] as const;
    const f = cubicThrough4(
      cubicPoint(c, 0),
      cubicPoint(c, 1 / 3),
      cubicPoint(c, 2 / 3),
      cubicPoint(c, 1),
    );
    for (let i = 0; i < 4; i++) {
      expect(f[i].x).toBeCloseTo(c[i].x, 9);
      expect(f[i].y).toBeCloseTo(c[i].y, 9);
    }
  });

  it("a rectangle in perspective stays four straight segments (Review Focus 1)", () => {
    const [sp] = warpSubpaths([rectSub()], IDENTITY, perspective(), box);
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(4);
    for (const n of sp.nodes) {
      expect(n.in).toBeNull();
      expect(n.out).toBeNull();
    }
    expect(sp.nodes[1].p.y).toBeCloseTo(10, 9);
    expect(sp.nodes[2].p.y).toBeCloseTo(40, 9);
  });

  it("a diagonal straight segment under a straight cage fits exactly with no subdivision", () => {
    const sp: Subpath = { closed: false, nodes: [node(0, 0), node(100, 50)] };
    const [out] = warpSubpaths([sp], IDENTITY, perspective(), box);
    expect(out.nodes).toHaveLength(2);
  });

  it("a curved cage: the refit stays within tolerance and respects the depth cap", () => {
    checkRefitAccuracy(bowed(), { x: 0, y: 0 }, { x: 100, y: 50 });
  });

  it("a curved cage with two bowed edges: the refit still stays within tolerance", () => {
    checkRefitAccuracy(twoBowed(), { x: 0, y: 0 }, { x: 100, y: 50 });
  });

  it("a closed subpath's wrap segment is warped and node 0's in comes from it (Review Focus 3)", () => {
    // A triangle whose wrap segment (last node → node 0) is the diagonal (0,0) → (100,50): the
    // other two sides are axis-parallel and stay exact under `bowed()` (see the note above), so
    // only the wrap segment subdivides — exercising the fold this test is about.
    const triangle: Subpath = { closed: true, nodes: [node(100, 50), node(0, 50), node(0, 0)] };
    const [sp] = warpSubpaths([triangle], IDENTITY, bowed(), box);
    expect(sp.closed).toBe(true);
    const first = sp.nodes[0];
    expect(first.in).not.toBeNull();
    for (const n of sp.nodes.slice(1)) {
      expect(n.p.x === first.p.x && n.p.y === first.p.y).toBe(false);
    }
  });

  it("maps through the world matrix and back", () => {
    const sp: Subpath = { closed: false, nodes: [node(-10, 0), node(90, 0)] };
    const [out] = warpSubpaths([sp], translate(10, 0), identityCage(box), box);
    expect(out.nodes[0].p.x).toBeCloseTo(-10, 9);
    expect(out.nodes[1].p.x).toBeCloseTo(90, 9);
  });

  // Controller ruling: a subdivision junction is typed "smooth" outright (the true warped curve is
  // C1 there), with its handles left exactly as `fit` produced them — no rotation onto a bisector
  // (an earlier version of this rule did that, which measurably pushed some outputs past
  // `warpTolerance`). A diagonal segment is used because an axis-parallel one never subdivides
  // against `bowed()` (see the note above `bowed()`).
  it("a subdivision junction is typed smooth", () => {
    const sp: Subpath = { closed: false, nodes: [node(0, 0), node(100, 50)] };
    const [out] = warpSubpaths([sp], IDENTITY, bowed(), box);
    const inner = out.nodes.slice(1, -1);
    expect(inner.length).toBeGreaterThan(0);
    for (const n of inner) expect(n.type).toBe("smooth");
  });
});
