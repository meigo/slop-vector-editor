import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Layer, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { DOUBLE_TAP_MS, isDoubleTap } from "../input/double-tap";
import { dropTarget, type RowBox } from "../lib/layer-drop";
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
const doc = (...layers: Layer[]): Doc => deepFreeze({ ...createDoc(100, 100), layers });

describe("double tap", () => {
  it("needs the same row within the time limit", () => {
    expect(DOUBLE_TAP_MS).toBe(350);
    expect(isDoubleTap(null, { id: "a", time: 10 })).toBe(false);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "a", time: 360 })).toBe(true);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "a", time: 361 })).toBe(false);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "b", time: 20 })).toBe(false);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "a", time: 5 })).toBe(false);
  });
});

describe("drop target", () => {
  // Display order, top first: B (b2, b1) then A (a2, a1), 32px rows.
  const d = doc(layer("A", ["a1", "a2"]), layer("B", ["b1", "b2"]));
  const rows: RowBox[] = [
    { kind: "layer", id: "B", top: 0, bottom: 32 },
    { kind: "node", id: "b2", top: 32, bottom: 64 },
    { kind: "node", id: "b1", top: 64, bottom: 96 },
    { kind: "layer", id: "A", top: 96, bottom: 128 },
    { kind: "node", id: "a2", top: 128, bottom: 160 },
    { kind: "node", id: "a1", top: 160, bottom: 192 },
  ];

  it("places a dragged layer by layer-row midpoints", () => {
    expect(dropTarget(d, rows, 10, { kind: "layer", id: "A" })).toEqual({
      kind: "layer",
      index: 1,
      line: 0,
    });
    expect(dropTarget(d, rows, 150, { kind: "layer", id: "A" })).toBeNull();
    expect(dropTarget(d, rows, 190, { kind: "layer", id: "B" })).toEqual({
      kind: "layer",
      index: 0,
      line: 192,
    });
  });

  it("places dragged objects above or below a row, or on top of a layer", () => {
    const one = { kind: "node" as const, ids: ["a1"] };
    expect(dropTarget(d, rows, 40, one)).toEqual({
      kind: "node",
      parentId: "B",
      index: 2,
      line: 32,
    });
    expect(dropTarget(d, rows, 60, one)).toEqual({
      kind: "node",
      parentId: "B",
      index: 1,
      line: 64,
    });
    expect(dropTarget(d, rows, 5, one)).toEqual({
      kind: "node",
      parentId: "B",
      index: 2,
      line: 32,
    });
    expect(dropTarget(d, rows, -20, one)).toEqual({
      kind: "node",
      parentId: "B",
      index: 2,
      line: 32,
    });
    expect(dropTarget(d, rows, 130, one)).toEqual({
      kind: "node",
      parentId: "A",
      index: 1,
      line: 128,
    });
    expect(dropTarget(d, rows, 150, one)).toBeNull();
    expect(dropTarget(d, rows, 500, one)).toBeNull();
    expect(dropTarget(d, rows, 5, { kind: "node", ids: ["a1", "b1"] })).toEqual({
      kind: "node",
      parentId: "B",
      index: 1,
      line: 32,
    });
  });

  it("refuses hidden or locked target layers and empty row lists", () => {
    const locked = doc(layer("A", ["a1", "a2"]), layer("B", ["b1", "b2"], { locked: true }));
    expect(dropTarget(locked, rows, 40, { kind: "node", ids: ["a1"] })).toBeNull();
    expect(dropTarget(locked, rows, 10, { kind: "layer", id: "A" })).not.toBeNull();
    expect(dropTarget(d, [], 10, { kind: "layer", id: "A" })).toBeNull();
  });
});

describe("dropping into groups", () => {
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
  const d = deepFreeze({
    ...createDoc(100, 100),
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [
          rect("a"),
          {
            kind: "group",
            id: "g",
            transform: IDENTITY,
            opacity: 1,
            children: [rect("b")],
          } as Node,
        ],
      },
    ],
  });
  // Display order, top first: L0, g, b, a — 32px rows.
  const rows: RowBox[] = [
    { kind: "layer", id: "L0", top: 0, bottom: 32 },
    { kind: "node", id: "g", top: 32, bottom: 64 },
    { kind: "node", id: "b", top: 64, bottom: 96 },
    { kind: "node", id: "a", top: 96, bottom: 128 },
  ];

  it("drops into a group when its own row is hovered", () => {
    expect(dropTarget(d, rows, 40, { kind: "node", ids: ["a"] })).toEqual({
      kind: "node",
      parentId: "g",
      index: 1,
      line: 64,
    });
  });

  it("drops beside a child when the child's row is hovered", () => {
    expect(dropTarget(d, rows, 70, { kind: "node", ids: ["a"] })).toEqual({
      kind: "node",
      parentId: "g",
      index: 1,
      line: 64,
    });
    expect(dropTarget(d, rows, 90, { kind: "node", ids: ["a"] })).toEqual({
      kind: "node",
      parentId: "g",
      index: 0,
      line: 96,
    });
  });

  it("drops a child back out to the layer", () => {
    expect(dropTarget(d, rows, 120, { kind: "node", ids: ["b"] })).toEqual({
      kind: "node",
      parentId: "L0",
      index: 0,
      line: 128,
    });
  });

  it("refuses a group dropped into itself or its own child", () => {
    expect(dropTarget(d, rows, 40, { kind: "node", ids: ["g"] })).toBeNull();
    expect(dropTarget(d, rows, 70, { kind: "node", ids: ["g"] })).toBeNull();
  });
});
