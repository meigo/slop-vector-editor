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
import { flattenSubpath } from "../geom/bezier";
import { simplifyOf } from "../geom/simplify";
import { dist, type Vec } from "../geom/vec";

const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

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
    const tolerance = 0.8;
    const [after] = await simplifyOf([before], tolerance);
    // `before`'s nodes are all plain corners with no handles, so flattening it costs nothing: the
    // polyline IS its own nodes. The fitted curve is sampled far more finely (scale 8) than the
    // default, so a bulge between its own nodes is not missed.
    const original = flattenSubpath(before);
    const fitted = flattenSubpath(after, 8);
    expect(maxDeviation(fitted, original)).toBeLessThanOrEqual(tolerance);
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
