import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Node,
  type RectShape,
} from "../doc/document";
import { filterToSelection } from "../doc/subset";

const I: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

const rect = (id: string): RectShape => ({
  kind: "rect",
  id,
  transform: I,
  style: DEFAULT_STYLE,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});

const group = (id: string, children: Node[], transform = I): Group => ({
  kind: "group",
  id,
  transform,
  opacity: 1,
  children,
});

const docWith = (children: Node[]): Doc => {
  const base = createDoc(100, 100);
  return { ...base, layers: [{ ...base.layers[0], children }] };
};

describe("filterToSelection", () => {
  it("keeps a selected node and drops its unselected siblings", () => {
    const out = filterToSelection(docWith([rect("a"), rect("b"), rect("c")]), ["b"]);
    expect(out.layers[0].children.map((n) => n.id)).toEqual(["b"]);
  });

  it("keeps a selected group whole, with every child", () => {
    const out = filterToSelection(docWith([group("g", [rect("x"), rect("y")])]), ["g"]);
    const g = out.layers[0].children[0] as Group;
    expect(g.children.map((n) => n.id)).toEqual(["x", "y"]);
  });

  it("keeps an ancestor group pruned to the selected descendant, with its transform", () => {
    const moved = group("g", [rect("x"), rect("y")], [1, 0, 0, 1, 50, 0]);
    const out = filterToSelection(docWith([moved]), ["x"]);
    const g = out.layers[0].children[0] as Group;
    expect(g.id).toBe("g");
    expect(g.transform).toEqual([1, 0, 0, 1, 50, 0]);
    expect(g.children.map((n) => n.id)).toEqual(["x"]);
  });

  it("prunes at any depth", () => {
    const deep = group("outer", [group("inner", [rect("x"), rect("y")]), rect("z")]);
    const out = filterToSelection(docWith([deep]), ["y"]);
    const outer = out.layers[0].children[0] as Group;
    const inner = outer.children[0] as Group;
    expect(outer.children).toHaveLength(1);
    expect(inner.children.map((n) => n.id)).toEqual(["y"]);
  });

  it("drops a group that would be left empty", () => {
    const out = filterToSelection(docWith([group("g", [rect("x")]), rect("b")]), ["b"]);
    expect(out.layers[0].children.map((n) => n.id)).toEqual(["b"]);
  });

  it("drops a layer that would be left empty", () => {
    const base = createDoc(100, 100);
    const two: Doc = {
      ...base,
      layers: [
        { ...base.layers[0], id: "L1", children: [rect("a")] },
        { ...base.layers[0], id: "L2", children: [rect("b")] },
      ],
    };
    const out = filterToSelection(two, ["b"]);
    expect(out.layers.map((l) => l.id)).toEqual(["L2"]);
  });

  it("keeps the artboard, so the caller can still decide about the background", () => {
    const doc = docWith([rect("a")]);
    expect(filterToSelection(doc, ["a"]).artboard).toEqual(doc.artboard);
  });

  it("returns an equal document when everything is selected", () => {
    const doc = docWith([rect("a"), group("g", [rect("x")])]);
    expect(filterToSelection(doc, ["a", "g"])).toEqual(doc);
  });

  it("returns a document with no layers when nothing is selected", () => {
    expect(filterToSelection(docWith([rect("a")]), []).layers).toEqual([]);
  });
});
