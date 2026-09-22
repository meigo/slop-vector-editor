import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Group, type Node } from "../doc/document";
import { groupNodes, ungroupNodes } from "../doc/group";
import { findNode } from "../doc/tree";
import { applyMat, IDENTITY, multiply, translate, type Mat } from "../geom/mat";
import { deepFreeze } from "./helpers";

const rect = (id: string, t: Mat = IDENTITY): Node => ({
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
const group = (id: string, t: Mat, children: Node[], opacity = 1): Node => ({
  kind: "group",
  id,
  transform: t,
  opacity,
  children,
});
const doc = (...layers: { id: string; children: Node[] }[]): Doc =>
  deepFreeze({
    ...createDoc(100, 100),
    nextId: 20,
    layers: layers.map((l) => ({
      id: l.id,
      name: l.id,
      visible: true,
      locked: false,
      children: l.children,
    })),
  });
const world = (d: Doc, id: string) => {
  const f = findNode(d, id)!;
  return applyMat(multiply(f.parent, f.node.transform), { x: 0, y: 0 });
};

describe("groupNodes", () => {
  it("groups two nodes where the frontmost one was", () => {
    const d = doc({ id: "L0", children: [rect("a"), rect("b"), rect("c")] });
    const r = groupNodes(d, ["a", "c"]);
    expect(r.id).toBe("n20");
    expect(d.layers[0].children.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["b", "n20"]);
    const g = findNode(r.doc, "n20")!.node as Group;
    expect(g.kind).toBe("group");
    expect(g.transform).toEqual(IDENTITY);
    expect(g.opacity).toBe(1);
    expect(g.children.map((n) => n.id)).toEqual(["a", "c"]);
    expect(r.doc.nextId).toBe(21);
  });

  it("gathers nodes from other layers and from inside a group, keeping their places", () => {
    const d = doc(
      { id: "L0", children: [rect("a", translate(3, 0))] },
      { id: "L1", children: [group("g", translate(10, 5), [rect("b"), rect("keep")])] },
    );
    const r = groupNodes(d, ["a", "b"]);
    expect(world(r.doc, "a")).toEqual({ x: 3, y: 0 });
    expect(world(r.doc, "b")).toEqual({ x: 10, y: 5 });
    expect(findNode(r.doc, r.id!)!.parentGroup?.id).toBe("g");
    expect(r.doc.layers[0].children).toHaveLength(0);
    // "b" sat at the bottom of "g", so the new group takes that place.
    expect((findNode(r.doc, "g")!.node as Group).children.map((n) => n.id)).toEqual([
      "n20",
      "keep",
    ]);
  });

  it("drops a selected node that is inside another selected node", () => {
    const d = doc({ id: "L0", children: [group("g", IDENTITY, [rect("b")]), rect("a")] });
    const r = groupNodes(d, ["g", "b", "a"]);
    const g = findNode(r.doc, r.id!)!.node as Group;
    expect(g.children.map((n) => n.id)).toEqual(["g", "a"]);
  });

  it("groups a single node, and refuses an empty or unknown selection", () => {
    const d = doc({ id: "L0", children: [rect("a")] });
    expect((findNode(groupNodes(d, ["a"]).doc, "n20")!.node as Group).children).toHaveLength(1);
    expect(groupNodes(d, []).doc).toBe(d);
    expect(groupNodes(d, []).id).toBeNull();
    expect(groupNodes(d, ["zz"]).doc).toBe(d);
  });

  it("refuses when a parent matrix is singular", () => {
    const d = doc({ id: "L0", children: [rect("a"), group("g", [0, 0, 0, 0, 0, 0], [rect("b")])] });
    const r = groupNodes(d, ["a", "b"]);
    expect(r.doc).toBe(d);
    expect(r.id).toBeNull();
  });
});

describe("ungroupNodes", () => {
  it("frees the children, keeping their places and their order", () => {
    const d = doc({
      id: "L0",
      children: [rect("z"), group("g", translate(10, 5), [rect("a"), rect("b")])],
    });
    const r = ungroupNodes(d, ["g"]);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["z", "a", "b"]);
    expect(world(r.doc, "a")).toEqual({ x: 10, y: 5 });
    expect(r.ids).toEqual(["a", "b"]);
    expect(findNode(r.doc, "g")).toBeNull();
  });

  it("folds the group's opacity into its children", () => {
    const d = doc({
      id: "L0",
      children: [
        group("g", IDENTITY, [rect("a"), group("inner", IDENTITY, [rect("c")], 0.5)], 0.5),
      ],
    });
    const r = ungroupNodes(d, ["g"]);
    const a = findNode(r.doc, "a")!.node;
    expect(a.kind === "group" ? null : a.style.opacity).toBe(0.5);
    expect((findNode(r.doc, "inner")!.node as Group).opacity).toBe(0.25);
    const c = findNode(r.doc, "c")!.node;
    expect(c.kind === "group" ? null : c.style.opacity).toBe(1);
  });

  it("ignores non-groups and an empty selection", () => {
    const d = doc({ id: "L0", children: [rect("a"), group("g", IDENTITY, [rect("b")])] });
    const r = ungroupNodes(d, ["a"]);
    expect(r.doc).toBe(d);
    expect(r.ids).toEqual(["a"]);
    expect(ungroupNodes(d, []).doc).toBe(d);
    const both = ungroupNodes(d, ["a", "g"]);
    expect(both.ids).toEqual(["a", "b"]);
  });

  it("ungroups a selected group nested in another selected group", () => {
    const d = doc({
      id: "L0",
      children: [
        group("g", translate(10, 0), [group("h", translate(0, 5), [rect("a")]), rect("b")]),
      ],
    });
    const r = ungroupNodes(d, ["g", "h"]);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "b"]);
    expect(findNode(r.doc, "h")).toBeNull();
    expect(r.ids).toEqual(["a", "b"]);
    expect(world(r.doc, "a")).toEqual({ x: 10, y: 5 });
  });
});
