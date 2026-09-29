import { describe, expect, it } from "vitest";
import {
  brushOutline,
  outlineSubpath,
  polygonArea,
  widthRange,
  decimationSmoothing,
} from "../brush/outline";
import type { StrokePoint } from "../brush/smoothing";

const line = (n: number, pressure: (i: number) => number): StrokePoint[] =>
  Array.from({ length: n }, (_, i) => ({
    x: i * 2,
    y: 0,
    pressure: pressure(i),
    timestamp: i * 8,
  }));
const halfHeight = (o: { x: number; y: number }[], x: number, tol = 1.5) =>
  Math.max(...o.filter((p) => Math.abs(p.x - x) < tol).map((p) => Math.abs(p.y)));
const opts = { size: 10, pressureRange: 1, taper: false, smoothRadius: 0, last: true };

describe("widthRange / decimationSmoothing (ported)", () => {
  it("spans size/range to size*range", () => {
    expect(widthRange(10, 2)).toEqual({ min: 5, max: 20 });
    expect(widthRange(10, 1)).toEqual({ min: 10, max: 10 });
  });
  it("caps spacing at the thinnest width", () => {
    expect(decimationSmoothing(0.5, 1, 10)).toBeCloseTo(0.1);
    expect(decimationSmoothing(0.5, 100, 10)).toBe(0.5);
  });
});

describe("brushOutline", () => {
  it("is empty with no points", () => {
    expect(brushOutline([], opts)).toEqual([]);
  });
  it("has constant width at pressure range 1, whatever the pressure", () => {
    const o = brushOutline(
      line(60, (i) => (i % 2 ? 0 : 1)),
      opts,
    );
    const h = halfHeight(o, 60);
    expect(h).toBeGreaterThan(4);
    expect(h).toBeLessThan(6);
  });
  it("widens with pressure when the range is above 1", () => {
    const o = brushOutline(
      line(100, (i) => i / 99),
      { ...opts, pressureRange: 3 },
    );
    expect(halfHeight(o, 170)).toBeGreaterThan(halfHeight(o, 30) * 2);
  });
  it("tapers the ends to a point", () => {
    const o = brushOutline(
      line(100, () => 0.5),
      { ...opts, taper: true },
    );
    expect(halfHeight(o, 1)).toBeLessThan(2);
    expect(halfHeight(o, 100)).toBeGreaterThan(3);
  });
  it("a tap makes a round dot of the brush's width — with or without taper", () => {
    const tap: StrokePoint[] = [
      { x: 50, y: 50, pressure: 0.5, timestamp: 0 },
      { x: 50, y: 50, pressure: 0.5, timestamp: 40 },
    ];
    for (const taper of [false, true]) {
      const o = brushOutline(tap, { ...opts, taper });
      const area = polygonArea(o);
      expect(area).toBeGreaterThan(Math.PI * 25 * 0.6);
      expect(area).toBeLessThan(Math.PI * 25 * 1.6);
    }
  });
});

describe("outlineSubpath", () => {
  it("is null for fewer than 3 distinct points", () => {
    expect(
      outlineSubpath([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });
  it("closes, never repeats its first node, and passes through the edge midpoints", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const sp = outlineSubpath(sq)!;
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(4);
    expect(sp.nodes.map((n) => n.p)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 5 },
    ]);
    // quadratic control (10,0) elevated: out = m + 2/3 (c - m)
    expect(sp.nodes[0].out!.x).toBeCloseTo(5 + (2 / 3) * 5);
    expect(sp.nodes[1].in!.y).toBeCloseTo(5 - (2 / 3) * 5);
  });
});
