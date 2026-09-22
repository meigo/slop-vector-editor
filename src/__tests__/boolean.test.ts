import { describe, expect, it } from "vitest";
import { booleanOf } from "../geom/boolean";
import type { Subpath } from "../doc/document";

const corner = (x: number, y: number) => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner" as const,
});
const rect = (x: number, y: number, w: number, h: number): Subpath => ({
  closed: true,
  nodes: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)],
});
const K = 0.5522847498307936 * 30;
const circle: Subpath = {
  closed: true,
  nodes: [
    { p: { x: 20, y: 50 }, in: { x: 20, y: 50 + K }, out: { x: 20, y: 50 - K }, type: "symmetric" },
    { p: { x: 50, y: 20 }, in: { x: 50 - K, y: 20 }, out: { x: 50 + K, y: 20 }, type: "symmetric" },
    { p: { x: 80, y: 50 }, in: { x: 80, y: 50 - K }, out: { x: 80, y: 50 + K }, type: "symmetric" },
    { p: { x: 50, y: 80 }, in: { x: 50 + K, y: 80 }, out: { x: 50 - K, y: 80 }, type: "symmetric" },
  ],
};

/** Signed area: its sign is the subpath's winding. */
const area = (sp: Subpath) => {
  let a = 0;
  for (let i = 0; i < sp.nodes.length; i++) {
    const p = sp.nodes[i].p;
    const q = sp.nodes[(i + 1) % sp.nodes.length].p;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

describe("booleanOf", () => {
  /** Must stay the first test in this file: it is about the very first load, and every other test
   *  has already done it. The loader caches the promise, not the module — a value cached after the
   *  await let three overlapping first calls all fall through the guard and each run `setup()`,
   *  leaving two spare projects behind for the life of the page. */
  it("sets paper up once when the first calls overlap", async () => {
    const pair = [[rect(0, 0, 10, 10)], [rect(5, 5, 10, 10)]];
    await Promise.all([
      booleanOf(pair, "unite"),
      booleanOf(pair, "unite"),
      booleanOf(pair, "unite"),
    ]);
    const mod = await import("paper/dist/paper-core");
    const paper = (mod as unknown as { default?: typeof mod }).default ?? mod;
    expect(paper.projects).toHaveLength(1);
  });

  it("round-trips a shape through paper unchanged", async () => {
    const out = await booleanOf([[circle], [rect(500, 500, 10, 10)]], "unite");
    const back = out.find((sp) => sp.nodes.some((n) => Math.abs(n.p.x - 20) < 1e-9));
    expect(back).toBeDefined();
    expect(back!.nodes.map((n) => [n.p.x, n.p.y])).toEqual(circle.nodes.map((n) => [n.p.x, n.p.y]));
    expect(back!.nodes[0].in).toEqual(circle.nodes[0].in);
    expect(back!.nodes[0].type).toBe("symmetric");
  });

  it("unites, subtracts, intersects and excludes", async () => {
    const sq = rect(50, 50, 40, 40);
    expect((await booleanOf([[circle], [sq]], "unite"))[0].nodes.length).toBeGreaterThan(4);
    expect(await booleanOf([[circle], [sq]], "subtract")).toHaveLength(1);
    expect(await booleanOf([[circle], [sq]], "intersect")).toHaveLength(1);
    expect(await booleanOf([[circle], [sq]], "exclude")).toHaveLength(2);
  });

  it("keeps a boolean junction a corner", async () => {
    const shifted: Subpath = {
      ...circle,
      nodes: circle.nodes.map((n) => ({
        ...n,
        p: { x: n.p.x + 20, y: n.p.y },
        in: n.in && { x: n.in.x + 20, y: n.in.y },
        out: n.out && { x: n.out.x + 20, y: n.out.y },
      })),
    };
    const out = await booleanOf([[circle], [shifted]], "unite");
    // The two circles cross near x = 60. Those vertices are corners; a handle drag must not
    // straighten them. The extrema that stay collinear stay smooth or symmetric.
    const crossings = out.flatMap((sp) => sp.nodes).filter((n) => Math.abs(n.p.x - 60) < 1);
    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings.every((n) => n.type === "corner")).toBe(true);
  });

  it("keeps curves", async () => {
    const out = await booleanOf([[circle], [rect(50, 50, 40, 40)]], "subtract");
    expect(out[0].nodes.some((n) => n.in !== null || n.out !== null)).toBe(true);
  });

  it("gives a hole opposite winding, which is what nonzero fill needs", async () => {
    const out = await booleanOf([[rect(0, 0, 100, 100)], [rect(40, 40, 20, 20)]], "subtract");
    expect(out).toHaveLength(2);
    expect(Math.sign(area(out[0]))).toBe(-Math.sign(area(out[1])));
  });

  /** The other half of the round trip: a multi-subpath operand has to go in as a `CompoundPath`
   *  (spec M7 §9). Uniting a holed rectangle with a rectangle far away leaves all three subpaths
   *  untouched, so the hole must still be there — and still wound the other way — afterwards. */
  it("takes a multi-subpath operand in as a compound path and gets one back", async () => {
    const holed = await booleanOf([[rect(0, 0, 100, 100)], [rect(40, 40, 20, 20)]], "subtract");
    expect(holed).toHaveLength(2);
    const out = await booleanOf([holed, [rect(500, 500, 10, 10)]], "unite");
    expect(out).toHaveLength(3);
    // The outer 100×100, the 20×20 hole and the 10×10 square standing on its own.
    const total = out.reduce((sum, sp) => sum + Math.abs(area(sp)), 0);
    expect(total).toBeCloseTo(100 * 100 + 20 * 20 + 10 * 10, 6);
    const big = out.filter((sp) => sp.nodes.every((n) => n.p.x < 200));
    expect(big).toHaveLength(2);
    expect(Math.sign(area(big[0]))).toBe(-Math.sign(area(big[1])));
  });

  /** White-box, on purpose: the leak it guards is invisible from our own types. Paper adds every
   *  item it is given, and every item it produces, to its own project unless it is told not to, and
   *  the project lives as long as the page — so a missing `insert: false` anywhere in the
   *  conversion would show up here as a project that is no longer empty after six operations. */
  it("leaves nothing behind in paper's project", async () => {
    await booleanOf([[rect(0, 0, 10, 10)], [rect(5, 5, 10, 10)]], "unite");
    const mod = await import("paper/dist/paper-core");
    const paper = (mod as unknown as { default?: typeof mod }).default ?? mod;
    for (let i = 0; i < 5; i++) {
      await booleanOf([[rect(0, 0, 10, 10)], [rect(5, 5, 10, 10)]], "unite");
    }
    expect(paper.project.activeLayer.children).toHaveLength(0);
  });

  it("returns nothing when the result is empty", async () => {
    expect(await booleanOf([[rect(0, 0, 10, 10)], [rect(50, 50, 10, 10)]], "intersect")).toEqual(
      [],
    );
  });

  it("unites disjoint shapes into two subpaths", async () => {
    expect(await booleanOf([[rect(0, 0, 10, 10)], [rect(50, 50, 10, 10)]], "unite")).toHaveLength(
      2,
    );
  });
});
