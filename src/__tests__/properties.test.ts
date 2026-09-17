import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Node,
  type PolygonShape,
  type RectShape,
  type Style,
} from "../doc/document";
import { setNodeOpacity } from "../doc/edits";
import { findNode } from "../doc/tree";
import { applyMat, IDENTITY, rotateAbout, translate, type Mat } from "../geom/mat";
import {
  applyGeometryField,
  selectionActions,
  selectionGeometry,
  selectionOpacity,
  selectionStyles,
  summarizePolygons,
  summarizeRects,
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
    expect(one.fillOn).toEqual({ mixed: false, value: true });
    const other: Style = { ...DEFAULT_STYLE, fill: null, stroke: { ...DEFAULT_STYLE.stroke! } };
    const two = summarizeStyles([DEFAULT_STYLE, other])!;
    expect(two.fill).toEqual({ mixed: true });
    expect(two.stroke).toEqual({ mixed: false, value: DEFAULT_STYLE.stroke });
    expect(two.cap).toEqual({ mixed: false, value: "butt" });
    expect(two.fillOn).toEqual({ mixed: true });
    expect(two.strokeOn).toEqual({ mixed: false, value: true });

    // Different fill colours: `fill` is mixed, but every shape still has a fill, so `fillOn` is not.
    const otherColor: Style = { ...DEFAULT_STYLE, fill: { color: "#0000ff", opacity: 1 } };
    const three = summarizeStyles([DEFAULT_STYLE, otherColor])!;
    expect(three.fill).toEqual({ mixed: true });
    expect(three.fillOn).toEqual({ mixed: false, value: true });
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
    expect(selectionActions(d, [])).toMatchObject({ canConvert: false, canFlatten: false });
    expect(selectionActions(d, ["a"])).toMatchObject({ canConvert: true, canFlatten: false });
    expect(selectionActions(d, ["p"])).toMatchObject({ canConvert: false, canFlatten: false });
    expect(selectionActions(d, ["q"])).toMatchObject({ canConvert: false, canFlatten: true });
    expect(selectionActions(d, ["a", "q", "gone"])).toMatchObject({
      canConvert: true,
      canFlatten: true,
    });
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

describe("rect summary", () => {
  it("summarises rect radii, blanking values that differ", () => {
    const e: Node = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 5,
      cy: 5,
      rx: 5,
      ry: 5,
    };
    const d = doc(
      rect("a", 0, 0, 10, 10),
      { ...rect("b", 20, 0, 10, 10), rx: 3 },
      { ...rect("c", 40, 0, 10, 10), rx: 3 },
      e,
    );
    expect(summarizeRects(d, [])).toBeNull();
    expect(summarizeRects(d, ["a", "e"])).toBeNull();
    expect(summarizeRects(d, ["b", "c"])).toEqual({ radius: 3 });
    expect(summarizeRects(d, ["a", "b"])).toEqual({ radius: null });
  });
});

describe("group-aware selection helpers", () => {
  const rect = (id: string, opacity = 1): Node => ({
    kind: "rect",
    id,
    transform: IDENTITY,
    style: { ...DEFAULT_STYLE, opacity },
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rx: 0,
  });
  const doc = (children: Node[]): Doc =>
    deepFreeze({
      ...createDoc(100, 100),
      layers: [{ id: "L0", name: "L0", visible: true, locked: false, children }],
    });
  const g = (id: string, opacity: number, children: Node[]): Node => ({
    kind: "group",
    id,
    transform: IDENTITY,
    opacity,
    children,
  });

  it("reports what can be grouped and ungrouped", () => {
    const d = doc([rect("a"), g("g", 1, [rect("b")])]);
    expect(selectionActions(d, ["a"]).canGroup).toBe(true);
    expect(selectionActions(d, ["a"]).canUngroup).toBe(false);
    expect(selectionActions(d, ["g"]).canUngroup).toBe(true);
    expect(selectionActions(d, []).canGroup).toBe(false);
  });

  it("reads a group's own opacity alongside shape opacity", () => {
    const d = doc([rect("a", 0.5), g("g", 0.5, [rect("b", 1)])]);
    expect(selectionOpacity(d, ["a", "g"])).toEqual({ mixed: false, value: 0.5 });
    expect(selectionOpacity(d, ["a", "b"])).toEqual({ mixed: true });
    expect(selectionOpacity(d, [])).toBeNull();
  });

  it("writes opacity to groups and shapes without touching a group's children", () => {
    const d = doc([rect("a", 1), g("g", 1, [rect("b", 1)])]);
    const out = setNodeOpacity(d, ["a", "g"], 0.25);
    const a = findNode(out, "a")!.node;
    expect(a.kind === "group" ? null : a.style.opacity).toBe(0.25);
    expect((findNode(out, "g")!.node as Group).opacity).toBe(0.25);
    const b = findNode(out, "b")!.node;
    expect(b.kind === "group" ? null : b.style.opacity).toBe(1);
    expect(setNodeOpacity(d, ["a"], 1)).toBe(d);
  });
});
