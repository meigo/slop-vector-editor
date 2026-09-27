import { describe, expect, it } from "vitest";
import { booleanShapes } from "../doc/boolean-edit";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type LinearGradient,
  type Node,
  type PathShape,
  type Shape,
  type TextMeta,
} from "../doc/document";
import { flattenTransform } from "../doc/edits";
import { combine } from "../doc/path-ops";
import { resizeNodes } from "../doc/resize";
import { findNode } from "../doc/tree";
import { translate, type Mat } from "../geom/mat";

const g: LinearGradient = {
  kind: "linear",
  from: { x: 0, y: 5 },
  to: { x: 10, y: 5 },
  start: { color: "#ff0000", opacity: 1 },
  end: { color: "#0000ff", opacity: 1 },
};
const rect = (id: string, x: number, t: Mat = [1, 0, 0, 1, 0, 0]): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: { ...DEFAULT_STYLE, fill: g },
  x,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const path = (id: string, t: Mat): Node => ({
  kind: "path",
  id,
  transform: t,
  style: { ...DEFAULT_STYLE, fill: g },
  subpaths: [
    {
      closed: true,
      nodes: [0, 10].flatMap((x) =>
        [0, 10].map((y) => ({
          p: { x, y: x ? 10 - y : y },
          in: null,
          out: null,
          type: "corner" as const,
        })),
      ),
    },
  ],
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 200);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};
const fillOf = (d: Doc, id: string) =>
  (findNode(d, id)!.node as Shape).style.fill as LinearGradient;

describe("bakes map the gradient (spec M15 §5)", () => {
  it("resize scales the points with the geometry", () => {
    const out = resizeNodes(doc([rect("a", 0)]), ["a"], [2, 0, 0, 1, 0, 0]);
    expect(fillOf(out, "a").from).toEqual({ x: 0, y: 5 });
    expect(fillOf(out, "a").to).toEqual({ x: 20, y: 5 });
  });

  it("a horizontal flip mirrors the gradient", () => {
    const out = resizeNodes(doc([rect("a", 0)]), ["a"], [-1, 0, 0, 1, 10, 0]);
    expect(fillOf(out, "a").from.x).toBeCloseTo(10, 9);
    expect(fillOf(out, "a").to.x).toBeCloseTo(0, 9);
  });

  it("flatten bakes the transform into the points", () => {
    const out = flattenTransform(doc([path("p", translate(100, 0))]), ["p"]);
    expect(fillOf(out, "p").from).toEqual({ x: 100, y: 5 });
  });

  it("combine maps the front shape's gradient into the result's space", () => {
    const r = combine(doc([path("p", [1, 0, 0, 1, 0, 0]), path("q", translate(50, 0))]), [
      "p",
      "q",
    ]);
    expect(r).not.toBeNull();
    expect(fillOf(r!.doc, r!.id).from).toEqual({ x: 50, y: 5 });
  });

  it("a uniform title resize maps the gradient by the scale only, not by L", () => {
    // Regression: `bakeShape`'s title branch bakes the outlines with the scale-only matrix and
    // moves L's translation onto `transform` instead (resize.test.ts, "puts a uniform resize's
    // translation on the transform, not in the outlines"). Mapping the style with the full `L`
    // would double-count that translation.
    const meta: TextMeta = {
      text: "Hi",
      font: "anton",
      size: 100,
      letterSpacing: 4,
      lineHeight: 1.2,
      align: "left",
      seed: 7,
      amounts: { rotate: 10, scale: 0.2, offset: 6, skew: 3 },
      overrides: { 0: { r: 15, s: 1.5, dx: 8, dy: -4, k: 2 } },
    };
    const title: Node = {
      kind: "path",
      id: "t",
      transform: [1, 0, 0, 1, 0, 0],
      style: { ...DEFAULT_STYLE, fill: { ...g, from: { x: 0, y: 10 }, to: { x: 10, y: 10 } } },
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" as const },
            { p: { x: 10, y: 10 }, in: null, out: null, type: "corner" as const },
          ],
        },
      ],
      text: meta,
    };
    const out = resizeNodes(doc([title]), ["t"], [2, 0, 0, 2, 5, 9]);
    const node = findNode(out, "t")!.node as PathShape;
    expect(node.text).toBeDefined();
    expect(node.transform).toEqual([1, 0, 0, 1, 5, 9]);
    expect(fillOf(out, "t").from).toEqual({ x: 0, y: 20 });
    expect(fillOf(out, "t").to).toEqual({ x: 20, y: 20 });
  });

  it("a boolean maps the surviving style's gradient into the result's space", async () => {
    // b is frontmost, at document x 5…15 overlapping a; its gradient's own-space from (0, 5) must
    // come back as (5, 5) in the result's identity space.
    const out = await booleanShapes(
      doc([rect("a", 0), rect("b", 0, translate(5, 0))]),
      ["a", "b"],
      "unite",
    );
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(fillOf(out.doc, out.id).from).toEqual({ x: 5, y: 5 });
  });
});
