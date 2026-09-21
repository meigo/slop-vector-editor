import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type PathNode,
  type PathShape,
  type Subpath,
} from "../doc/document";
import { simplifyShapes } from "../doc/simplify-edit";
import { findNode } from "../doc/tree";
import { nodeBounds } from "../geom/bounds";
import { flattenSubpath } from "../geom/bezier";
import { simplifyOf } from "../geom/simplify";
import { IDENTITY } from "../geom/mat";
import { dist, type Vec } from "../geom/vec";

const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

/** Mirrors `simplifyShapes`' fraction (spec M11 §6, measured): the real per-point deviation bound
 *  is the path's own bounding-box diagonal times this fraction. The value actually fed to paper is
 *  that bound *squared*, because paper's own `tolerance` bounds a squared distance internally —
 *  this constant is not exported from `simplify-edit.ts`, so it is repeated here rather than
 *  imported, and must be kept in step with it by hand. */
const TOL_FRACTION = 5e-3;

/** Shortest distance from `p` to the segment `a`–`b`. */
function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return dist(p, { x: a.x + t * abx, y: a.y + t * aby });
}

/** The largest, over every point of `sample`, of its distance to the polyline `ref` — not to
 *  `ref`'s nearest vertex, which for a coarse original would overstate the true deviation. */
function maxDeviation(sample: readonly Vec[], ref: readonly Vec[]): number {
  let max = 0;
  for (const p of sample) {
    let nearest = Infinity;
    for (let i = 1; i < ref.length; i++)
      nearest = Math.min(nearest, distToSegment(p, ref[i - 1], ref[i]));
    max = Math.max(max, nearest);
  }
  return max;
}

/** A noisy polyline: many corner nodes tracing a sine, the shape a trace or a flatten leaves. */
function noisy(n: number): Subpath {
  const nodes: PathNode[] = [];
  for (let i = 0; i <= n; i++) {
    nodes.push({
      p: { x: i * 2, y: 20 * Math.sin(i / 4) + (i % 2 ? 0.6 : -0.6) },
      in: null,
      out: null,
      type: "corner" as const,
    });
  }
  return { closed: false, nodes };
}

/** The same subpath, uniformly scaled about the origin — a plain drawing made bigger, with no
 *  change of shape. */
function scaleSubpath(sp: Subpath, k: number): Subpath {
  const s = (v: { x: number; y: number }) => ({ x: v.x * k, y: v.y * k });
  return {
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      p: s(n.p),
      in: n.in ? s(n.in) : null,
      out: n.out ? s(n.out) : null,
      type: n.type,
    })),
  };
}

const path = (id: string, subpaths: Subpath[], extra: Partial<PathShape> = {}): PathShape => ({
  kind: "path",
  id,
  transform: IDENT,
  style: DEFAULT_STYLE,
  subpaths,
  ...extra,
});

function docWith(shapes: PathShape[]): Doc {
  const base = createDoc(200, 200);
  return { ...base, layers: [{ ...base.layers[0], children: shapes }] };
}

describe("simplifyOf", () => {
  it("drops nodes from a noisy path", async () => {
    const out = await simplifyOf([noisy(40)], 0.8);
    expect(out[0].nodes.length).toBeLessThan(41);
    expect(out[0].nodes.length).toBeGreaterThan(2);
  });

  it("keeps every sampled point within the tolerance of the original", async () => {
    const before = noisy(40);
    // The same diagonal-relative bound `simplifyShapes` uses (spec M11 §6): the real per-point
    // bound is `diag * TOL_FRACTION`, and the value passed to paper is that bound *squared*, since
    // paper's own tolerance is a squared distance. Calling `simplifyOf` this way — the same way
    // `simplifyShapes` does — is what makes the assertion below a check of the real promise rather
    // than of an arbitrary number.
    const box = nodeBounds(path("t", [before]), IDENTITY)!;
    const bound = Math.hypot(box.w, box.h) * TOL_FRACTION;
    const [after] = await simplifyOf([before], bound ** 2);
    // `before`'s nodes are all plain corners with no handles, so flattening it costs nothing: the
    // polyline IS its own nodes. The fitted curve is sampled far more finely (scale 8) than the
    // default, so a bulge between its own nodes is not missed.
    const original = flattenSubpath(before);
    const fitted = flattenSubpath(after, 8);
    expect(maxDeviation(fitted, original)).toBeLessThanOrEqual(bound);
  });

  it("keeps a closed subpath closed", async () => {
    const closed = { ...noisy(20), closed: true };
    const [after] = await simplifyOf([closed], 0.8);
    expect(after.closed).toBe(true);
  });
});

describe("simplifyShapes", () => {
  it("reports the node count before and after", async () => {
    const doc = docWith([path("a", [noisy(40)])]);
    const out = await simplifyShapes(doc, ["a"]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.before).toBe(41);
    expect(out.after).toBeLessThan(41);
  });

  it("drops a title's text, because the outlines stop matching the string", async () => {
    const doc = docWith([path("a", [noisy(40)], { text: { seed: 1 } as never })]);
    const out = await simplifyShapes(doc, ["a"]);
    if (out.kind !== "ok") throw new Error("expected ok");
    expect((findNode(out.doc, "a")!.node as PathShape).text).toBeUndefined();
  });

  it("refuses when no path is selected", async () => {
    const doc = docWith([]);
    const out = await simplifyShapes(doc, []);
    expect(out.kind).toBe("refused");
  });

  it("simplifies the same drawing the same way regardless of its size", async () => {
    // Spec (M11) §6, amended 2026-09-21: paper's own tolerance bounds a *squared* distance, so
    // passing `diag * TOL_FRACTION` directly (without squaring) makes deviation grow with `√diag`
    // instead of `diag` — not scale-invariant at all. This is the test that would have caught that:
    // it fails if the `** 2` in `simplifyShapes` is removed (measured — see the fix report).
    const shape = noisy(30);
    const natural = docWith([path("a", [shape])]);
    const huge = docWith([path("a", [scaleSubpath(shape, 1000)])]);
    const naturalOut = await simplifyShapes(natural, ["a"]);
    const hugeOut = await simplifyShapes(huge, ["a"]);
    if (naturalOut.kind !== "ok" || hugeOut.kind !== "ok") throw new Error("expected ok");
    expect(hugeOut.after).toBe(naturalOut.after);
  });

  it("leaves the document at the same reference when it changes nothing", async () => {
    // A two-node straight segment has nothing to remove.
    const flat: Subpath = {
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
      ],
    };
    const doc = docWith([path("a", [flat])]);
    const out = await simplifyShapes(doc, ["a"]);
    expect(out.kind).toBe("none");
  });
});
