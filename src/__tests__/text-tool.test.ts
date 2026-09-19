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

  it("drags the selected character, by the document delta, in one gesture", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    state.fakeTitleId = "t1";
    state.fakeCharSel = 2;
    const t = createTextTool();
    t.down(ctx, ev(10, 10));
    t.move?.(ctx, ev(30, 14));
    t.move?.(ctx, ev(35, 20));
    t.up(ctx, ev(35, 20));
    expect(state.charNudges).toEqual([
      { x: 20, y: 4 },
      { x: 5, y: 6 },
    ]);
    // A drag never also places a title or re-picks a character.
    expect(state.titlesPlaced).toEqual([]);
    expect(state.charsPicked).toEqual([]);
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
