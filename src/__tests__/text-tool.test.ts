import { describe, expect, it } from "vitest";
import { createDoc } from "../doc/document";
import { fakeContext } from "./fake-context";
import { createTextTool } from "../tools/text-tool";
import type { Tool } from "../tools/tool";

const ev = (x: number, y: number) => ({
  doc: { x, y },
  screen: { x, y },
  pointerType: "mouse",
  mods: { shift: false, alt: false, shiftLatched: false },
  time: 0,
});

const tap = (t: Tool, ctx: ReturnType<typeof fakeContext>["ctx"], x: number, y: number) => {
  t.down(ctx, ev(x, y));
  t.up(ctx, ev(x, y));
};

describe("the Text tool", () => {
  it("places a title on a click when none is selected", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    tap(createTextTool(), ctx, 50, 60);
    expect(state.titlesPlaced).toEqual([{ x: 50, y: 60 }]);
    expect(state.charsPicked).toEqual([]);
  });

  it("picks a character instead, inside a title already being edited", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    state.fakeTitleId = "t1";
    tap(createTextTool(), ctx, 50, 60);
    expect(state.charsPicked).toEqual([{ x: 50, y: 60 }]);
    expect(state.titlesPlaced).toEqual([]);
  });

  it("does not place a title when the click was really a drag", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    const t = createTextTool();
    t.down(ctx, ev(10, 10));
    t.move?.(ctx, ev(60, 60));
    t.up(ctx, ev(60, 60));
    expect(state.titlesPlaced).toEqual([]);
  });

  it("drags the selected character with absolute offsets from the drag's start", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    state.fakeTitleId = "t1";
    state.fakeCharSel = 2;
    state.fakeCharOffset = { dx: 3, dy: -1 };
    const t = createTextTool();
    t.down(ctx, ev(10, 10));
    t.move?.(ctx, ev(30, 14));
    t.move?.(ctx, ev(35, 20));
    t.up(ctx, ev(35, 20));
    // Each call carries the WHOLE travel, added to where the character already was — not the step
    // since the last move. Every call re-outlines, which is async, and the store drops one that
    // arrives while another is in flight; with increments those deltas were lost and the character
    // crawled at a fraction of the pointer's speed. With absolutes, a dropped call costs nothing.
    expect(state.charNudges).toEqual([
      { x: 3 + 20, y: -1 + 4 },
      { x: 3 + 25, y: -1 + 10 },
      // Again on release: `move` is not guaranteed to fire at the final position.
      { x: 3 + 25, y: -1 + 10 },
    ]);
    expect(state.titlesPlaced).toEqual([]);
    expect(state.charsPicked).toEqual([]);
  });

  it("survives a call being dropped mid-drag, because each one is absolute", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    state.fakeTitleId = "t1";
    state.fakeCharSel = 0;
    const t = createTextTool();
    t.down(ctx, ev(0, 0));
    t.move?.(ctx, ev(10, 10));
    // The browser may coalesce away every later move; the release still lands it correctly.
    t.up(ctx, ev(30, 30));
    expect(state.charNudges.at(-1)).toEqual({ x: 30, y: 30 });
  });

  it("ignores a drag smaller than the shared threshold", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    state.fakeTitleId = "t1";
    state.fakeCharSel = 0;
    const t = createTextTool();
    t.down(ctx, ev(10, 10));
    t.move?.(ctx, ev(11, 10));
    t.up(ctx, ev(11, 10));
    expect(state.charNudges).toEqual([]);
    expect(state.charsPicked).toEqual([{ x: 11, y: 10 }]);
  });
});
