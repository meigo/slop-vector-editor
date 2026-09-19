import { describe, expect, it } from "vitest";
import { createDoc, type Doc, type Group, type Layer, type RectShape } from "../doc/document";
import { setNodeHidden, setNodeLocked } from "../doc/edits";
import { pruneSelection, selectableIds } from "../doc/tree";
import { hitTest, marqueeSelect } from "../geom/hit";

const style = {
  fill: { color: "#000000", opacity: 1 },
  stroke: null,
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
  opacity: 1,
};
const rect = (id: string, x: number): RectShape =>
  ({
    kind: "rect",
    id,
    transform: [1, 0, 0, 1, 0, 0],
    style,
    x,
    y: 0,
    w: 20,
    h: 20,
    rx: 0,
  }) as RectShape;

/** a at 0–20, b at 40–60, group g at 80 holding c (80–100) and d (120–140). */
function doc(): Doc {
  const d = createDoc(400, 400);
  const g: Group = {
    kind: "group",
    id: "g",
    transform: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    children: [rect("c", 80), rect("d", 120)],
  };
  const hiddenLayer: Layer = {
    id: "L2",
    name: "Hidden",
    visible: false,
    locked: false,
    children: [rect("z", 200)],
  };
  return {
    ...d,
    nextId: 50,
    layers: [{ ...d.layers[0], children: [rect("a", 0), rect("b", 40), g] }, hiddenLayer],
  };
}

const ids = (d: Doc, entered: string | null = null) => [...selectableIds(d, entered)].sort();

describe("reach: hidden and locked nodes", () => {
  it("drops a hidden or a locked node from what can be selected", () => {
    expect(ids(doc())).toEqual(["a", "b", "g"]);
    expect(ids(setNodeHidden(doc(), ["a"], true))).toEqual(["b", "g"]);
    expect(ids(setNodeLocked(doc(), ["b"], true))).toEqual(["a", "g"]);
  });

  it("takes a whole subtree out of reach with its group", () => {
    const hidden = setNodeHidden(doc(), ["g"], true);
    expect(ids(hidden)).toEqual(["a", "b"]);
    expect(pruneSelection(hidden, ["c"])).toEqual([]);
  });

  it("restricts a valid entered group to its unhidden, unlocked children", () => {
    expect(ids(doc(), "g")).toEqual(["c", "d"]);
    expect(ids(setNodeHidden(doc(), ["c"], true), "g")).toEqual(["d"]);
  });

  it("falls through to the top level when the entered group is hidden", () => {
    const hidden = setNodeHidden(doc(), ["g"], true);
    expect(ids(hidden, "g")).toEqual(["a", "b"]);
  });

  it("deselects a node the moment it is hidden or locked", () => {
    expect(pruneSelection(doc(), ["a", "b"])).toEqual(["a", "b"]);
    expect(pruneSelection(setNodeHidden(doc(), ["a"], true), ["a", "b"])).toEqual(["b"]);
    expect(pruneSelection(setNodeLocked(doc(), ["a"], true), ["a", "b"])).toEqual(["b"]);
  });

  it("does not hit-test a hidden or a locked shape", () => {
    expect(hitTest(doc(), { x: 10, y: 10 }, 1)?.nodeId).toBe("a");
    expect(hitTest(setNodeHidden(doc(), ["a"], true), { x: 10, y: 10 }, 1)).toBeNull();
    expect(hitTest(setNodeLocked(doc(), ["a"], true), { x: 10, y: 10 }, 1)).toBeNull();
  });

  it("still finds a sibling outside the entered group — the second tier", () => {
    expect(hitTest(doc(), { x: 90, y: 10 }, 1, "g")?.nodeId).toBe("c");
    expect(hitTest(doc(), { x: 10, y: 10 }, 1, "g")?.nodeId).toBe("a");
    expect(hitTest(setNodeHidden(doc(), ["a"], true), { x: 10, y: 10 }, 1, "g")).toBeNull();
  });

  it("leaves a hidden or locked shape out of a marquee", () => {
    const all = { x: -10, y: -10, w: 500, h: 500 };
    expect(marqueeSelect(doc(), all)).toEqual(["a", "b", "g"]);
    expect(marqueeSelect(setNodeHidden(doc(), ["b"], true), all)).toEqual(["a", "g"]);
    expect(marqueeSelect(setNodeLocked(doc(), ["b"], true), all)).toEqual(["a", "g"]);
  });
});
