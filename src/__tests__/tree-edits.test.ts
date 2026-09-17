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
  findTopLevel,
  mapShapes,
  mapTopLevel,
  pruneSelection,
  selectableIds,
  shapesOf,
} from "../doc/tree";
import { applyMat, IDENTITY, translate } from "../geom/mat";
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

  it("finds top-level nodes only", () => {
    const f = findTopLevel(d, "g");
    expect(f?.layerIndex).toBe(0);
    expect(f?.index).toBe(1);
    expect(f?.node.id).toBe("g");
    expect(findTopLevel(d, "inner")).toBeNull();
  });

  it("lists selectable ids", () => {
    expect([...selectableIds(d)]).toEqual(["a", "g"]);
  });

  it("prunes selections", () => {
    const sel = ["a", "g"];
    expect(pruneSelection(d, sel)).toBe(sel);
    expect(pruneSelection(d, ["b", "a", "inner", "a", "zz"])).toEqual(["a"]);
  });

  it("maps top-level nodes and shapes with same-reference no-ops", () => {
    expect(mapTopLevel(d, ["a"], (n) => n)).toBe(d);
    const moved = mapTopLevel(d, ["a"], (n) => ({ ...n, transform: translate(1, 0) }));
    expect(moved).not.toBe(d);
    expect(moved.layers[1]).toBe(d.layers[1]);
    const g = findTopLevel(d, "g")!.node;
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
