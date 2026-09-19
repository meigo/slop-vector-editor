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

describe("booleanOf", () => {
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

  it("keeps curves", async () => {
    const out = await booleanOf([[circle], [rect(50, 50, 40, 40)]], "subtract");
    expect(out[0].nodes.some((n) => n.in !== null || n.out !== null)).toBe(true);
  });

  it("gives a hole opposite winding, which is what nonzero fill needs", async () => {
    const out = await booleanOf([[rect(0, 0, 100, 100)], [rect(40, 40, 20, 20)]], "subtract");
    expect(out).toHaveLength(2);
    const area = (sp: Subpath) => {
      let a = 0;
      for (let i = 0; i < sp.nodes.length; i++) {
        const p = sp.nodes[i].p;
        const q = sp.nodes[(i + 1) % sp.nodes.length].p;
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    };
    expect(Math.sign(area(out[0]))).toBe(-Math.sign(area(out[1])));
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
