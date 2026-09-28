import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type LinearGradient,
  type Node,
  type PathShape,
  type PolygonShape,
  type RadialGradient,
  type RectShape,
  type Style,
  type TextMeta,
} from "../doc/document";
import { droppedLive, warpNodes, warpRefusal, warpStyle } from "../doc/warp-edit";
import { findNode } from "../doc/tree";
import type { Box } from "../geom/box";
import { applyMat, IDENTITY, invert, translate, type Mat } from "../geom/mat";
import { type Cage, identityCage, warpPoint } from "../geom/warp";

const box: Box = { x: 0, y: 0, w: 100, h: 100 };

/** A non-identity cage: the identity cage with its top-right corner dragged, a perspective-style
 *  pull that leaves plenty of room for the fit to disagree with a straight line. */
function draggedCage(b: Box = box): Cage {
  const id = identityCage(b);
  const corners = [...id.corners] as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  corners[1] = { x: corners[1].x + 30, y: corners[1].y + 20 };
  return { corners, edges: id.edges };
}

const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 200);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};

const rect = (over: Partial<RectShape> = {}): RectShape => ({
  kind: "rect",
  id: "r",
  transform: IDENTITY,
  style: DEFAULT_STYLE as Style,
  x: 10,
  y: 10,
  w: 20,
  h: 20,
  rx: 0,
  ...over,
});

const polygon = (over: Partial<PolygonShape> = {}): PolygonShape => ({
  kind: "polygon",
  id: "p",
  transform: IDENTITY,
  style: DEFAULT_STYLE as Style,
  cx: 30,
  cy: 30,
  rx: 15,
  ry: 15,
  sides: 5,
  star: false,
  innerRatio: 0.5,
  ...over,
});

const rectSubpath = (x: number, y: number, w: number, h: number) => ({
  closed: true,
  nodes: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ].map((p) => ({ p, in: null, out: null, type: "corner" as const })),
});

const title = (over: Partial<PathShape> = {}): PathShape => {
  const meta: TextMeta = {
    text: "Hi",
    font: "anton",
    size: 20,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: "left",
    seed: 1,
    amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
    overrides: {},
  };
  return {
    kind: "path",
    id: "t",
    transform: IDENTITY,
    style: DEFAULT_STYLE as Style,
    subpaths: [rectSubpath(0, 0, 40, 20)],
    text: meta,
    ...over,
  };
};

const g: LinearGradient = {
  kind: "linear",
  from: { x: 10, y: 50 },
  to: { x: 90, y: 50 },
  start: { color: "#ff0000", opacity: 1 },
  end: { color: "#0000ff", opacity: 1 },
};

const radial: RadialGradient = {
  kind: "radial",
  center: { x: 50, y: 50 },
  a: { x: 90, y: 50 },
  b: { x: 50, y: 90 },
  start: { color: "#ff0000", opacity: 1 },
  end: { color: "#0000ff", opacity: 1 },
};

describe("warpNodes (spec M14 §3)", () => {
  it("returns the same document for an identity cage", () => {
    const d = doc([rect()]);
    const out = warpNodes(d, ["r"], identityCage(box), box);
    expect(out).toBe(d);
  });

  it("bakes a rect into a path, keeping id, transform and name", () => {
    const t: Mat = translate(5, 7);
    const d = doc([rect({ id: "r1", transform: t, name: "My Rect" })]);
    const out = warpNodes(d, ["r1"], draggedCage(), box);
    const node = findNode(out, "r1")!.node;
    expect(node.kind).toBe("path");
    expect(node.id).toBe("r1");
    expect(node.transform).toBe(t);
    expect(node.name).toBe("My Rect");
    for (const sp of (node as PathShape).subpaths)
      expect(sp.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("bakes a polygon into an ordinary path", () => {
    const d = doc([polygon({ id: "p1" })]);
    const out = warpNodes(d, ["p1"], draggedCage(), box);
    expect(findNode(out, "p1")!.node.kind).toBe("path");
  });

  it("warps a group's children, leaving every transform untouched (invariant 26)", () => {
    const groupTransform: Mat = translate(3, 4);
    const childTransform: Mat = translate(1, 1);
    const group: Group = {
      kind: "group",
      id: "g1",
      transform: groupTransform,
      opacity: 1,
      children: [rect({ id: "child", transform: childTransform })],
    };
    const d = doc([group]);
    const out = warpNodes(d, ["g1"], draggedCage(), box);
    const outGroup = findNode(out, "g1")!.node as Group;
    expect(outGroup.transform).toBe(groupTransform);
    const outChild = findNode(out, "child")!.node;
    expect(outChild.transform).toBe(childTransform);
    expect(outChild.kind).toBe("path");
  });

  it("leaves a hidden child of a selected group untouched (final review 3)", () => {
    const hidden = rect({ id: "h", x: 500, y: 500, hidden: true });
    const group: Group = {
      kind: "group",
      id: "g2",
      transform: IDENTITY,
      opacity: 1,
      children: [rect({ id: "v" }), hidden],
    };
    const out = warpNodes(doc([group]), ["g2"], draggedCage(), box);
    expect(findNode(out, "h")!.node).toBe(hidden);
    expect(findNode(out, "v")!.node.kind).toBe("path");
  });

  it("leaves a node with a singular world matrix untouched", () => {
    const singular: Mat = [0, 0, 0, 0, 5, 5];
    const d = doc([rect({ id: "s", transform: singular })]);
    const out = warpNodes(d, ["s"], draggedCage(), box);
    expect(out).toBe(d);
    expect(findNode(out, "s")!.node).toBe(findNode(d, "s")!.node);
  });

  it("a title loses its text metadata", () => {
    const before = doc([title()]);
    const after = warpNodes(before, ["t"], draggedCage(), box);
    const node = findNode(after, "t")!.node as PathShape;
    expect(node.text).toBeUndefined();
    expect(droppedLive(before, after, ["t"])).toBe("Warped — a title is now an ordinary path.");
  });

  it("every subpath of a warped shape keeps at least two nodes (invariant 30 tripwire)", () => {
    const d = doc([polygon({ id: "p2", sides: 3 })]);
    const out = warpNodes(d, ["p2"], draggedCage(), box);
    for (const sp of (findNode(out, "p2")!.node as PathShape).subpaths) {
      expect(sp.nodes.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("droppedLive (spec M14 §6)", () => {
  it("counts a mix and joins the list with a final 'and'", () => {
    const before = doc([
      polygon({ id: "poly1" }),
      polygon({ id: "poly2" }),
      rect({ id: "rect1" }),
      title({ id: "title1" }),
    ]);
    const after = doc([
      {
        ...(findNode(before, "poly1")!.node as PolygonShape),
        kind: "path",
        subpaths: [rectSubpath(0, 0, 10, 10)],
      } as unknown as Node,
      {
        ...(findNode(before, "poly2")!.node as PolygonShape),
        kind: "path",
        subpaths: [rectSubpath(0, 0, 10, 10)],
      } as unknown as Node,
      {
        ...(findNode(before, "rect1")!.node as RectShape),
        kind: "path",
        subpaths: [rectSubpath(0, 0, 10, 10)],
      } as unknown as Node,
      (() => {
        const t = { ...(findNode(before, "title1")!.node as PathShape) };
        delete (t as { text?: unknown }).text;
        return t;
      })(),
    ]);
    const msg = droppedLive(before, after, ["poly1", "poly2", "rect1", "title1"]);
    expect(msg).toBe("Warped — 2 polygons, a rectangle and a title are now ordinary paths.");
  });

  it("returns null when nothing lost liveness", () => {
    const p1: PathShape = {
      kind: "path",
      id: "a",
      transform: IDENTITY,
      style: DEFAULT_STYLE as Style,
      subpaths: [rectSubpath(0, 0, 10, 10)],
    };
    const before = doc([p1]);
    const after = doc([{ ...p1, subpaths: [rectSubpath(1, 1, 10, 10)] }]);
    expect(droppedLive(before, after, ["a"])).toBeNull();
  });
});

describe("warpStyle (spec M14 §0.3)", () => {
  it("returns the same style object when neither paint is a gradient", () => {
    const style = DEFAULT_STYLE as Style;
    expect(warpStyle(style, IDENTITY, draggedCage(), box)).toBe(style);
  });

  it("moves a linear gradient's from/to exactly as warpPoint moves them", () => {
    const style: Style = { ...(DEFAULT_STYLE as Style), fill: g };
    const cage = draggedCage();
    const out = warpStyle(style, IDENTITY, cage, box);
    const fill = out.fill as LinearGradient;
    expect(fill.from).toEqual(warpPoint(cage, box, g.from));
    expect(fill.to).toEqual(warpPoint(cage, box, g.to));
  });

  it("keeps mid and midPaint", () => {
    const withMid: LinearGradient = { ...g, mid: 0.3, midPaint: { color: "#00ff00", opacity: 1 } };
    const style: Style = { ...(DEFAULT_STYLE as Style), fill: withMid };
    const out = warpStyle(style, IDENTITY, draggedCage(), box);
    const fill = out.fill as LinearGradient;
    expect(fill.mid).toBe(0.3);
    expect(fill.midPaint).toEqual({ color: "#00ff00", opacity: 1 });
  });

  it("moves a radial gradient's three points", () => {
    const style: Style = { ...(DEFAULT_STYLE as Style), fill: radial };
    const cage = draggedCage();
    const out = warpStyle(style, IDENTITY, cage, box);
    const fill = out.fill as RadialGradient;
    expect(fill.center).toEqual(warpPoint(cage, box, radial.center));
    expect(fill.a).toEqual(warpPoint(cage, box, radial.a));
    expect(fill.b).toEqual(warpPoint(cage, box, radial.b));
  });

  it("maps a gradient on a translated node through the matrix and back", () => {
    const world = translate(10, 5);
    const inv = invert(world)!;
    const style: Style = { ...(DEFAULT_STYLE as Style), fill: g };
    const cage = draggedCage();
    const out = warpStyle(style, world, cage, box);
    const fill = out.fill as LinearGradient;
    const expected = (p: { x: number; y: number }) =>
      applyMat(inv, warpPoint(cage, box, applyMat(world, p)));
    expect(fill.from).toEqual(expected(g.from));
    expect(fill.to).toEqual(expected(g.to));
  });
});

describe("warpRefusal (spec M14 §7)", () => {
  it("refuses an empty selection", () => {
    expect(warpRefusal(doc([]), [])).toBe("Warp — select something to warp");
  });

  it("refuses a zero-height selection", () => {
    const line: PathShape = {
      kind: "path",
      id: "line",
      transform: IDENTITY,
      style: DEFAULT_STYLE as Style,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 10 }, in: null, out: null, type: "corner" },
            { p: { x: 50, y: 10 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    expect(warpRefusal(doc([line]), ["line"])).toBe(
      "Warp — select something with width and height",
    );
  });

  it("allows a rect", () => {
    expect(warpRefusal(doc([rect()]), ["r"])).toBeNull();
  });
});
