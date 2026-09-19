import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type Style } from "../doc/document";
import { booleanShapes } from "../doc/boolean-edit";
import { IDENTITY, translate } from "../geom/mat";
import { findNode } from "../doc/tree";

const paint = (c: string): Style => ({ ...DEFAULT_STYLE, fill: { color: c, opacity: 1 } });
const rect = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style = DEFAULT_STYLE,
  t = IDENTITY,
): Node => ({
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
const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 200);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};

describe("booleanShapes", () => {
  it("replaces the inputs with one path in the frontmost's place", async () => {
    const d = doc([
      rect("a", 0, 0, 60, 60, paint("#111111")),
      rect("b", 40, 40, 60, 60, paint("#222222")),
    ]);
    const out = await booleanShapes(d, ["a", "b"], "unite");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const kids = out.doc.layers[0].children;
    expect(kids).toHaveLength(1);
    expect(kids[0].kind).toBe("path");
    // The frontmost input keeps its id and place, and its style wins.
    expect(kids[0].id).toBe("b");
    expect(kids[0].kind === "path" && kids[0].style.fill?.color).toBe("#222222");
  });

  it("subtracts the front from the back and keeps the back's style", async () => {
    const d = doc([
      rect("back", 0, 0, 100, 100, paint("#aaaaaa")),
      rect("front", 40, 40, 20, 20, paint("#bbbbbb")),
    ]);
    const out = await booleanShapes(d, ["back", "front"], "subtract");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const p = out.doc.layers[0].children[0];
    // A hole: the outer ring plus the cut-out.
    expect(p.kind === "path" && p.subpaths).toHaveLength(2);
    expect(p.kind === "path" && p.style.fill?.color).toBe("#aaaaaa");
  });

  it("works in document space when the inputs carry transforms", async () => {
    // Identical rects, one placed by its own transform: they must overlap after mapping.
    const d = doc([
      rect("a", 0, 0, 60, 60),
      rect("b", 0, 0, 60, 60, DEFAULT_STYLE, translate(40, 40)),
    ]);
    const out = await booleanShapes(d, ["a", "b"], "intersect");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const p = out.doc.layers[0].children[0];
    expect(p.kind === "path" && p.transform).toEqual(IDENTITY);
    const xs = p.kind === "path" ? p.subpaths[0].nodes.map((n) => n.p.x) : [];
    expect(Math.min(...xs)).toBeCloseTo(40, 6);
    expect(Math.max(...xs)).toBeCloseTo(60, 6);
  });

  it("refuses fewer than two, a group, and an open path", async () => {
    const d = doc([rect("a", 0, 0, 10, 10)]);
    expect(await booleanShapes(d, ["a"], "unite")).toEqual({ kind: "refused", why: "few" });
    const g = doc([
      rect("a", 0, 0, 10, 10),
      {
        kind: "group",
        id: "g",
        transform: IDENTITY,
        opacity: 1,
        children: [rect("c", 0, 0, 5, 5)],
      },
    ]);
    expect(await booleanShapes(g, ["a", "g"], "unite")).toEqual({ kind: "refused", why: "group" });
    const open = doc([
      rect("a", 0, 0, 10, 10),
      {
        kind: "path",
        id: "p",
        transform: IDENTITY,
        style: DEFAULT_STYLE,
        subpaths: [
          {
            closed: false,
            nodes: [
              { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
              { p: { x: 9, y: 9 }, in: null, out: null, type: "corner" },
            ],
          },
        ],
      },
    ]);
    expect(await booleanShapes(open, ["a", "p"], "unite")).toEqual({
      kind: "refused",
      why: "open",
    });
  });

  it("leaves the document alone when nothing is left", async () => {
    const d = doc([rect("a", 0, 0, 10, 10), rect("b", 50, 50, 10, 10)]);
    expect(await booleanShapes(d, ["a", "b"], "intersect")).toEqual({ kind: "empty" });
  });

  it("converts a rect and an ellipse before combining", async () => {
    const d = doc([
      rect("a", 0, 0, 60, 60),
      {
        kind: "ellipse",
        id: "e",
        transform: IDENTITY,
        style: DEFAULT_STYLE,
        cx: 60,
        cy: 30,
        rx: 25,
        ry: 25,
      },
    ]);
    const out = await booleanShapes(d, ["a", "e"], "unite");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const p = out.doc.layers[0].children[0];
    expect(p.kind).toBe("path");
    expect(p.kind === "path" && p.subpaths[0].nodes.some((n) => n.in !== null)).toBe(true);
  });

  it("keeps the result inside the group the frontmost input was in", async () => {
    const d = doc([
      {
        kind: "group",
        id: "g",
        transform: translate(100, 0),
        opacity: 1,
        children: [rect("a", 0, 0, 60, 60), rect("b", 40, 40, 60, 60)],
      },
    ]);
    const out = await booleanShapes(d, ["a", "b"], "unite");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const g = out.doc.layers[0].children[0];
    expect(g.kind === "group" && g.children).toHaveLength(1);
    // Expressed in the group's space, so it renders where the originals were.
    const inner = findNode(out.doc, "b");
    const xs =
      inner && inner.node.kind === "path" ? inner.node.subpaths[0].nodes.map((n) => n.p.x) : [];
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
  });
});
