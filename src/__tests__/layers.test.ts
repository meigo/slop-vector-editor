import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Layer, type Node } from "../doc/document";
import {
  addLayer,
  blockMessage,
  bringForward,
  bringToFront,
  deleteLayer,
  layerBlock,
  moveLayer,
  moveNodes,
  renameLayer,
  renameNode,
  resolveLayerId,
  rowLabel,
  sendBackward,
  sendToBack,
  setLayerLocked,
  setLayerVisible,
} from "../doc/layers";
import { IDENTITY } from "../geom/mat";
import { deepFreeze } from "./helpers";

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const layer = (id: string, childIds: string[], over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  children: childIds.map(rect),
  ...over,
});
const doc = (...layers: Layer[]): Doc => deepFreeze({ ...createDoc(100, 100), nextId: 20, layers });
const ids = (d: Doc, i: number) => d.layers[i].children.map((n) => n.id);
const layerIds = (d: Doc) => d.layers.map((l) => l.id);

describe("current layer helpers", () => {
  it("resolves to an existing layer or the top-most one", () => {
    const d = doc(layer("A", []), layer("B", []));
    expect(resolveLayerId(d, "A")).toBe("A");
    expect(resolveLayerId(d, "gone")).toBe("B");
    expect(resolveLayerId(d, null)).toBe("B");
  });

  it("reports why a layer can't take new objects", () => {
    const d = doc(
      layer("A", []),
      layer("H", [], { name: "Sketch", visible: false, locked: true }),
      layer("K", [], { locked: true }),
    );
    expect(layerBlock(d, "A")).toBeNull();
    expect(layerBlock(d, "H")).toEqual({ name: "Sketch", reason: "hidden" });
    expect(layerBlock(d, "K")).toEqual({ name: "K", reason: "locked" });
    expect(blockMessage({ name: "Sketch", reason: "hidden" }, "draw")).toBe(
      `"Sketch" is hidden — show it to draw.`,
    );
    expect(blockMessage({ name: "K", reason: "locked" }, "paste")).toBe(
      `"K" is locked — unlock it to paste.`,
    );
  });
});

describe("layer edits", () => {
  it("adds a numbered layer above another, or on top", () => {
    const d = doc(
      layer("A", [], { name: "Layer 1" }),
      layer("B", [], { name: "Layer 7" }),
      layer("C", [], { name: "Ink" }),
    );
    const r = addLayer(d, "A");
    expect(r.id).toBe("n20");
    expect(layerIds(r.doc)).toEqual(["A", "n20", "B", "C"]);
    expect(r.doc.layers[1]).toEqual({
      id: "n20",
      name: "Layer 8",
      visible: true,
      locked: false,
      children: [],
    });
    expect(r.doc.nextId).toBe(21);
    expect(layerIds(addLayer(d, null).doc)).toEqual(["A", "B", "C", "n20"]);
    expect(layerIds(addLayer(d, "zz").doc)).toEqual(["A", "B", "C", "n20"]);
    expect(addLayer(doc(layer("X", [], { name: "Ink" })), null).doc.layers[1].name).toBe("Layer 1");
  });

  it("deletes a layer but never the last one", () => {
    const d = doc(layer("A", ["a"]), layer("B", []));
    expect(layerIds(deleteLayer(d, "A"))).toEqual(["B"]);
    expect(deleteLayer(d, "zz")).toBe(d);
    const one = doc(layer("A", []));
    expect(deleteLayer(one, "A")).toBe(one);
  });

  it("renames with trimming and a length cap", () => {
    const d = doc(layer("A", []));
    expect(renameLayer(d, "A", "  Ink  ").layers[0].name).toBe("Ink");
    expect(renameLayer(d, "A", "x".repeat(150)).layers[0].name).toHaveLength(100);
    expect(renameLayer(d, "A", "   ")).toBe(d);
    expect(renameLayer(d, "A", "A")).toBe(d);
    expect(renameLayer(d, "zz", "Ink")).toBe(d);
  });

  it("shows, hides, locks and unlocks", () => {
    const d = doc(layer("A", []));
    expect(setLayerVisible(d, "A", false).layers[0].visible).toBe(false);
    expect(setLayerVisible(d, "A", true)).toBe(d);
    expect(setLayerLocked(d, "A", true).layers[0].locked).toBe(true);
    expect(setLayerLocked(d, "A", false)).toBe(d);
    expect(setLayerLocked(d, "zz", true)).toBe(d);
  });

  it("moves a layer to a clamped index", () => {
    const d = doc(layer("A", []), layer("B", []), layer("C", []));
    expect(layerIds(moveLayer(d, "A", 2))).toEqual(["B", "C", "A"]);
    expect(layerIds(moveLayer(d, "C", -5))).toEqual(["C", "A", "B"]);
    expect(moveLayer(d, "B", 1)).toBe(d);
    expect(moveLayer(d, "zz", 0)).toBe(d);
  });
});

describe("moving and naming objects", () => {
  it("moves nodes within and between layers, keeping document order", () => {
    const d = doc(layer("A", ["a1", "a2", "a3"]), layer("B", ["b1", "b2"]));
    expect(ids(moveNodes(d, ["a1"], "A", 2), 0)).toEqual(["a2", "a3", "a1"]);
    const across = moveNodes(d, ["b2", "a1", "a3"], "B", 1);
    expect(ids(across, 0)).toEqual(["a2"]);
    expect(ids(across, 1)).toEqual(["b1", "a1", "a3", "b2"]);
    expect(ids(moveNodes(d, ["a1"], "B", 99), 1)).toEqual(["b1", "b2", "a1"]);
    expect(moveNodes(d, ["a2"], "A", 1)).toBe(d);
    expect(moveNodes(d, ["zz"], "B", 0)).toBe(d);
    expect(moveNodes(d, ["a1"], "zz", 0)).toBe(d);
  });

  it("renames objects and falls back to the default label", () => {
    const d = doc(layer("A", ["a"]));
    const named = renameNode(d, "a", "  Logo ");
    expect(named.layers[0].children[0].name).toBe("Logo");
    expect(rowLabel(named.layers[0].children[0])).toBe("Logo");
    const cleared = renameNode(named, "a", "");
    expect("name" in cleared.layers[0].children[0]).toBe(false);
    expect(rowLabel(cleared.layers[0].children[0])).toBe("Rectangle");
    expect(renameNode(d, "a", "")).toBe(d);
    expect(renameNode(named, "a", "Logo")).toBe(named);
  });

  it("labels every kind", () => {
    const base = { id: "x", transform: IDENTITY, style: DEFAULT_STYLE };
    expect(rowLabel({ ...base, kind: "ellipse", cx: 0, cy: 0, rx: 1, ry: 1 })).toBe("Ellipse");
    const poly = {
      ...base,
      kind: "polygon" as const,
      cx: 0,
      cy: 0,
      rx: 1,
      ry: 1,
      sides: 5,
      innerRatio: 0.5,
    };
    expect(rowLabel({ ...poly, star: false })).toBe("Polygon");
    expect(rowLabel({ ...poly, star: true })).toBe("Star");
    expect(rowLabel({ ...base, kind: "path", subpaths: [] })).toBe("Path");
    expect(
      rowLabel({ kind: "group", id: "g", transform: IDENTITY, opacity: 1, children: [] }),
    ).toBe("Group");
  });
});

describe("z-order", () => {
  const d = doc(layer("A", ["a", "s1", "s2", "b"]), layer("B", ["c", "t"]));

  it("brings forward one step, moving a block together", () => {
    expect(ids(bringForward(d, ["s1", "s2"]), 0)).toEqual(["a", "b", "s1", "s2"]);
    expect(ids(bringForward(d, ["a", "s2"]), 0)).toEqual(["s1", "a", "b", "s2"]);
  });

  it("sends backward one step", () => {
    expect(ids(sendBackward(d, ["s1", "s2"]), 0)).toEqual(["s1", "s2", "a", "b"]);
    expect(ids(sendBackward(d, ["b"]), 0)).toEqual(["a", "s1", "b", "s2"]);
  });

  it("brings to front and sends to back, keeping relative order", () => {
    expect(ids(bringToFront(d, ["a", "s1"]), 0)).toEqual(["s2", "b", "a", "s1"]);
    expect(ids(sendToBack(d, ["b", "s2"]), 0)).toEqual(["s2", "b", "a", "s1"]);
  });

  it("works per layer and returns the same document when nothing moves", () => {
    const r = bringForward(d, ["a", "c"]);
    expect(ids(r, 0)).toEqual(["s1", "a", "s2", "b"]);
    expect(ids(r, 1)).toEqual(["t", "c"]);
    expect(bringForward(d, ["b"])).toBe(d);
    expect(bringToFront(d, ["t"])).toBe(d);
    expect(sendBackward(d, ["a"])).toBe(d);
    expect(sendToBack(d, ["c"])).toBe(d);
    expect(bringForward(d, [])).toBe(d);
  });
});
