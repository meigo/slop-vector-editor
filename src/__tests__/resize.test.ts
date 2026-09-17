import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type EllipseShape,
  type Group,
  type Node,
  type PathShape,
  type PolygonShape,
  type RectShape,
} from "../doc/document";
import { resizeNode, resizeNodes } from "../doc/resize";
import { boxMap } from "../geom/box";
import { applyMat, IDENTITY, multiply, rotate, rotateAbout, scale, translate } from "../geom/mat";
import { linePath, polygonSubpath } from "../geom/shapes";
import { deepFreeze } from "./helpers";

const style = { ...DEFAULT_STYLE, strokeWidth: 3 };
const rect = (over: Partial<RectShape> = {}): RectShape => ({
  kind: "rect",
  id: "r",
  transform: IDENTITY,
  style,
  x: 0,
  y: 0,
  w: 10,
  h: 20,
  rx: 4,
  ...over,
});

describe("resizeNode", () => {
  it("bakes an axis-aligned scale into a rect, keeping radius and stroke", () => {
    const out = resizeNode(rect(), scale(3, 0.5)) as RectShape;
    expect(out).toMatchObject({ kind: "rect", x: 0, y: 0, w: 30, h: 10, rx: 4 });
    expect(out.transform).toEqual(IDENTITY);
    expect(out.style.strokeWidth).toBe(3);
    const small = resizeNode(rect(), scale(0.5, 0.2)) as RectShape;
    expect(small.rx).toBe(2); // clamped to min(w, h) / 2 = min(5, 4) / 2
  });

  it("normalises a mirrored rect", () => {
    const out = resizeNode(
      rect({ x: 10 }),
      boxMap({ x: 10, y: 0, w: 10, h: 20 }, { x: 10, y: 0, w: -10, h: 20 }),
    ) as RectShape;
    expect(out).toMatchObject({ x: 0, y: 0, w: 10, h: 20 });
  });

  it("resizes a rotated rect in its own frame without converting it", () => {
    const m = rotateAbout(Math.PI / 6, { x: 5, y: 10 });
    const r = rect({ transform: m });
    // A frame-aligned resize: rotate(θ) · scale · rotate(−θ)
    const A = multiply(rotate(Math.PI / 6), multiply(scale(2, 1), rotate(-Math.PI / 6)));
    const out = resizeNode(r, A);
    expect(out.kind).toBe("rect");
    expect(out.transform).toBe(m);
    expect((out as RectShape).w).toBeCloseTo(20);
    expect((out as RectShape).h).toBeCloseTo(20);
  });

  it("converts a rotated rect to a path for a doc-axis non-uniform resize", () => {
    const r = rect({ transform: rotate(Math.PI / 6) });
    const out = resizeNode(r, scale(2, 1));
    expect(out.kind).toBe("path");
    expect(out.transform).toBe(r.transform);
    expect(out.id).toBe("r");
  });

  it("keeps a uniformly scaled rotated rect a rect", () => {
    const r = rect({ transform: rotate(Math.PI / 6) });
    const out = resizeNode(r, scale(2)) as RectShape;
    expect(out.kind).toBe("rect");
    expect(out.w).toBeCloseTo(20);
    expect(out.h).toBeCloseTo(40);
  });

  it("bakes into ellipses and paths", () => {
    const e: EllipseShape = {
      kind: "ellipse",
      id: "e",
      transform: translate(100, 0),
      style,
      cx: 10,
      cy: 10,
      rx: 5,
      ry: 5,
    };
    // Doc-space scale by 2 about the doc origin: local L = translate(100,0)·scale(2) mapped back.
    const out = resizeNode(e, scale(2)) as EllipseShape;
    expect(out.transform).toBe(e.transform);
    expect(out.rx).toBe(10);
    expect(out.ry).toBe(10);
    expect(out.cx).toBe(120);
    expect(out.cy).toBe(20);
    const p: PathShape = {
      kind: "path",
      id: "p",
      transform: IDENTITY,
      style,
      subpaths: [linePath({ x: 1, y: 2 }, { x: 3, y: 4 })],
    };
    const pout = resizeNode(p, scale(2, 3)) as PathShape;
    expect(pout.subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 2, y: 6 },
      { x: 6, y: 12 },
    ]);
  });

  it("recurses into groups, keeping the group matrix", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: translate(10, 0),
      opacity: 1,
      children: [rect()],
    };
    const out = resizeNode(g, scale(2)) as Group;
    expect(out.transform).toBe(g.transform);
    expect(out.children[0]).toMatchObject({ x: 10, y: 0, w: 20, h: 40 });
  });

  it("returns the same node for identity or singular matrices", () => {
    const r = rect();
    expect(resizeNode(r, IDENTITY)).toBe(r);
    const s = rect({ transform: [0, 0, 0, 0, 0, 0] });
    expect(resizeNode(s, scale(2))).toBe(s);
  });
});

describe("polygon resize", () => {
  const poly = (over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id: "p",
    transform: IDENTITY,
    style,
    cx: 10,
    cy: 10,
    rx: 10,
    ry: 10,
    sides: 5,
    star: false,
    innerRatio: 0.5,
    ...over,
  });
  /** Rendered corners, rounded and sorted, so shapes are compared as point sets. */
  const corners = (s: PolygonShape) =>
    polygonSubpath(s)
      .nodes.map((n) => applyMat(s.transform, n.p))
      .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`.replace(/-0\.000000/g, "0.000000"))
      .sort();
  const expected = (s: PolygonShape, A: ReturnType<typeof scale>) =>
    polygonSubpath(s)
      .nodes.map((n) => applyMat(A, applyMat(s.transform, n.p)))
      .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`.replace(/-0\.000000/g, "0.000000"))
      .sort();

  it("scales and stretches into the radii, keeping the stroke", () => {
    const out = resizeNode(poly(), scale(2, 3)) as PolygonShape;
    expect(out).toMatchObject({ kind: "polygon", cx: 20, cy: 30, rx: 20, ry: 30, sides: 5 });
    expect(out.transform).toEqual(IDENTITY);
    expect(out.style.strokeWidth).toBe(3);
  });

  it("needs nothing extra for a horizontal flip", () => {
    const A = scale(-1, 1);
    const out = resizeNode(poly(), A) as PolygonShape;
    expect(out.kind).toBe("polygon");
    expect(out.transform).toEqual(IDENTITY);
    expect(corners(out)).toEqual(expected(poly(), A));
  });

  it("adds a half-turn when flipping an odd polygon vertically", () => {
    const A = scale(1, -2);
    const out = resizeNode(poly(), A) as PolygonShape;
    expect(out).toMatchObject({ cx: 10, cy: -20, rx: 10, ry: 20 });
    expect(out.transform).toEqual([-1, 0, 0, -1, 20, -40]);
    expect(corners(out)).toEqual(expected(poly(), A));
  });

  it("needs no half-turn for an even polygon or star", () => {
    const A = scale(1, -1);
    for (const s of [poly({ sides: 6 }), poly({ sides: 4, star: true })]) {
      const out = resizeNode(s, A) as PolygonShape;
      expect(out.transform).toEqual(IDENTITY);
      expect(corners(out)).toEqual(expected(s, A));
    }
  });

  it("flips a rotated odd star correctly through its own axes", () => {
    const s = poly({ sides: 5, star: true, transform: rotateAbout(0.4, { x: 10, y: 10 }) });
    // A resize along the shape's own axes: in its local space this is scale(1, -1) about (10, 10)
    const A = multiply(
      s.transform,
      multiply(
        translate(10, 10),
        multiply(scale(1, -1), multiply(translate(-10, -10), rotateAbout(-0.4, { x: 10, y: 10 }))),
      ),
    );
    const out = resizeNode(s, A) as PolygonShape;
    expect(out.kind).toBe("polygon");
    expect(corners(out)).toEqual(expected(s, A));
  });

  it("becomes a path when resized at an angle to its axes", () => {
    const out = resizeNode(poly(), multiply(rotate(0.3), multiply(scale(2, 1), rotate(-0.3))));
    expect(out.kind).toBe("path");
  });
});

describe("resizeNodes", () => {
  it("applies to top-level ids and is a no-op for identity", () => {
    const d: Doc = deepFreeze({
      ...createDoc(10, 10),
      layers: [{ id: "L", name: "L", visible: true, locked: false, children: [rect() as Node] }],
    });
    expect(resizeNodes(d, ["r"], IDENTITY)).toBe(d);
    const out = resizeNodes(d, ["r"], scale(2));
    expect(out.layers[0].children[0]).toMatchObject({ w: 20, h: 40 });
  });
});
