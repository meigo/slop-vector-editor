import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  applyMat,
  invert,
  isIdentity,
  multiply,
  rotate,
  scale,
  skewX,
  translate,
} from "../geom/mat";
import { dist, mid } from "../geom/vec";

describe("vec", () => {
  it("mid and dist", () => {
    expect(mid({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual({ x: 2, y: 1 });
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("mat", () => {
  it("applies translate and scale", () => {
    expect(applyMat(translate(5, -2), { x: 1, y: 1 })).toEqual({ x: 6, y: -1 });
    expect(applyMat(scale(2, 3), { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
    expect(applyMat(scale(2), { x: 1, y: 1 })).toEqual({ x: 2, y: 2 });
  });

  it("rotates counter-clockwise in math terms (clockwise on a y-down screen)", () => {
    const p = applyMat(rotate(Math.PI / 2), { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it("multiply applies the right-hand matrix first", () => {
    const m = multiply(translate(10, 0), scale(2));
    expect(applyMat(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });

  it("skewX shears x by y", () => {
    const p = applyMat(skewX(Math.PI / 4), { x: 0, y: 1 });
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1);
  });

  it("invert round-trips and rejects singular matrices", () => {
    const m = multiply(translate(3, 4), multiply(rotate(0.7), scale(2, 0.5)));
    const inv = invert(m)!;
    const p = applyMat(inv, applyMat(m, { x: 7, y: -3 }));
    expect(p.x).toBeCloseTo(7);
    expect(p.y).toBeCloseTo(-3);
    expect(invert([0, 0, 0, 0, 1, 1])).toBeNull();
  });

  it("isIdentity tolerates float noise", () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity([1, 1e-12, 0, 1, 0, 0])).toBe(true);
    expect(isIdentity(translate(0.01, 0))).toBe(false);
  });
});
