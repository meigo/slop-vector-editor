import { describe, expect, it } from "vitest";
import { createDoc, type Doc, type PathShape } from "../doc/document";
import { DEFAULT_PREFS } from "../persist/preferences";
import { createPenTool } from "../tools/pen";
import { ev, fakeContext } from "./fake-context";

const blank = (): Doc => createDoc(200, 200);
const noSnap = { ...DEFAULT_PREFS, snap: false };
const paths = (d: Doc): PathShape[] =>
  d.layers.flatMap((l) => l.children).filter((n): n is PathShape => n.kind === "path");
/** A click: press and release without moving. */
const click = (
  tool: ReturnType<typeof createPenTool>,
  ctx: Parameters<typeof tool.down>[0],
  x: number,
  y: number,
  mods = {},
  time?: number,
) => {
  tool.down(ctx, ev(x, y, mods, "mouse", time));
  tool.up(ctx, ev(x, y, mods, "mouse", time));
};

describe("pen: drawing a new path", () => {
  it("draws a straight path from two clicks and finishes with Enter", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 10, 10);
    expect(paths(state.session.doc)).toHaveLength(0);
    expect(tool.busy?.()).toBe(true);
    click(tool, ctx, 50, 10);
    tool.keydown?.(ctx, "enter");
    const [p] = paths(state.session.doc);
    expect(p.subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 10 },
    ]);
    expect(p.subpaths[0].closed).toBe(false);
    expect(state.selection).toEqual([p.id]);
    expect(state.session.history.past).toHaveLength(1);
    expect(tool.busy?.()).toBe(false);
    expect(state.overlay).toBeNull();
  });

  it("pulls mirrored handles when a press drags, and Alt breaks them", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    tool.down(ctx, ev(40, 0));
    tool.move(ctx, ev(40, 20));
    tool.up(ctx, ev(40, 20));
    tool.keydown?.(ctx, "enter");
    const n = paths(state.session.doc)[0].subpaths[0].nodes[1];
    expect(n.out).toEqual({ x: 40, y: 20 });
    expect(n.in).toEqual({ x: 40, y: -20 });
    expect(n.type).toBe("symmetric");

    const second = fakeContext(blank(), noSnap);
    const t2 = createPenTool();
    click(t2, second.ctx, 0, 0);
    t2.down(second.ctx, ev(40, 0, { alt: true }));
    t2.move(second.ctx, ev(40, 20, { alt: true }));
    t2.up(second.ctx, ev(40, 20, { alt: true }));
    t2.keydown?.(second.ctx, "enter");
    const m = paths(second.state.session.doc)[0].subpaths[0].nodes[1];
    expect(m.out).toEqual({ x: 40, y: 20 });
    expect(m.in).toBeNull();
    expect(m.type).toBe("corner");
  });

  it("closes when the first node is clicked", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    click(tool, ctx, 40, 40);
    click(tool, ctx, 0, 0);
    const sp = paths(state.session.doc)[0].subpaths[0];
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(3);
    expect(tool.busy?.()).toBe(false);
  });

  it("constrains to 45° with Shift", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 6, { shift: true });
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes[1].p).toEqual({ x: 40, y: 0 });
  });

  it("removes the last node with Backspace, and discards a one-node draft", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    click(tool, ctx, 80, 0);
    tool.keydown?.(ctx, "backspace");
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes).toHaveLength(2);

    const second = fakeContext(blank(), noSnap);
    const t2 = createPenTool();
    click(t2, second.ctx, 0, 0);
    t2.keydown?.(second.ctx, "enter");
    expect(paths(second.state.session.doc)).toHaveLength(0);
    expect(second.state.session.history.past).toHaveLength(0);
  });

  it("discards the draft on Escape and finishes on a double click", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    tool.keydown?.(ctx, "escape");
    expect(paths(state.session.doc)).toHaveLength(0);
    expect(tool.busy?.()).toBe(false);
    expect(state.overlay).toBeNull();

    click(tool, ctx, 0, 0, {}, 0);
    click(tool, ctx, 40, 0, {}, 1000);
    click(tool, ctx, 40, 0, {}, 1100);
    expect(paths(state.session.doc)[0].subpaths[0].nodes).toHaveLength(2);
  });

  it("requires both timing and proximity for the second press to finish", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0, {}, 0);
    click(tool, ctx, 40, 0, {}, 100);
    // Within the double-tap time window, but far from where the last press landed: places a
    // third node instead of finishing the path.
    click(tool, ctx, 100, 0, {}, 200);
    expect(tool.busy?.()).toBe(true);
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes).toHaveLength(3);

    const second = fakeContext(blank(), noSnap);
    const t2 = createPenTool();
    click(t2, second.ctx, 0, 0, {}, 0);
    click(t2, second.ctx, 40, 0, {}, 100);
    // Within the window and at the same point as the last press: finishes.
    click(t2, second.ctx, 40, 0, {}, 200);
    expect(t2.busy?.()).toBe(false);
    expect(paths(second.state.session.doc)[0].subpaths[0].nodes).toHaveLength(2);
  });

  it("refuses a blocked layer and draws into the current one", () => {
    const d = blank();
    const locked: Doc = { ...d, layers: [{ ...d.layers[0], locked: true }] };
    const { ctx, state } = fakeContext(locked, noSnap);
    const tool = createPenTool();
    click(tool, ctx, 10, 10);
    expect(state.notices).toEqual(["“Layer 1” is locked — unlock it to draw."]);
    expect(tool.busy?.()).toBe(false);
  });

  it("shows the draft and a rubber band while hovering", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    tool.hover?.(ctx, ev(60, 20));
    expect(state.overlay?.kind).toBe("pen");
    const o = state.overlay as { knobs: unknown[]; rubber: { a: unknown; b: unknown } | null };
    expect(o.knobs).toHaveLength(2);
    expect(o.rubber).toEqual({ a: { x: 40, y: 0 }, b: { x: 60, y: 20 } });
    tool.cancel(ctx);
    expect(tool.busy?.()).toBe(true);
  });
});
