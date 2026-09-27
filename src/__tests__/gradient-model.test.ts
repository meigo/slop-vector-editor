import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  flatIfDegenerate,
  isGradient,
  isLinear,
  isRadial,
  mapStyle,
  radialMatrix,
  sameColours,
  sameFill,
  type LinearGradient,
  type RadialGradient,
  type Style,
} from "../doc/document";
import { IDENTITY, translate } from "../geom/mat";
import { deepFreeze } from "./helpers";

const red = { color: "#ff0000", opacity: 1 };
const clear = { color: "#ff0000", opacity: 0 };
const grad = (fx: number, fy: number, tx: number, ty: number): LinearGradient => ({
  kind: "linear",
  from: { x: fx, y: fy },
  to: { x: tx, y: ty },
  start: red,
  end: clear,
});

describe("gradient model (spec M15 §2)", () => {
  it("tells a gradient from a flat paint", () => {
    expect(isGradient(grad(0, 0, 10, 0))).toBe(true);
    expect(isGradient(red)).toBe(false);
    expect(isGradient(null)).toBe(false);
  });

  it("sameFill is exact, sameColours ignores the points", () => {
    expect(sameFill(grad(0, 0, 10, 0), grad(0, 0, 10, 0))).toBe(true);
    expect(sameFill(grad(0, 0, 10, 0), grad(0, 0, 20, 0))).toBe(false);
    expect(sameColours(grad(0, 0, 10, 0), grad(5, 5, 20, 0))).toBe(true);
    expect(sameColours(grad(0, 0, 10, 0), { ...grad(0, 0, 10, 0), end: red })).toBe(false);
    expect(sameFill(red, grad(0, 0, 10, 0))).toBe(false);
    expect(sameColours(red, { ...red })).toBe(true);
    expect(sameFill(null, null)).toBe(true);
    expect(sameFill(null, red)).toBe(false);
  });

  it("collapses a gradient whose points coincide as written to its end stop", () => {
    expect(flatIfDegenerate(grad(1, 1, 1, 1))).toEqual(clear);
    // 1e-7 apart: equal after 6-decimal rounding, so it would reload as flat — collapse now.
    expect(flatIfDegenerate(grad(1, 1, 1 + 1e-7, 1))).toEqual(clear);
    const g = grad(0, 0, 1e-5, 0);
    expect(flatIfDegenerate(g)).toBe(g);
  });

  it("mapStyle keeps the same reference without gradients and maps both points with them", () => {
    const flat: Style = deepFreeze({ ...DEFAULT_STYLE });
    expect(mapStyle(flat, translate(5, 5))).toBe(flat);
    const s: Style = deepFreeze({
      ...DEFAULT_STYLE,
      fill: grad(0, 0, 10, 0),
      stroke: grad(0, 0, 0, 10),
    });
    expect(mapStyle(s, IDENTITY)).toBe(s);
    const m = mapStyle(s, [2, 0, 0, 2, 1, 1]);
    expect(m.fill).toEqual({ ...grad(1, 1, 21, 1) });
    expect(m.stroke).toEqual({ ...grad(1, 1, 1, 21) });
  });

  it("mapStyle collapses a gradient a singular matrix squashes flat", () => {
    const s: Style = { ...DEFAULT_STYLE, fill: grad(0, 0, 10, 0) };
    expect(mapStyle(s, [0, 0, 0, 1, 0, 0]).fill).toEqual(clear);
  });
});

const rad = (c: [number, number], a: [number, number], b: [number, number]): RadialGradient => ({
  kind: "radial",
  center: { x: c[0], y: c[1] },
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  start: red,
  end: clear,
});

describe("radial gradients in the model (spec M16 §2)", () => {
  it("narrows the two kinds", () => {
    const r = rad([0, 0], [10, 0], [0, 10]);
    expect(isGradient(r)).toBe(true);
    expect(isRadial(r)).toBe(true);
    expect(isLinear(r)).toBe(false);
    expect(isLinear(grad(0, 0, 10, 0))).toBe(true);
    expect(isRadial(red)).toBe(false);
  });

  it("treats a linear and a radial with the same colours as different fills", () => {
    const r = rad([0, 0], [10, 0], [0, 10]);
    expect(sameFill(r, rad([0, 0], [10, 0], [0, 10]))).toBe(true);
    expect(sameFill(r, rad([0, 0], [10, 0], [0, 11]))).toBe(false);
    expect(sameColours(r, rad([5, 5], [9, 5], [5, 9]))).toBe(true);
    expect(sameColours(r, grad(0, 0, 10, 0))).toBe(false);
  });

  it("builds the unit-circle matrix from the three points", () => {
    expect(radialMatrix(rad([50, 40], [80, 40], [50, 50]))).toEqual([30, 0, 0, 10, 50, 40]);
  });

  it("collapses a radial whose matrix is singular as written to its end stop", () => {
    expect(flatIfDegenerate(rad([0, 0], [10, 0], [20, 0]))).toEqual(clear); // rims on one line
    expect(flatIfDegenerate(rad([0, 0], [1e-7, 0], [0, 1e-7]))).toEqual(clear); // rounds to 0
    const r = rad([0, 0], [10, 0], [0, 10]);
    expect(flatIfDegenerate(r)).toBe(r);
  });

  it("collapses a near-degenerate radial the importer's own invert would refuse (review finding 3)", () => {
    // a − c and b − c are exactly parallel (b = k · a for some real k), but at 6-decimal
    // precision the written determinant is ~5.5e-17 float noise, not exactly 0 — `invert`
    // (mat.ts) already refuses anything under 1e-12, so this must collapse here too, or it
    // saves as a matrix and is dropped as "gradients with an invalid transform" on reload.
    const noisy = rad([0, 0], [0.580138, -0.525408], [-0.836976, 0.758016]);
    expect(flatIfDegenerate(noisy)).toEqual(clear);
    // A small but healthy ellipse (det 1e-4, well above the threshold) is kept.
    const tiny = rad([0, 0], [0.01, 0], [0, 0.01]);
    expect(flatIfDegenerate(tiny)).toBe(tiny);
  });

  it("mapStyle maps all three radial points, skew included", () => {
    const s: Style = { ...DEFAULT_STYLE, fill: rad([0, 0], [10, 0], [0, 10]) };
    expect(mapStyle(s, [1, 0, 0.5, 1, 0, 0]).fill).toEqual(rad([0, 0], [10, 0], [5, 10]));
  });
});
