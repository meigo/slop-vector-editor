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
import { simplifyOf } from "../geom/simplify";

const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

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

  it("keeps the result near the original", async () => {
    const before = noisy(40);
    const [after] = await simplifyOf([before], 0.8);
    // Endpoints are preserved by the fit, which is the cheapest check that we did not lose the
    // path's extent while losing its nodes.
    expect(after.nodes[0].p.x).toBeCloseTo(before.nodes[0].p.x, 6);
    expect(after.nodes[after.nodes.length - 1].p.x).toBeCloseTo(
      before.nodes[before.nodes.length - 1].p.x,
      6,
    );
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
