import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  type EllipseShape,
  type PolygonShape,
  type RectShape,
} from "../doc/document";
import { translate } from "../geom/mat";
import {
  ellipsePath,
  KAPPA,
  linePath,
  polygonPath,
  polygonSubpath,
  rectPath,
  starPath,
  toPath,
  transformSubpaths,
} from "../geom/shapes";

const closeTo = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x);
  expect(a.y).toBeCloseTo(y);
};

describe("shape generators", () => {
  it("makes a line", () => {
    expect(linePath({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({
      closed: false,
      nodes: [
        { p: { x: 1, y: 2 }, in: null, out: null, type: "corner" },
        { p: { x: 3, y: 4 }, in: null, out: null, type: "corner" },
      ],
    });
  });

  it("makes a polygon starting at the rotation angle", () => {
    const sp = polygonPath({ x: 0, y: 0 }, 10, 4, -Math.PI / 2);
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(4);
    closeTo(sp.nodes[0].p, 0, -10);
    closeTo(sp.nodes[1].p, 10, 0);
    closeTo(sp.nodes[2].p, 0, 10);
    closeTo(sp.nodes[3].p, -10, 0);
  });

  it("makes a star with alternating radii", () => {
    const sp = starPath({ x: 0, y: 0 }, 10, 0.5, 5, -Math.PI / 2);
    expect(sp.nodes).toHaveLength(10);
    closeTo(sp.nodes[0].p, 0, -10);
    const a = -Math.PI / 2 + Math.PI / 5;
    closeTo(sp.nodes[1].p, 5 * Math.cos(a), 5 * Math.sin(a));
  });

  it("makes an ellipse from four symmetric nodes", () => {
    const sp = ellipsePath(0, 0, 10, 5);
    expect(sp.closed).toBe(true);
    expect(sp.nodes.map((n) => n.p)).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 5 },
      { x: -10, y: 0 },
      { x: 0, y: -5 },
    ]);
    expect(sp.nodes[0].out).toEqual({ x: 10, y: 5 * KAPPA });
    expect(sp.nodes[0].in).toEqual({ x: 10, y: -5 * KAPPA });
    expect(sp.nodes.every((n) => n.type === "symmetric")).toBe(true);
  });

  it("merges coincident rect nodes when a radius is half a side", () => {
    expect(rectPath(0, 0, 20, 10, 2, 4).nodes).toHaveLength(8);
    const pill = rectPath(0, 0, 10, 20, 5, 5);
    expect(pill.nodes).toHaveLength(6);
    expect(pill.nodes[0].p).toEqual({ x: 5, y: 0 });
    expect(pill.nodes[0].in).not.toBeNull();
    expect(pill.nodes[0].out).not.toBeNull();
    expect(pill.nodes[0].type).toBe("smooth");
    expect(rectPath(0, 0, 10, 10, 5, 5).nodes).toHaveLength(4);
  });

  it("transforms every point and handle", () => {
    const [sp] = transformSubpaths([ellipsePath(0, 0, 10, 5)], translate(100, 0));
    expect(sp.nodes[0].p).toEqual({ x: 110, y: 0 });
    expect(sp.nodes[0].out).toEqual({ x: 110, y: 5 * KAPPA });
    expect(sp.closed).toBe(true);
  });
});

describe("toPath", () => {
  it("converts a rect, keeping id, name, transform and style", () => {
    const r: RectShape = {
      kind: "rect",
      id: "n7",
      name: "Box",
      transform: translate(5, 5),
      style: DEFAULT_STYLE,
      x: 0,
      y: 0,
      w: 10,
      h: 20,
      rx: 50,
    };
    const p = toPath(r);
    expect(p.kind).toBe("path");
    expect(p.id).toBe("n7");
    expect(p.name).toBe("Box");
    expect(p.transform).toBe(r.transform);
    expect(p.style).toBe(r.style);
    expect(p.subpaths).toHaveLength(1);
    expect(p.subpaths[0].nodes).toHaveLength(6); // radius clamped to 5 → pill
  });

  it("converts an ellipse", () => {
    const e: EllipseShape = {
      kind: "ellipse",
      id: "n8",
      transform: translate(0, 0),
      style: DEFAULT_STYLE,
      cx: 1,
      cy: 2,
      rx: 3,
      ry: 4,
    };
    const p = toPath(e);
    expect(p.subpaths[0].nodes[0].p).toEqual({ x: 4, y: 2 });
    expect("name" in p).toBe(false);
  });
});

describe("polygonSubpath", () => {
  const poly = (over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id: "p",
    transform: translate(0, 0),
    style: DEFAULT_STYLE,
    cx: 0,
    cy: 0,
    rx: 10,
    ry: 10,
    sides: 5,
    star: false,
    innerRatio: 0.5,
    ...over,
  });

  it("puts corner 0 at the top and walks clockwise on screen", () => {
    const sp = polygonSubpath(poly());
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(5);
    expect(sp.nodes.every((n) => n.type === "corner" && !n.in && !n.out)).toBe(true);
    closeTo(sp.nodes[0].p, 0, -10);
    const a = -Math.PI / 2 + (2 * Math.PI) / 5;
    closeTo(sp.nodes[1].p, 10 * Math.cos(a), 10 * Math.sin(a));
  });

  it("interleaves a star's inner corners and uses both radii", () => {
    const sp = polygonSubpath(poly({ rx: 10, ry: 20, sides: 4, star: true, innerRatio: 0.5 }));
    expect(sp.nodes).toHaveLength(8);
    closeTo(sp.nodes[0].p, 0, -20);
    closeTo(sp.nodes[1].p, 5 * Math.SQRT1_2, -10 * Math.SQRT1_2);
    closeTo(sp.nodes[2].p, 10, 0);
    closeTo(sp.nodes[4].p, 0, 20);
    closeTo(sp.nodes[6].p, -10, 0);
  });

  it("converts to a path with the same identity, transform and style", () => {
    const p = poly({ name: "Star", transform: translate(3, 4), star: true, sides: 3 });
    const path = toPath(p);
    expect(path).toMatchObject({ kind: "path", id: "p", name: "Star", style: DEFAULT_STYLE });
    expect(path.transform).toBe(p.transform);
    expect(path.subpaths).toEqual([polygonSubpath(p)]);
  });
});
