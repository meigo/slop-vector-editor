import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type PathShape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { createNodeTool } from "../tools/node-tool";
import { ev, fakeContext } from "./fake-context";

const line = (id: string, x: number): PathShape => ({
  kind: "path",
  id,
  transform: IDENTITY,
  style: { ...DEFAULT_STYLE, stroke: { color: "#000000", opacity: 1 } },
  subpaths: [
    {
      closed: false,
      nodes: [
        { p: { x, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: x + 40, y: 0 }, in: null, out: null, type: "corner" },
      ],
    },
  ],
});

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 100,
  y: 0,
  w: 40,
  h: 40,
  rx: 0,
});

function doc(): Doc {
  const d = createDoc(300, 200);
  return { ...d, layers: [{ ...d.layers[0], children: [line("p", 0), rect("r")] }] };
}

describe("node tool: picking", () => {
  it("targets a path that is clicked, and selects it", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    tool.down(ctx, ev(10, 0));
    tool.up(ctx, ev(10, 0));
    expect(state.nodeTarget).toBe("p");
    expect(state.selection).toEqual(["p"]);
    expect(state.nodeSel).toEqual([]);
  });

  it("refuses a live shape with a notice", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    tool.down(ctx, ev(120, 20));
    tool.up(ctx, ev(120, 20));
    expect(state.nodeTarget).toBeNull();
    expect(state.selection).toEqual(["r"]);
    expect(state.notices).toEqual([
      "“Rectangle” is a live shape — use Convert to path to edit its nodes.",
    ]);
  });

  it("clears the selection when empty space is clicked with no target", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    state.selection = ["p"];
    tool.down(ctx, ev(250, 150));
    tool.up(ctx, ev(250, 150));
    expect(state.nodeTarget).toBeNull();
    expect(state.selection).toEqual([]);
  });

  it("keeps the target when empty space is clicked, so a marquee can start", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(250, 150));
    tool.up(ctx, ev(250, 150));
    expect(state.nodeTarget).toBe("p");
    expect(state.nodeSel).toEqual([]);
  });
});
