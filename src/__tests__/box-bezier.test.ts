import { describe, expect, it } from "vitest";
import type { PathNode } from "../doc/document";
import {
  cubicBounds,
  cubicPoint,
  flattenCubic,
  flattenSubpath,
  segmentCubic,
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

  it("flattens with 4 to 64 segments", () => {
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
    expect(longOut).toHaveLength(64);
    expect(longOut[63]).toEqual({ x: 3000, y: 0 });
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
