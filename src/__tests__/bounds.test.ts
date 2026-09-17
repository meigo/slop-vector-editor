import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type Group, type Node } from "../doc/document";
import { nodeBounds } from "../geom/bounds";
import {
  applyMat,
  IDENTITY,
  isAxisAligned,
  isSkewed,
  multiply,
  rotate,
  rotateAbout,
  rotationOf,
  scale,
  skewX,
  translate,
} from "../geom/mat";

const rect = (x: number, y: number, w: number, h: number): Node => ({
  kind: "rect",
  id: "r",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});

const expectBox = (
  b: { x: number; y: number; w: number; h: number } | null,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  expect(b).not.toBeNull();
  expect(b!.x).toBeCloseTo(x);
  expect(b!.y).toBeCloseTo(y);
  expect(b!.w).toBeCloseTo(w);
  expect(b!.h).toBeCloseTo(h);
};

describe("matrix helpers", () => {
  it("reads rotation and detects skew and axis alignment", () => {
    expect(rotationOf(rotate(0.5))).toBeCloseTo(0.5);
    expect(isSkewed(rotate(0.7))).toBe(false);
    expect(isSkewed(skewX(0.3))).toBe(true);
    expect(isSkewed(multiply(rotate(0.4), scale(2, 3)))).toBe(false);
    expect(isSkewed(multiply(scale(2, 3), rotate(0.4)))).toBe(true);
    expect(isSkewed([0, 0, 0, 1, 0, 0])).toBe(true);
    expect(isAxisAligned(scale(2, 3))).toBe(true);
    expect(isAxisAligned(rotate(0.1))).toBe(false);
  });

  it("rotates about a point", () => {
    const p = applyMat(rotateAbout(Math.PI / 2, { x: 10, y: 0 }), { x: 20, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(10);
  });
});

describe("nodeBounds", () => {
  it("bounds a rect, including under rotation", () => {
    expectBox(nodeBounds(rect(0, 0, 10, 20), IDENTITY), 0, 0, 10, 20);
    expectBox(nodeBounds(rect(0, 0, 10, 20), rotate(Math.PI / 2)), -20, 0, 20, 10);
  });

  it("bounds an ellipse exactly under rotation", () => {
    const e: Node = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 5,
    };
    expectBox(nodeBounds(e, IDENTITY), -10, -5, 20, 10);
    expectBox(nodeBounds(e, rotate(Math.PI / 2)), -5, -10, 10, 20);
  });

  it("bounds a curved path by its extrema, not its handles", () => {
    const p: Node = {
      kind: "path",
      id: "p",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: { x: 0, y: -10 }, type: "corner" },
            { p: { x: 10, y: 0 }, in: { x: 10, y: -10 }, out: null, type: "corner" },
          ],
        },
      ],
    };
    expectBox(nodeBounds(p, IDENTITY), 0, -7.5, 10, 7.5);
  });

  it("applies the node's own transform and unions group children", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: translate(100, 0),
      opacity: 1,
      children: [
        rect(0, 0, 10, 10),
        {
          kind: "ellipse",
          id: "e",
          transform: IDENTITY,
          style: DEFAULT_STYLE,
          cx: 50,
          cy: 0,
          rx: 5,
          ry: 5,
        },
      ],
    };
    expectBox(nodeBounds(g, IDENTITY), 100, -5, 55, 15);
    expect(nodeBounds({ ...g, children: [] }, IDENTITY)).toBeNull();
  });

  it("bounds a polygon by its corners", () => {
    const p: Node = {
      kind: "polygon",
      id: "p",
      transform: translate(5, 5),
      style: DEFAULT_STYLE,
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 10,
      sides: 5,
      star: false,
      innerRatio: 0.5,
    };
    const b = nodeBounds(p, IDENTITY)!;
    expect(b.x).toBeCloseTo(5 - 10 * Math.cos(Math.PI / 10));
    expect(b.y).toBeCloseTo(-5);
    expect(b.w).toBeCloseTo(20 * Math.cos(Math.PI / 10));
    expect(b.h).toBeCloseTo(10 + 10 * Math.cos(Math.PI / 5));
  });
});
