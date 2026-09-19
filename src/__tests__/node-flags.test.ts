import { describe, expect, it } from "vitest";
import { createDoc, isHidden, isLocked, type Doc, type RectShape } from "../doc/document";
import { setNodeHidden, setNodeLocked } from "../doc/edits";
import { findNode } from "../doc/tree";
import { deepFreeze } from "./helpers";

const rect = (id: string, x: number): RectShape => ({
  kind: "rect",
  id,
  transform: [1, 0, 0, 1, 0, 0],
  style: { fill: null, stroke: null, strokeWidth: 1, cap: "butt", join: "miter", opacity: 1 },
  x,
  y: 0,
  w: 40,
  h: 40,
  rx: 0,
});

function twoRects(): Doc {
  const d = createDoc(200, 200);
  return deepFreeze({
    ...d,
    nextId: 10,
    layers: [{ ...d.layers[0], children: [rect("a", 0), rect("b", 60)] }],
  });
}

const nodeOf = (d: Doc, id: string) => findNode(d, id)!.node;

describe("node flags", () => {
  it("hides and shows, and a no-op keeps the same document", () => {
    const d = twoRects();
    const hidden = setNodeHidden(d, ["a"], true);
    expect(isHidden(nodeOf(hidden, "a"))).toBe(true);
    expect(isHidden(nodeOf(hidden, "b"))).toBe(false);
    expect(setNodeHidden(hidden, ["a"], true)).toBe(hidden);
    expect(setNodeHidden(d, ["a"], false)).toBe(d);
  });

  it("deletes the key when turning a flag off, so the node is as it never was", () => {
    const d = twoRects();
    const shown = setNodeHidden(setNodeHidden(d, ["a"], true), ["a"], false);
    expect("hidden" in nodeOf(shown, "a")).toBe(false);
    expect(JSON.stringify(shown)).toBe(JSON.stringify(d));
  });

  it("locks several at once and leaves the rest alone", () => {
    const d = twoRects();
    const locked = setNodeLocked(d, ["a", "b"], true);
    expect(isLocked(nodeOf(locked, "a"))).toBe(true);
    expect(isLocked(nodeOf(locked, "b"))).toBe(true);
    expect(setNodeLocked(locked, [], true)).toBe(locked);
  });

  it("the two flags are independent", () => {
    const d = setNodeLocked(setNodeHidden(twoRects(), ["a"], true), ["a"], true);
    expect(isHidden(nodeOf(d, "a"))).toBe(true);
    expect(isLocked(nodeOf(d, "a"))).toBe(true);
    const shown = setNodeHidden(d, ["a"], false);
    expect(isLocked(nodeOf(shown, "a"))).toBe(true);
  });
});
