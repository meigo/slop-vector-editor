import { describe, expect, it } from "vitest";
import { createDoc, type Doc } from "../doc/document";
import { DEFAULT_PREFS, type Prefs } from "../persist/preferences";
import { createBrushTool } from "../tools/brush-tool";
import { ev, fakeContext } from "./fake-context";

const blank = (): Doc => createDoc(200, 200);
const stroke = (
  tool = createBrushTool(),
  type = "mouse",
  press = (_i: number) => 0.5,
  prefs: Prefs = DEFAULT_PREFS,
) => {
  const { ctx, state } = fakeContext(blank(), prefs);
  tool.down(ctx, ev(10, 50, {}, type, 0, press(0)));
  for (let i = 1; i <= 40; i++) tool.move(ctx, ev(10 + i * 3, 50, {}, type, i * 8, press(i)));
  return { tool, ctx, state };
};
// The window is wider than the outline's point spacing (~4.8px for the pen stroke below), so every
// sampled x finds outline points on both walls.
const heightAt = (o: { x: number; y: number }[], x: number) =>
  Math.max(...o.filter((p) => Math.abs(p.x - x) < 3).map((p) => Math.abs(p.y - 50)));

describe("brush tool", () => {
  it("shows a live preview and commits one outline on pen-up", () => {
    const { tool, ctx, state } = stroke();
    expect(state.overlay?.kind).toBe("brush");
    expect(state.brushStrokes).toHaveLength(0);
    tool.up(ctx, ev(130, 50, {}, "mouse", 400));
    expect(state.brushStrokes).toHaveLength(1);
    expect(state.brushStrokes[0].length).toBeGreaterThan(10);
    expect(state.session.doc.layers[0].children).toHaveLength(0); // the tool never writes the doc
    // The slot is cleared, not left holding a brush overlay: a tool switch may already have run.
    expect(state.overlay).toBeNull();
  });

  it("a tap commits a dot", () => {
    const tool = createBrushTool();
    const { ctx, state } = fakeContext(blank());
    tool.down(ctx, ev(50, 50, {}, "mouse", 0));
    tool.up(ctx, ev(50, 50, {}, "mouse", 40));
    expect(state.brushStrokes).toHaveLength(1);
  });

  it("cancel and Escape discard the stroke", () => {
    const a = stroke();
    a.tool.cancel(a.ctx);
    expect(a.state.brushStrokes).toHaveLength(0);
    const b = stroke();
    expect(b.tool.busy?.()).toBe(true);
    expect(b.tool.keydown?.(b.ctx, "escape")).toBe(true);
    b.tool.up(b.ctx, ev(130, 50));
    expect(b.state.brushStrokes).toHaveLength(0);
  });

  it("discard drops a stroke in progress", () => {
    const a = stroke();
    a.tool.discard?.(a.ctx);
    a.tool.up(a.ctx, ev(130, 50));
    expect(a.state.brushStrokes).toHaveLength(0);
  });

  it("a mouse draws constant width whatever pressure it reports", () => {
    const { tool, ctx, state } = stroke(createBrushTool(), "mouse", (i) => (i < 20 ? 0.1 : 1));
    tool.up(ctx, ev(130, 50, {}, "mouse", 400, 1));
    const o = state.brushStrokes[0];
    expect(Math.abs(heightAt(o, 40) - heightAt(o, 110))).toBeLessThan(0.5);
  });

  it("a pen's pressure sets the width, and its 0-pressure lift keeps the end", () => {
    // Taper off: a taper thins both ends by itself, which would hide what pressure does.
    const noTaper = { ...DEFAULT_PREFS, brush: { ...DEFAULT_PREFS.brush, taper: false } };
    const { tool, ctx, state } = stroke(
      createBrushTool(),
      "pen",
      (i) => (i < 20 ? 0.1 : 1),
      noTaper,
    );
    tool.up(ctx, ev(130, 50, {}, "pen", 400, 0));
    const o = state.brushStrokes[0];
    expect(heightAt(o, 110)).toBeGreaterThan(heightAt(o, 40) * 2);
    expect(heightAt(o, 128)).toBeGreaterThan(heightAt(o, 40)); // no collapse at the lift
  });

  it("refuses on a locked layer at pointer-down", () => {
    const d = blank();
    const locked = { ...d, layers: d.layers.map((l) => ({ ...l, locked: true })) };
    const { ctx, state } = fakeContext(locked);
    const tool = createBrushTool();
    tool.down(ctx, ev(10, 50));
    tool.move(ctx, ev(60, 50));
    tool.up(ctx, ev(60, 50));
    expect(state.brushStrokes).toHaveLength(0);
    expect(state.notices).toHaveLength(1);
  });

  it("consumes coalesced samples", () => {
    const tool = createBrushTool();
    const { ctx, state } = fakeContext(blank());
    tool.down(ctx, ev(0, 0));
    const e = ev(100, 0, {}, "mouse", 100);
    e.samples = Array.from({ length: 10 }, (_, i) => ({
      doc: { x: (i + 1) * 10, y: (i % 2) * 20 },
      screen: { x: (i + 1) * 10, y: (i % 2) * 20 },
      pressure: 0.5,
      time: (i + 1) * 10,
    }));
    tool.move(ctx, e);
    tool.up(ctx, ev(100, 0, {}, "mouse", 120));
    const ys = state.brushStrokes[0].map((p) => p.y);
    expect(Math.max(...ys)).toBeGreaterThan(15); // the zig-zag in the samples reached the outline
  });

  it("a pan during the stroke keeps the ink under the pen", () => {
    const tool = createBrushTool();
    const { ctx, state } = fakeContext(blank());
    // The event's screen point, with its document point through the view of the moment.
    const at = (sx: number, time: number) => {
      const e = ev(sx - state.view.x, 50, {}, "mouse", time);
      e.screen = { x: sx, y: 50 };
      return e;
    };
    tool.down(ctx, at(10, 0));
    for (let i = 1; i <= 20; i++) tool.move(ctx, at(10 + i * 3, i * 8));
    state.view = { x: 100, y: 0, zoom: 1 }; // a wheel pan mid-stroke
    for (let i = 21; i <= 40; i++) tool.move(ctx, at(100 + 10 + i * 3, i * 8));
    tool.up(ctx, at(100 + 130, 400));
    const xs = state.brushStrokes[0].map((p) => p.x);
    // The pen ended at document x 130; mapped through the pointer-down view it would be 230.
    expect(Math.max(...xs)).toBeGreaterThan(125);
    expect(Math.max(...xs)).toBeLessThan(140);
  });

  it("hover shows the size cursor, radius size/2 in document px", () => {
    const tool = createBrushTool();
    const { ctx, state } = fakeContext(blank(), {
      ...DEFAULT_PREFS,
      brush: { ...DEFAULT_PREFS.brush, size: 20 },
    });
    state.view = { x: 0, y: 0, zoom: 2 };
    tool.hover?.(ctx, ev(30, 30));
    expect(state.overlay).toMatchObject({ kind: "brush", cursor: { r: 10 } });
  });
});
