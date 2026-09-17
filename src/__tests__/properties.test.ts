import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Node,
  type PolygonShape,
  type RectShape,
  type Style,
} from "../doc/document";
import { applyMat, IDENTITY, rotateAbout, translate, type Mat } from "../geom/mat";
import {
  applyGeometryField,
  selectionActions,
  selectionGeometry,
  selectionStyles,
  summarizePolygons,
  summarizeStyles,
} from "../state/properties";
import { deepFreeze } from "./helpers";

const rect = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: Style = DEFAULT_STYLE,
  t: Mat = IDENTITY,
): RectShape => ({
  kind: "rect",
  id,
  transform: t,
  style,
  x,
  y,
  w,
  h,
  rx: 0,
});

const doc = (...children: Node[]): Doc =>
  deepFreeze({
    ...createDoc(200, 200),
    layers: [{ id: "L", name: "L", visible: true, locked: false, children }],
  });

const get = (d: Doc, id: string) => d.layers[0].children.find((n) => n.id === id)!;

describe("style summary", () => {
  it("reports shared values and mixed ones", () => {
    expect(summarizeStyles([])).toBeNull();
    const one = summarizeStyles([DEFAULT_STYLE])!;
    expect(one.fill).toEqual({ mixed: false, value: DEFAULT_STYLE.fill });
    expect(one.strokeWidth).toEqual({ mixed: false, value: 1 });
    const other: Style = { ...DEFAULT_STYLE, fill: null, stroke: { ...DEFAULT_STYLE.stroke! } };
    const two = summarizeStyles([DEFAULT_STYLE, other])!;
    expect(two.fill).toEqual({ mixed: true });
    expect(two.stroke).toEqual({ mixed: false, value: DEFAULT_STYLE.stroke });
    expect(two.cap).toEqual({ mixed: false, value: "butt" });
  });

  it("collects styles from shapes inside groups", () => {
    const d = doc(rect("a", 0, 0, 10, 10), {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("b", 0, 0, 1, 1), rect("c", 0, 0, 1, 1)],
    });
    expect(selectionStyles(d, ["a", "g", "zz"])).toHaveLength(3);
  });
});

describe("geometry fields", () => {
  const d = doc(rect("a", 10, 20, 30, 40));

  it("summarises position, size and rotation", () => {
    expect(selectionGeometry(d, ["a"])).toEqual({ x: 10, y: 20, w: 30, h: 40, r: 0 });
    expect(selectionGeometry(d, [])).toBeNull();
    const rotated = doc(
      rect("r", 0, 0, 10, 20, DEFAULT_STYLE, rotateAbout(Math.PI / 6, { x: 5, y: 10 })),
    );
    const g = selectionGeometry(rotated, ["r"])!;
    expect(g.r).toBeCloseTo(30);
    expect(g.w).toBeCloseTo(10);
    expect(g.h).toBeCloseTo(20);
  });

  it("moves with X and Y", () => {
    const moved = applyGeometryField(d, ["a"], "x", 15);
    expect(applyMat(get(moved, "a").transform, { x: 0, y: 0 })).toEqual({ x: 5, y: 0 });
    expect(selectionGeometry(applyGeometryField(d, ["a"], "y", 0), ["a"])!.y).toBe(0);
    expect(applyGeometryField(d, ["a"], "x", 10)).toBe(d);
  });

  it("resizes with W and H, keeping the top-left", () => {
    expect(get(applyGeometryField(d, ["a"], "w", 60), "a")).toMatchObject({
      x: 10,
      y: 20,
      w: 60,
      h: 40,
    });
    expect(get(applyGeometryField(d, ["a"], "h", 10), "a")).toMatchObject({
      x: 10,
      y: 20,
      w: 30,
      h: 10,
    });
    expect(applyGeometryField(d, ["a"], "h", 0)).toBe(d);
    expect(applyGeometryField(d, ["a"], "h", -5)).toBe(d);
    expect(applyGeometryField(d, ["a"], "w", Number.NaN)).toBe(d);
    expect(applyGeometryField(d, ["a"], "w", 30)).toBe(d);
  });

  it("rotates to an angle about the frame centre", () => {
    const r = applyGeometryField(d, ["a"], "r", 90);
    const corner = applyMat(get(r, "a").transform, { x: 10, y: 20 });
    expect(corner.x).toBeCloseTo(45);
    expect(corner.y).toBeCloseTo(25);
    expect(selectionGeometry(r, ["a"])!.r).toBeCloseTo(90);
    expect(applyGeometryField(d, ["a"], "r", 0)).toBe(d);
    expect(applyGeometryField(d, [], "r", 45)).toBe(d);
  });
});

describe("selection actions", () => {
  const path = (id: string, t: Mat): Node => ({
    kind: "path",
    id,
    transform: t,
    style: DEFAULT_STYLE,
    subpaths: [
      {
        closed: false,
        nodes: [
          { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
          { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
        ],
      },
    ],
  });
  const d = doc(rect("a", 0, 0, 10, 10), path("p", IDENTITY), path("q", translate(5, 0)));

  it("offers convert for rects and ellipses, flatten for transformed paths", () => {
    expect(selectionActions(d, [])).toEqual({ canConvert: false, canFlatten: false });
    expect(selectionActions(d, ["a"])).toEqual({ canConvert: true, canFlatten: false });
    expect(selectionActions(d, ["p"])).toEqual({ canConvert: false, canFlatten: false });
    expect(selectionActions(d, ["q"])).toEqual({ canConvert: false, canFlatten: true });
    expect(selectionActions(d, ["a", "q", "gone"])).toEqual({ canConvert: true, canFlatten: true });
  });
});

describe("polygon summary", () => {
  const poly = (id: string, over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id,
    transform: IDENTITY,
    style: DEFAULT_STYLE,
    cx: 50,
    cy: 50,
    rx: 10,
    ry: 10,
    sides: 5,
    star: false,
    innerRatio: 0.5,
    ...over,
  });

  it("summarises polygons, blanking values that differ", () => {
    const d = doc(poly("a"), poly("b", { sides: 6, star: true }), rect("r", 0, 0, 5, 5));
    expect(summarizePolygons(d, [])).toBeNull();
    expect(summarizePolygons(d, ["a", "r"])).toBeNull();
    expect(summarizePolygons(d, ["a"])).toEqual({
      sides: 5,
      star: false,
      innerRatio: 0.5,
      anyStar: false,
    });
    expect(summarizePolygons(d, ["a", "b"])).toEqual({
      sides: null,
      star: "mixed",
      innerRatio: 0.5,
      anyStar: true,
    });
  });

  it("offers Convert to path for polygons", () => {
    const d = doc(poly("a"));
    expect(selectionActions(d, ["a"]).canConvert).toBe(true);
  });
});
