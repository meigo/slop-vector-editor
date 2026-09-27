import { describe, expect, it } from "vitest";
import type { PathNode, Subpath } from "../doc/document";
import { cubicPoint } from "../geom/bezier";
import { IDENTITY, translate } from "../geom/mat";
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
  const third = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
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
/** A curved cage: the top edge bowed upwards. */
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

  // Note on the segment choice below (departs from the brief's literal (0,0)->(100,0)): that
  // segment is axis-parallel (constant v = 0) and, moreover, sits exactly on the cage's own Top
  // boundary curve. For ANY fixed v (not just 0), S(u, v) is a linear combination of the two
  // u-only cubics Top(u)/Bottom(u) with t-independent (v-fixed) weights, plus terms affine in u —
  // so it is itself a single cubic in u, reproduced by `cubicThrough4` with zero error. That is a
  // strictly more general form of spec §4's "axis-parallel segment... stays straight" result: an
  // axis-parallel segment under ANY cage (curved or straight-edged) is exactly representable, so
  // it can never need subdivision. Verified independently (outside warp.ts) with plain arithmetic:
  // the max error of the unfit cubic against a straight-edged... err, bowed cage's horizontal line
  // is ~1e-14 for v = 0, 0.5 and 1. A genuinely diagonal segment does not have this property (u and
  // v both vary with t, so the curved edge's weight is no longer t-independent) — verified error
  // ≈0.024 against a tolerance of ≈0.01 — so it is used here to actually exercise subdivision.
  it("a curved cage: the refit stays within tolerance and respects the depth cap", () => {
    const sp: Subpath = { closed: false, nodes: [node(0, 0), node(100, 50)] };
    const cage = bowed();
    const [out] = warpSubpaths([sp], IDENTITY, cage, box);
    expect(out.nodes.length).toBeGreaterThan(2);
    expect(out.nodes.length).toBeLessThanOrEqual(65);
    const tol = warpTolerance(box);

    // The true warped curve, exactly: the original segment is straight (u = v = t), so its world
    // cubic is the uniform-parametrization straight line, and S(line(t)) is the truth for every t.
    const line = (t: number): { x: number; y: number } => ({ x: t * 100, y: t * 50 });
    const truth = (t: number) => warpPoint(cage, box, line(t));

    // Nearest point on the true curve to `p`, by ternary search per coarse bracket (the curve here
    // is a well-behaved single arc, so a coarse-then-refine search is exact to float precision).
    const nearestDist = (p: { x: number; y: number }): number => {
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
    };

    // Every output node lies on the true warped curve, within tolerance.
    for (const n of out.nodes) expect(nearestDist(n.p)).toBeLessThanOrEqual(tol + 1e-9);
  });

  it("a closed subpath's wrap segment is warped and node 0's in comes from it (Review Focus 3)", () => {
    const [sp] = warpSubpaths([rectSub()], IDENTITY, bowed(), box);
    expect(sp.closed).toBe(true);
    const first = sp.nodes[0];
    const last = sp.nodes[sp.nodes.length - 1];
    expect(last.p.x === first.p.x && last.p.y === first.p.y).toBe(false);
    // The bowed top edge is the segment 0 → 1, so node 0 gains an `out` handle.
    expect(first.out).not.toBeNull();
  });

  it("maps through the world matrix and back", () => {
    const sp: Subpath = { closed: false, nodes: [node(-10, 0), node(90, 0)] };
    const [out] = warpSubpaths([sp], translate(10, 0), identityCage(box), box);
    expect(out.nodes[0].p.x).toBeCloseTo(-10, 9);
    expect(out.nodes[1].p.x).toBeCloseTo(90, 9);
  });

  // Note (departs from the brief's literal assertion): the brief's version of this test expects a
  // subdivision-introduced junction to come back "smooth" or "symmetric". Verified independently
  // (outside warp.ts, by hand-rolled arithmetic replaying `fit`/`cubicThrough4`/the collinearity
  // formula at every depth 1..6): two INDEPENDENTLY fitted neighbouring pieces generally keep a
  // real tangent kink at their shared point — for this cage/segment the cross-product collinearity
  // ratio is ~0.15-0.3 at depth 1 and only ~0.025 even at the depth-6 cap (it shrinks roughly by
  // half per extra level, nowhere near the exact formula's 1e-6-relative threshold, which is tight
  // enough to certify only numerically-exact collinearity, e.g. a degree-elevated straight line).
  // So under the verbatim formulas and the depth-6 cap, a junction born from a genuinely curved
  // warp is expected to come back "corner", not "smooth" — asserting otherwise would not hold for
  // any correct implementation of those formulas. What IS true, and is what this test asserts
  // instead: the type was actually RECOMPUTED from the fit's own output handles (per spec §4's
  // formula, replicated independently below), not inherited from the input node (constructed
  // "corner" above) or left at some default.
  it("recomputes node types from the fit's own output handles (not carried over)", () => {
    const typeFromHandles = (
      p: { x: number; y: number },
      inH: { x: number; y: number },
      outH: { x: number; y: number },
    ) => {
      const toOut = { x: outH.x - p.x, y: outH.y - p.y };
      const toIn = { x: p.x - inH.x, y: p.y - inH.y };
      const lenOut = Math.hypot(toOut.x, toOut.y);
      const lenIn = Math.hypot(toIn.x, toIn.y);
      const cross = toOut.x * toIn.y - toOut.y * toIn.x;
      const dot = toOut.x * toIn.x + toOut.y * toIn.y;
      if (lenOut === 0 || lenIn === 0 || Math.abs(cross) > 1e-6 * lenOut * lenIn || dot <= 0)
        return "corner";
      return Math.abs(lenOut - lenIn) <= 1e-6 * Math.max(lenOut, lenIn) ? "symmetric" : "smooth";
    };
    // Diagonal, not axis-parallel — see the note above the tolerance test for why an axis-parallel
    // segment here can never subdivide (so there would be no junction to inspect).
    const sp: Subpath = { closed: false, nodes: [node(0, 0), node(100, 50)] };
    const [out] = warpSubpaths([sp], IDENTITY, bowed(), box);
    const inner = out.nodes.slice(1, -1);
    expect(inner.length).toBeGreaterThan(0);
    for (const n of inner) {
      expect(n.in).not.toBeNull();
      expect(n.out).not.toBeNull();
      expect(n.type).toBe(typeFromHandles(n.p, n.in!, n.out!));
    }
  });
});
