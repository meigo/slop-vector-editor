import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Node,
  type Shape,
} from "../doc/document";
import { flipNodes } from "../doc/flip";
import { findNode } from "../doc/tree";
import { nodeBounds } from "../geom/bounds";
import { applyMat, IDENTITY, multiply, rotate, translate, type Mat } from "../geom/mat";
import { selectionFrame } from "../tools/frame";

const rect = (id: string, x: number, y: number, t: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: DEFAULT_STYLE,
  x,
  y,
  w: 20,
  h: 10,
  rx: 0,
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 200);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};
const nodeOf = (d: Doc, id: string) => findNode(d, id)!;
const worldBox = (d: Doc, id: string) => {
  const f = nodeOf(d, id);
  return nodeBounds(f.node, f.parent)!;
};

describe("flipNodes (2026-09-28)", () => {
  it("mirrors the selection about the centre of its bounds, keeping those bounds", () => {
    // Two rects: a at x 0–20, b at x 60–80 → bounds 0–80, centre 40.
    const d0 = doc([rect("a", 0, 0), rect("b", 60, 30)]);
    const d1 = flipNodes(d0, ["a", "b"], "h");
    expect(worldBox(d1, "a").x).toBeCloseTo(60, 9); // a moves to where b was
    expect(worldBox(d1, "b").x).toBeCloseTo(0, 9);
    expect(worldBox(d1, "a").y).toBeCloseTo(0, 9); // y untouched
    const d2 = flipNodes(d0, ["a", "b"], "v");
    expect(worldBox(d2, "a").y).toBeCloseTo(30, 9); // bounds 0–40, a (0–10) → 30–40
    expect(worldBox(d2, "a").x).toBeCloseTo(0, 9);
  });

  it("changes only the transform: geometry, style and kind are untouched", () => {
    const d0 = doc([rect("a", 5, 5)]);
    const d1 = flipNodes(d0, ["a"], "h");
    const a0 = nodeOf(d0, "a").node as Shape;
    const a1 = nodeOf(d1, "a").node as Shape;
    expect(a1).toEqual({ ...a0, transform: a1.transform });
    expect(a1.style).toBe(a0.style);
    expect(a1.transform[0]).toBe(-1);
  });

  it("flipping twice restores the transform exactly", () => {
    const d0 = doc([rect("a", 3, 7, translate(11, -4))]);
    const back = flipNodes(flipNodes(d0, ["a"], "v"), ["a"], "v");
    expect(nodeOf(back, "a").node.transform).toEqual(nodeOf(d0, "a").node.transform);
  });

  it("flips a group as a unit, leaving its children's transforms alone", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: translate(50, 0),
      opacity: 1,
      children: [rect("c", 0, 0, translate(1, 2))],
    };
    const d1 = flipNodes(doc([g]), ["g"], "h");
    expect(nodeOf(d1, "c").node.transform).toEqual(translate(1, 2));
    expect(worldBox(d1, "c").x).toBeCloseTo(51, 9); // a lone group flips in place
  });

  it("flips a child inside a transformed parent in document space", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: multiply(translate(100, 100), rotate(Math.PI / 2)),
      opacity: 1,
      children: [rect("c", 0, 0), rect("d", 40, 0)],
    };
    const d0 = doc([g]);
    const d1 = flipNodes(d0, ["c", "d"], "h");
    const before = worldBox(d0, "c");
    const after = worldBox(d1, "c");
    const u = worldBox(d0, "d");
    // The union of c and d is mirrored horizontally in DOCUMENT space.
    const lo = Math.min(before.x, u.x);
    const hi = Math.max(before.x + before.w, u.x + u.w);
    expect(after.x).toBeCloseTo(lo + hi - (before.x + before.w), 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("keeps a polygon a polygon and a title a title", () => {
    const poly: Node = {
      kind: "polygon",
      id: "p",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      sides: 5,
      star: false,
      innerRatio: 0.5,
      cx: 50,
      cy: 50,
      rx: 20,
      ry: 20,
    };
    const d1 = flipNodes(doc([poly]), ["p"], "v");
    expect(nodeOf(d1, "p").node.kind).toBe("polygon");
  });

  it("returns the same document when nothing is selected", () => {
    const d0 = doc([rect("a", 0, 0)]);
    expect(flipNodes(d0, [], "h")).toBe(d0);
  });

  it("a point on the mirror axis stays put", () => {
    const d1 = flipNodes(doc([rect("a", 0, 0)]), ["a"], "h");
    const t = nodeOf(d1, "a").node.transform;
    expect(applyMat(t, { x: 10, y: 3 }).x).toBeCloseTo(10, 9);
  });
});

describe("selection frame of a mirrored object", () => {
  it("stays upright after a horizontal flip (not turned 180°)", () => {
    const d1 = flipNodes(doc([rect("a", 0, 0)]), ["a"], "h");
    expect(selectionFrame(d1, ["a"])!.angle).toBeCloseTo(0, 9);
  });

  it("a mirrored and rotated object keeps its rotation, in (−90°, 90°]", () => {
    const d1 = flipNodes(doc([rect("a", 0, 0, rotate(0.3))]), ["a"], "h");
    const a = selectionFrame(d1, ["a"])!.angle;
    expect(a).toBeGreaterThan(-Math.PI / 2);
    expect(a).toBeLessThanOrEqual(Math.PI / 2);
    expect(Math.abs(a)).toBeCloseTo(0.3, 9);
  });

  it("an unmirrored object rotated 180° keeps its 180° frame", () => {
    const d = doc([rect("a", 0, 0, rotate(Math.PI))]);
    expect(Math.abs(selectionFrame(d, ["a"])!.angle)).toBeCloseTo(Math.PI, 9);
  });
});
