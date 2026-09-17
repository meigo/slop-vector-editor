import { describe, expect, it } from "vitest";
import type { PathNode, Subpath } from "../doc/document";
import {
  cubicBounds,
  cubicPoint,
  flattenCubic,
  flattenSubpath,
  nearestOnSubpath,
  segmentCubic,
  splitCubic,
  type Cubic,
} from "../geom/bezier";
import { boxCenter, boxContains, boxCorners, boxFromPoints, boxMap, unionBox } from "../geom/box";
import { applyMat } from "../geom/mat";
import type { Vec } from "../geom/vec";

const corner = (x: number, y: number): PathNode => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
});

describe("box", () => {
  it("builds boxes from points and unions them", () => {
    expect(boxFromPoints([])).toBeNull();
    expect(
      boxFromPoints([
        { x: 3, y: 4 },
        { x: -1, y: 10 },
      ]),
    ).toEqual({ x: -1, y: 4, w: 4, h: 6 });
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(unionBox(null, a)).toBe(a);
    expect(unionBox(a, null)).toBe(a);
    expect(unionBox(a, { x: 5, y: -5, w: 10, h: 5 })).toEqual({ x: 0, y: -5, w: 15, h: 15 });
  });

  it("tests containment, centre and corners", () => {
    const outer = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxContains(outer, { x: 1, y: 1, w: 9, h: 9 })).toBe(true);
    expect(boxContains(outer, { x: 1, y: 1, w: 10, h: 9 })).toBe(false);
    expect(boxCenter(outer)).toEqual({ x: 5, y: 5 });
    expect(boxCorners(outer)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("maps one box onto another, including mirrors and zero-size axes", () => {
    const m = boxMap({ x: 10, y: 10, w: 10, h: 20 }, { x: 0, y: 0, w: 20, h: 10 });
    expect(applyMat(m, { x: 10, y: 10 })).toEqual({ x: 0, y: 0 });
    expect(applyMat(m, { x: 20, y: 30 })).toEqual({ x: 20, y: 10 });
    const flip = boxMap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: -10, h: 10 });
    expect(applyMat(flip, { x: 10, y: 0 })).toEqual({ x: -10, y: 0 });
    const flat = boxMap({ x: 0, y: 5, w: 10, h: 0 }, { x: 0, y: 8, w: 20, h: 0 });
    expect(applyMat(flat, { x: 10, y: 5 })).toEqual({ x: 20, y: 8 });
  });
});

describe("bezier", () => {
  const arch: Cubic = [
    { x: 0, y: 0 },
    { x: 0, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 0 },
  ];

  it("evaluates points", () => {
    expect(cubicPoint(arch, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicPoint(arch, 1)).toEqual({ x: 10, y: 0 });
    expect(cubicPoint(arch, 0.5)).toEqual({ x: 5, y: -7.5 });
  });

  it("computes exact bounds from derivative roots", () => {
    const b = cubicBounds(arch);
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(-7.5);
    expect(b.w).toBeCloseTo(10);
    expect(b.h).toBeCloseTo(7.5);
  });

  it("returns null for straight segments", () => {
    expect(segmentCubic(corner(0, 0), corner(1, 1))).toBeNull();
    const a = { ...corner(0, 0), out: { x: 0, y: -10 } };
    expect(segmentCubic(a, corner(10, 0))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -10 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("flattens with 4 to 256 segments", () => {
    const shortOut: Vec[] = [];
    flattenCubic(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      shortOut,
    );
    expect(shortOut).toHaveLength(4);
    const longOut: Vec[] = [];
    flattenCubic(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
        { x: 3000, y: 0 },
      ],
      longOut,
    );
    expect(longOut).toHaveLength(256);
    expect(longOut[255]).toEqual({ x: 3000, y: 0 });
  });

  it("flattens subpaths, closing back to the start", () => {
    const square = flattenSubpath({
      closed: true,
      nodes: [corner(0, 0), corner(10, 0), corner(10, 10), corner(0, 10)],
    });
    expect(square).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
    const open = flattenSubpath({ closed: false, nodes: [corner(0, 0), corner(5, 5)] });
    expect(open).toHaveLength(2);
    expect(flattenSubpath({ closed: true, nodes: [] })).toEqual([]);
    const curved = flattenSubpath({
      closed: false,
      nodes: [
        { ...corner(0, 0), out: { x: 0, y: -10 } },
        { ...corner(10, 0), in: { x: 10, y: -10 } },
      ],
    });
    expect(curved.length).toBeGreaterThan(2);
    expect(curved[curved.length - 1]).toEqual({ x: 10, y: 0 });
  });
});

describe("splitting and picking curves", () => {
  const c: Cubic = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ];

  it("splits a cubic into two that draw the same curve", () => {
    const [a, b] = splitCubic(c, 0.5);
    expect(a[3]).toEqual(b[0]);
    expect(a[0]).toEqual(c[0]);
    expect(b[3]).toEqual(c[3]);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const whole = cubicPoint(c, u / 2);
      const half = cubicPoint(a, u);
      expect(half.x).toBeCloseTo(whole.x, 9);
      expect(half.y).toBeCloseTo(whole.y, 9);
    }
    const [s, e] = splitCubic(c, 0);
    expect(s[0]).toEqual(c[0]);
    expect(e[3]).toEqual(c[3]);
  });

  it("finds the nearest point on a subpath", () => {
    const line: Subpath = {
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
      ],
    };
    const near = nearestOnSubpath(line, { x: 5, y: 3 })!;
    expect(near.seg).toBe(0);
    expect(near.t).toBeCloseTo(0.5, 6);
    expect(near.point.x).toBeCloseTo(5, 6);
    expect(near.dist).toBeCloseTo(3, 6);

    const curve: Subpath = {
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: { x: 0, y: 10 }, type: "smooth" },
        { p: { x: 10, y: 0 }, in: { x: 10, y: 10 }, out: null, type: "smooth" },
      ],
    };
    const onCurve = nearestOnSubpath(curve, { x: 5, y: 20 })!;
    expect(onCurve.t).toBeCloseTo(0.5, 3);
    expect(onCurve.point.y).toBeGreaterThan(6);

    // A closed subpath's last segment runs from the last node back to the first.
    const tri: Subpath = {
      closed: true,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 10 }, in: null, out: null, type: "corner" },
      ],
    };
    expect(nearestOnSubpath(tri, { x: 2, y: 3 })!.seg).toBe(2);
    expect(nearestOnSubpath({ closed: false, nodes: [] }, { x: 0, y: 0 })).toBeNull();
  });

  it("flattens more finely at a larger scale", () => {
    const at1: Vec[] = [];
    const at8: Vec[] = [];
    flattenCubic(c, at1);
    flattenCubic(c, at8, 8);
    expect(at8.length).toBeGreaterThan(at1.length);
    expect(at8[at8.length - 1]).toEqual(at1[at1.length - 1]);
    expect(flattenSubpath({ closed: false, nodes: [] })).toEqual([]);
  });
});
