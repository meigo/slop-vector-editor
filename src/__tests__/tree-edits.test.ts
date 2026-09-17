import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Layer,
  type Node,
  type PolygonShape,
  type RectShape,
} from "../doc/document";
import {
  addShape,
  convertToPath,
  deleteNodes,
  duplicateNodes,
  flattenTransform,
  rotateNodes,
  setPolygon,
  setRectRadius,
  setStyle,
  translateNodes,
} from "../doc/edits";
import {
  ancestorIds,
  findNode,
  mapNodes,
  mapShapes,
  pruneSelection,
  selectableIds,
  shapesOf,
} from "../doc/tree";
import { applyMat, IDENTITY, multiply, rotate, translate, type Mat } from "../geom/mat";
import { deepFreeze } from "./helpers";

const rect = (id: string, x = 0): RectShape => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y: 0,
  w: 10,
  h: 20,
  rx: 0,
});

const group = (id: string, children: Node[]): Group => ({
  kind: "group",
  id,
  transform: IDENTITY,
  opacity: 1,
  children,
});

function doc(layers: Partial<Layer>[], nextId = 100): Doc {
  return deepFreeze({
    ...createDoc(100, 100),
    nextId,
    layers: layers.map((l, i) => ({
      id: `L${i}`,
      name: `L${i}`,
      visible: true,
      locked: false,
      children: [],
      ...l,
    })),
  });
}

describe("tree", () => {
  const d = doc([
    { children: [rect("a"), group("g", [rect("inner")])] },
    { children: [rect("b")], locked: true },
    { children: [rect("c")], visible: false },
  ]);

  it("finds nodes at any depth", () => {
    const f = findNode(d, "g");
    expect(f?.layerIndex).toBe(0);
    expect(f?.index).toBe(1);
    expect(f?.node.id).toBe("g");
    const inner = findNode(d, "inner");
    expect(inner?.node.id).toBe("inner");
    expect(inner?.parentGroup?.id).toBe("g");
    expect(findNode(d, "nope")).toBeNull();
  });

  it("lists selectable ids", () => {
    expect([...selectableIds(d)]).toEqual(["a", "g"]);
  });

  it("prunes selections", () => {
    const sel = ["a", "g"];
    expect(pruneSelection(d, sel)).toBe(sel);
    // "inner" is kept now: it exists on a visible, unlocked layer (spec M3b §2.1).
    expect(pruneSelection(d, ["b", "a", "inner", "a", "zz"])).toEqual(["a", "inner"]);
  });

  it("maps top-level nodes and shapes with same-reference no-ops", () => {
    expect(mapNodes(d, ["a"], (n) => n)).toBe(d);
    const moved = mapNodes(d, ["a"], (n) => ({ ...n, transform: translate(1, 0) }));
    expect(moved).not.toBe(d);
    expect(moved.layers[1]).toBe(d.layers[1]);
    const g = findNode(d, "g")!.node;
    expect(mapShapes(g, (s) => s)).toBe(g);
    expect(shapesOf(g).map((s) => s.id)).toEqual(["inner"]);
  });
});

describe("edits", () => {
  it("adds a shape with a fresh id on top of the layer", () => {
    const d = doc([{ children: [rect("a")] }]);
    const r = addShape(d, "L0", rect(""));
    expect(r.id).toBe("n100");
    expect(r.doc.nextId).toBe(101);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "n100"]);
    expect(() => addShape(d, "nope", rect(""))).toThrow();
  });

  it("deletes nodes", () => {
    const d = doc([{ children: [rect("a"), rect("b")] }]);
    expect(deleteNodes(d, ["zz"])).toBe(d);
    expect(deleteNodes(d, ["a"]).layers[0].children.map((n) => n.id)).toEqual(["b"]);
  });

  it("duplicates above the original with fresh ids and an offset", () => {
    const d = doc([{ children: [rect("a"), group("g", [rect("inner")]), rect("b")] }]);
    const r = duplicateNodes(d, ["g", "a"], 10, 5);
    expect(r.ids).toEqual(["n100", "n101"]);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "n100", "g", "n101", "b"]);
    const copy = r.doc.layers[0].children[3] as Group;
    expect(copy.children[0].id).toBe("n102");
    expect(copy.transform).toEqual(translate(10, 5));
    expect(r.doc.nextId).toBe(103);
    expect(duplicateNodes(d, ["zz"], 0, 0)).toEqual({ doc: d, ids: [] });

    // Duplicating a group gives the copy and every node inside it fresh ids: no id appears
    // twice in the document, and nextId advances by the number of nodes copied (g, inner, a).
    const collectIds = (n: Node): string[] =>
      n.kind === "group" ? [n.id, ...n.children.flatMap(collectIds)] : [n.id];
    const allIds = r.doc.layers.flatMap((l) => l.children.flatMap(collectIds));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(r.doc.nextId - d.nextId).toBe(3);
  });

  it("translates and rotates matrices only", () => {
    const d = doc([{ children: [rect("a")] }]);
    expect(translateNodes(d, ["a"], 0, 0)).toBe(d);
    const t = translateNodes(d, ["a"], 3, 4).layers[0].children[0];
    expect(t.transform).toEqual(translate(3, 4));
    expect((t as RectShape).x).toBe(0);
    expect(rotateNodes(d, ["a"], 0, { x: 0, y: 0 })).toBe(d);
    const r = rotateNodes(d, ["a"], Math.PI / 2, { x: 5, y: 10 }).layers[0].children[0];
    const p = applyMat(r.transform, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(5);
  });

  it("sets style on shapes and inside groups", () => {
    const d = doc([{ children: [rect("a"), group("g", [rect("inner")])] }]);
    expect(setStyle(d, ["a"], { strokeWidth: DEFAULT_STYLE.strokeWidth })).toBe(d);
    expect(setStyle(d, ["a"], { fill: { ...DEFAULT_STYLE.fill! } })).toBe(d);
    const s = setStyle(d, ["a", "g"], { fill: null, strokeWidth: 3 });
    const [a, g] = s.layers[0].children;
    expect((a as RectShape).style.fill).toBeNull();
    expect((a as RectShape).style.strokeWidth).toBe(3);
    expect(((g as Group).children[0] as RectShape).style.strokeWidth).toBe(3);
    expect((a as RectShape).style.stroke).toEqual(DEFAULT_STYLE.stroke);
  });

  it("sets a clamped rect radius", () => {
    const d = doc([{ children: [rect("a"), group("g", [])] }]);
    expect(setRectRadius(d, ["a"], 0)).toBe(d);
    expect(setRectRadius(d, ["a"], Number.NaN)).toBe(d);
    expect((setRectRadius(d, ["a", "g"], 99).layers[0].children[0] as RectShape).rx).toBe(5);
    expect((setRectRadius(d, ["a"], -3).layers[0].children[0] as RectShape).rx).toBe(0);
  });

  it("converts rects/ellipses to paths and flattens path transforms", () => {
    const d = doc([{ children: [rect("a"), group("g", [rect("inner")])] }]);
    const conv = convertToPath(d, ["a", "g"]);
    expect(conv.layers[0].children[0].kind).toBe("path");
    expect(conv.layers[0].children[1]).toBe(d.layers[0].children[1]);
    expect(flattenTransform(conv, ["a"])).toBe(conv);
    const moved = translateNodes(conv, ["a"], 5, 0);
    const flat = flattenTransform(moved, ["a"]).layers[0].children[0];
    expect(flat.transform).toEqual(IDENTITY);
    if (flat.kind !== "path") throw new Error("expected path");
    expect(flat.subpaths[0].nodes[0].p).toEqual({ x: 5, y: 0 });
  });
});

describe("polygon edits", () => {
  const poly = (id: string, over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id,
    transform: IDENTITY,
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
  const d = (): Doc =>
    deepFreeze({
      ...createDoc(100, 100),
      layers: [
        {
          id: "L",
          name: "L",
          visible: true,
          locked: false,
          children: [poly("a"), poly("b", { star: true }), rect("r")],
        },
      ],
    });
  const get = (doc: Doc, id: string) => doc.layers[0].children.find((n) => n.id === id)!;

  it("sets sides, star and inner ratio on selected polygons only", () => {
    const doc = d();
    const out = setPolygon(doc, ["a", "b", "r"], { sides: 7.4, star: true, innerRatio: 0.3 });
    expect(get(out, "a")).toMatchObject({ sides: 7, star: true, innerRatio: 0.3 });
    expect(get(out, "b")).toMatchObject({ sides: 7, star: true, innerRatio: 0.3 });
    expect(get(out, "r")).toBe(get(doc, "r"));
  });

  it("clamps and ignores non-finite values", () => {
    const doc = d();
    expect(get(setPolygon(doc, ["a"], { sides: 1 }), "a")).toMatchObject({ sides: 3 });
    expect(get(setPolygon(doc, ["a"], { sides: 99 }), "a")).toMatchObject({ sides: 32 });
    expect(get(setPolygon(doc, ["a"], { innerRatio: 0 }), "a")).toMatchObject({ innerRatio: 0.1 });
    expect(get(setPolygon(doc, ["a"], { innerRatio: 2 }), "a")).toMatchObject({ innerRatio: 0.95 });
    expect(setPolygon(doc, ["a"], { sides: NaN, innerRatio: Infinity })).toBe(doc);
  });

  it("returns the same document when nothing changes", () => {
    const doc = d();
    expect(setPolygon(doc, ["a"], { sides: 5, star: false, innerRatio: 0.5 })).toBe(doc);
    expect(setPolygon(doc, ["r"], { sides: 8 })).toBe(doc);
    expect(setPolygon(doc, ["a"], {})).toBe(doc);
  });

  it("converts polygons to paths", () => {
    const out = convertToPath(d(), ["b"]);
    expect(get(out, "b").kind).toBe("path");
    expect(get(out, "a").kind).toBe("polygon");
  });
});

describe("nested lookup", () => {
  const leaf = (id: string, t: Mat = IDENTITY): Node => ({
    kind: "rect",
    id,
    transform: t,
    style: DEFAULT_STYLE,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rx: 0,
  });
  const grp = (id: string, t: Mat, children: Node[]): Node => ({
    kind: "group",
    id,
    transform: t,
    opacity: 1,
    children,
  });
  const nested = deepFreeze({
    ...createDoc(100, 100),
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [
          leaf("a"),
          grp("g", translate(10, 0), [leaf("b"), grp("h", translate(0, 5), [leaf("c")])]),
        ],
      },
      { id: "L1", name: "L1", visible: false, locked: false, children: [leaf("hidden")] },
    ],
  });

  it("finds a node at any depth with its parent matrix", () => {
    expect(findNode(nested, "a")?.parent).toEqual(IDENTITY);
    expect(findNode(nested, "a")?.parentGroup).toBeNull();
    const b = findNode(nested, "b");
    expect(b?.parent).toEqual(translate(10, 0));
    expect(b?.parentGroup?.id).toBe("g");
    expect(b?.path).toEqual([1, 0]);
    const c = findNode(nested, "c");
    expect(c?.parent).toEqual(translate(10, 5));
    expect(c?.parentGroup?.id).toBe("h");
    expect(c?.path).toEqual([1, 1, 0]);
    expect(findNode(nested, "gone")).toBeNull();
    expect(findNode(nested, "g")?.layerIndex).toBe(0);
  });

  it("lists the groups above a node, outermost first", () => {
    expect(ancestorIds(nested, "c")).toEqual(["g", "h"]);
    expect(ancestorIds(nested, "a")).toEqual([]);
    expect(ancestorIds(nested, "gone")).toEqual([]);
  });

  it("edits nested nodes and hands each its parent matrix", () => {
    const seen: string[] = [];
    const out = mapNodes(nested, ["c"], (n, parent) => {
      seen.push(`${n.id}:${parent.join(",")}`);
      return { ...n, name: "named" };
    });
    expect(seen).toEqual(["c:1,0,0,1,10,5"]);
    expect(findNode(out, "c")?.node.name).toBe("named");
    // Untouched branches keep their references.
    expect(out.layers[0].children[0]).toBe(nested.layers[0].children[0]);
    expect(out.layers[1]).toBe(nested.layers[1]);
    expect(mapNodes(nested, ["c"], (n) => n)).toBe(nested);
    expect(mapNodes(nested, [], (n) => n)).toBe(nested);
    expect(mapNodes(nested, ["gone"], (n) => n)).toBe(nested);
  });

  it("replaces a group without descending into it", () => {
    const seen: string[] = [];
    const out = mapNodes(nested, ["g", "b"], (n) => {
      seen.push(n.id);
      return { ...n, name: "x" };
    });
    expect(seen).toEqual(["g"]);
    expect(findNode(out, "b")?.node.name).toBeUndefined();
  });

  it("selects within the entered group, and prunes by existence at any depth", () => {
    expect([...selectableIds(nested)]).toEqual(["a", "g"]);
    expect([...selectableIds(nested, "g")]).toEqual(["b", "h"]);
    expect([...selectableIds(nested, "gone")]).toEqual(["a", "g"]);
    expect(pruneSelection(nested, ["c", "b"])).toEqual(["c", "b"]);
    expect(pruneSelection(nested, ["c", "gone", "hidden"])).toEqual(["c"]);
    const kept = ["a", "g"];
    expect(pruneSelection(nested, kept)).toBe(kept);
  });
});

describe("edits inside a group", () => {
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  };
  const leaf = (id: string, x: number): Node => ({
    kind: "rect",
    id,
    transform: IDENTITY,
    style: DEFAULT_STYLE,
    x,
    y: 0,
    w: 10,
    h: 10,
    rx: 0,
  });
  const inLayer = (children: Node[]): Doc =>
    deepFreeze({
      ...createDoc(100, 100),
      nextId: 50,
      layers: [{ id: "L0", name: "L0", visible: true, locked: false, children }],
    });
  /** A group turned a quarter-turn. */
  const turned = (children: Node[]): Node => ({
    kind: "group",
    id: "g",
    transform: rotate(Math.PI / 2),
    opacity: 1,
    children,
  });
  const worldOf = (d: Doc, id: string) => {
    const f = findNode(d, id)!;
    return applyMat(multiply(f.parent, f.node.transform), { x: 0, y: 0 });
  };

  it("moves a nested node through its parent's transform", () => {
    const d = inLayer([turned([leaf("a", 0)])]);
    close(worldOf(translateNodes(d, ["a"], 10, 0), "a"), { x: 10, y: 0 });
    expect(translateNodes(d, ["a"], 0, 0)).toBe(d);
  });

  it("rotates a nested node about a document-space centre", () => {
    const d = inLayer([turned([leaf("a", 0)])]);
    const out = rotateNodes(d, ["a"], Math.PI, { x: 0, y: 0 });
    const f = findNode(out, "a")!;
    // The child's own (1, 0) sits at (0, 1) in the document; a half-turn about the origin
    // takes it to (0, -1).
    close(applyMat(multiply(f.parent, f.node.transform), { x: 1, y: 0 }), { x: 0, y: -1 });
  });

  it("duplicates a nested node next to it, inside the same group", () => {
    const d = inLayer([turned([leaf("a", 0), leaf("b", 20)])]);
    const r = duplicateNodes(d, ["a"], 0, 0);
    const g = findNode(r.doc, "g")!.node as Group;
    expect(g.children.map((c) => c.id)).toEqual(["a", r.ids[0], "b"]);
    expect(r.ids).toHaveLength(1);
    expect(r.doc.nextId).toBe(51);
  });

  it("deletes a nested node and drops the group it empties", () => {
    const d = inLayer([turned([leaf("a", 0)]), leaf("z", 50)]);
    expect(deleteNodes(d, ["a"]).layers[0].children.map((c) => c.id)).toEqual(["z"]);
    expect(deleteNodes(d, ["nope"])).toBe(d);
  });

  it("keeps a group that still has children", () => {
    const d = inLayer([turned([leaf("a", 0), leaf("b", 20)])]);
    const g = findNode(deleteNodes(d, ["a"]), "g")!.node as Group;
    expect(g.children.map((c) => c.id)).toEqual(["b"]);
  });
});
