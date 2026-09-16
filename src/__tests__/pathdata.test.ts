import { describe, expect, it } from "vitest";
import type { PathNode, Subpath } from "../doc/document";
import { applyNodeTypes, nodeTypesAttr, parsePathData, subpathsToD } from "../svg/pathdata";

const corner = (x: number, y: number): PathNode => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
});
const pts = (sp: Subpath) => sp.nodes.map((n) => [n.p.x, n.p.y]);

describe("subpathsToD", () => {
  it("writes straight segments with L and closes with Z", () => {
    const d = subpathsToD([{ nodes: [corner(0, 0), corner(10, 0), corner(10, 10)], closed: true }]);
    expect(d).toBe("M0 0 L10 0 L10 10 Z");
  });

  it("writes curves with C, using the node point for a missing handle", () => {
    const d = subpathsToD([
      {
        nodes: [
          { p: { x: 0, y: 0 }, in: null, out: { x: 5, y: 0 }, type: "corner" },
          { p: { x: 10, y: 10 }, in: null, out: null, type: "corner" },
        ],
        closed: false,
      },
    ]);
    expect(d).toBe("M0 0 C5 0 10 10 10 10");
  });

  it("writes a curved closing segment explicitly before Z", () => {
    const d = subpathsToD([
      {
        nodes: [
          { p: { x: 0, y: 0 }, in: { x: 0, y: 5 }, out: null, type: "corner" },
          corner(10, 0),
        ],
        closed: true,
      },
    ]);
    expect(d).toBe("M0 0 L10 0 C10 0 0 5 0 0 Z");
  });

  it("writes several subpaths", () => {
    const d = subpathsToD([
      { nodes: [corner(0, 0), corner(1, 1)], closed: false },
      { nodes: [corner(5, 5), corner(6, 6)], closed: false },
    ]);
    expect(d).toBe("M0 0 L1 1 M5 5 L6 6");
  });
});

describe("parsePathData", () => {
  it("parses relative moves, H/V and close", () => {
    const [sp] = parsePathData("m10 10 h10 v10 H10 z");
    expect(pts(sp)).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ]);
    expect(sp.closed).toBe(true);
  });

  it("treats extra pairs after M as line-tos", () => {
    const [sp] = parsePathData("M0 0 10 0 10 10");
    expect(pts(sp)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(sp.closed).toBe(false);
  });

  it("parses compact numbers", () => {
    const [sp] = parsePathData("M0-5.5.5 1e1");
    expect(pts(sp)).toEqual([
      [0, -5.5],
      [0.5, 10],
    ]);
  });

  it("reflects the previous control point for S and infers smooth nodes", () => {
    const [sp] = parsePathData("M0 0 C0 10 10 10 10 0 S20 -10 20 0");
    const [n0, n1, n2] = sp.nodes;
    expect(n0.out).toEqual({ x: 0, y: 10 });
    expect(n1.in).toEqual({ x: 10, y: 10 });
    expect(n1.out).toEqual({ x: 10, y: -10 });
    expect(n1.type).toBe("smooth");
    expect(n0.type).toBe("corner");
    expect(n2.in).toEqual({ x: 20, y: -10 });
  });

  it("elevates quadratics (Q and T) to cubics", () => {
    const [sp] = parsePathData("M0 0 Q5 5 10 0 T20 0");
    const [n0, n1, n2] = sp.nodes;
    expect(n0.out!.x).toBeCloseTo(10 / 3);
    expect(n0.out!.y).toBeCloseTo(10 / 3);
    expect(n1.in!.x).toBeCloseTo(20 / 3);
    expect(n1.in!.y).toBeCloseTo(10 / 3);
    // T reflects (5,5) about (10,0) → (15,-5)
    expect(n1.out!.x).toBeCloseTo(10 + (2 / 3) * 5);
    expect(n1.out!.y).toBeCloseTo((2 / 3) * -5);
    expect(n2.p).toEqual({ x: 20, y: 0 });
  });

  it("converts arcs, including compact flags", () => {
    for (const d of ["M0 0 A1 1 0 0 1 2 0", "M0 0a1 1 0 012 0"]) {
      const [sp] = parsePathData(d);
      expect(sp.nodes).toHaveLength(3);
      expect(sp.nodes[1].p.x).toBeCloseTo(1);
      expect(sp.nodes[1].p.y).toBeCloseTo(-1);
      expect(sp.nodes[2].p).toEqual({ x: 2, y: 0 });
    }
  });

  it("merges a closing node that lands on the start point", () => {
    const [sp] = parsePathData("M0 0 C0 -5 10 -5 10 0 C10 5 0 5 0 0 Z");
    expect(sp.nodes).toHaveLength(2);
    expect(sp.closed).toBe(true);
    expect(sp.nodes[0].in).toEqual({ x: 0, y: 5 });
    expect(sp.nodes[0].out).toEqual({ x: 0, y: -5 });
    expect(sp.nodes[0].type).toBe("smooth");
  });

  it("starts a new subpath at the start point after Z", () => {
    const sps = parsePathData("M0 0 L10 0 Z L0 10");
    expect(sps).toHaveLength(2);
    expect(pts(sps[1])).toEqual([
      [0, 0],
      [0, 10],
    ]);
  });

  it("stops at garbage or truncated data without throwing", () => {
    expect(pts(parsePathData("M0 0 L10 0 X 5 5")[0])).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(pts(parsePathData("M0 0 L10")[0])).toEqual([[0, 0]]);
    expect(parsePathData("")).toEqual([]);
  });

  it("stops at a non-finite number without throwing", () => {
    const [sp] = parsePathData("M0 0 L1e999 0 L5 5");
    expect(pts(sp)).toEqual([[0, 0]]);
  });

  it("stops at a coordinate exceeding the maximum without throwing", () => {
    const [sp] = parsePathData("M0 0 L1e12 0");
    expect(sp.nodes).toHaveLength(1);
  });

  it("nulls handles that sit on their node", () => {
    const [sp] = parsePathData("M0 0 C0 0 10 0 10 0");
    expect(sp.nodes[0].out).toBeNull();
    expect(sp.nodes[1].in).toBeNull();
  });

  it("round-trips through subpathsToD", () => {
    const d = "M0 0 C0 -5 10 -5 10 0 C10 5 0 5 0 0 Z M20 20 L30 20 L30 30";
    expect(parsePathData(subpathsToD(parsePathData(d)))).toEqual(parsePathData(d));
  });
});

describe("node type codec", () => {
  it("encodes and applies node types per subpath", () => {
    const sps: Subpath[] = [
      { nodes: [corner(0, 0), { ...corner(1, 1), type: "symmetric" }], closed: false },
      { nodes: [{ ...corner(2, 2), type: "smooth" }], closed: false },
    ];
    const attr = nodeTypesAttr(sps);
    expect(attr).toBe("cy s");
    const plain = sps.map((sp) => ({
      ...sp,
      nodes: sp.nodes.map((n) => ({ ...n, type: "corner" as const })),
    }));
    expect(applyNodeTypes(plain, attr)).toEqual(sps);
  });

  it("ignores codes whose length does not match", () => {
    const sps: Subpath[] = [{ nodes: [corner(0, 0), corner(1, 1)], closed: false }];
    expect(applyNodeTypes(sps, "s")).toEqual(sps);
  });
});
