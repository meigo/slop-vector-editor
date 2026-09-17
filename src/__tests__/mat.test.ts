import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  applyMat,
  inParent,
  invert,
  isAxisAligned,
  isIdentity,
  multiply,
  reparent,
  rotate,
  scale,
  skewX,
  translate,
  type Mat,
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

describe("parent-space conversion", () => {
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  };

  it("expresses a document-space map inside a parent", () => {
    const move = translate(10, 0);
    expect(inParent(IDENTITY, move)).toEqual(move);
    const scaled: Mat = [2, 0, 0, 2, 0, 0];
    // In a parent scaled by 2, a 10-unit document move is a 5-unit local move.
    expect(inParent(scaled, move)).toEqual(translate(5, 0));
    const turned = rotate(Math.PI / 2);
    const local = inParent(turned, move)!;
    // The same point ends up in the same place either way.
    const p = { x: 3, y: 4 };
    close(applyMat(multiply(turned, local), p), applyMat(multiply(move, turned), p));
    expect(inParent([0, 0, 0, 0, 0, 0], move)).toBeNull();
  });

  it("keeps a node in place when it changes parent", () => {
    const from = multiply(translate(100, 50), rotate(0.3));
    const to = multiply(translate(-20, 7), rotate(-1.1));
    const t = multiply(translate(5, 5), [2, 0, 0, 2, 0, 0] as Mat);
    const moved = reparent(from, to, t)!;
    const p = { x: 2, y: -3 };
    close(applyMat(multiply(to, moved), p), applyMat(multiply(from, t), p));
    expect(reparent(from, [0, 0, 0, 0, 0, 0], t)).toBeNull();
  });

  it("measures skew against the matrix's own scale", () => {
    expect(isAxisAligned(IDENTITY)).toBe(true);
    expect(isAxisAligned([2, 1e-12, 1e-12, 3, 0, 0])).toBe(true);
    // A tiny matrix with a proportionally large shear is not axis-aligned.
    expect(isAxisAligned([1e-10, 5e-11, 0, 1e-10, 0, 0])).toBe(false);
    expect(isAxisAligned([0, 0, 0, 0, 0, 0])).toBe(true);
  });
});
