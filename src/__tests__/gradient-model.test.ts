import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  flatIfDegenerate,
  isGradient,
  mapStyle,
  sameColours,
  sameFill,
  type LinearGradient,
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
