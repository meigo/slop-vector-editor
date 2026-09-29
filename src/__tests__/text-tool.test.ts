import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type PathShape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { ev, fakeContext } from "./fake-context";
import { createTextTool } from "../tools/text-tool";
import type { Tool } from "../tools/tool";

type Ctx = ReturnType<typeof fakeContext>["ctx"];

const tap = (t: Tool, ctx: Ctx, x: number, y: number, mods = {}, time?: number) => {
  t.down(ctx, ev(x, y, mods, "mouse", time));
  t.up(ctx, ev(x, y, mods, "mouse", time));
};

/** A title "t" drawn as a line from (0, 50) to (100, 50) — enough for `hitTest`. */
const titleShape = (id: string, text: string, y = 50): PathShape => ({
  kind: "path",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  subpaths: [
    {
      closed: false,
      nodes: [
        { p: { x: 0, y }, in: null, out: null, type: "corner" },
        { p: { x: 100, y }, in: null, out: null, type: "corner" },
      ],
    },
  ],
  text: {
    text,
    font: "anton",
    size: 50,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: "left",
    seed: 1,
    amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
    overrides: {},
  },
});

const titleDoc = (text = "Tallinn"): Doc => {
  const d = createDoc(400, 400);
  return {
    ...d,
    layers: [{ ...d.layers[0], children: [titleShape("t", text), titleShape("u", "Other", 150)] }],
  };
};

/** Editing title "t" with the caret at `i`. */
const editing = (text = "Tallinn", i = 1) => {
  const f = fakeContext(titleDoc(text));
  f.state.selection = ["t"];
  f.state.fakeTextEdit = { id: "t", anchor: i, focus: i };
  return f;
};

const selects = (s: ReturnType<typeof fakeContext>["state"]) =>
  s.textEdits.filter((e) => e.op === "select");

describe("the Text tool: placing", () => {
  it("places a title on a click on empty canvas when not editing", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    tap(createTextTool(), ctx, 300, 300);
    expect(state.titlesPlaced).toEqual([{ x: 300, y: 300 }]);
    expect(state.textEdits).toEqual([]);
  });

  it("does not place a title when the click was really a drag", () => {
    const { ctx, state } = fakeContext(createDoc(400, 400));
    const t = createTextTool();
    t.down(ctx, ev(10, 10));
    t.move(ctx, ev(60, 60));
    t.up(ctx, ev(60, 60));
    expect(state.titlesPlaced).toEqual([]);
  });

  it("a press on empty canvas while editing ends editing and places nothing", () => {
    const { ctx, state } = editing();
    tap(createTextTool(), ctx, 300, 300);
    expect(state.textEdits).toEqual([{ op: "end" }]);
    expect(state.titlesPlaced).toEqual([]);
  });
});

describe("the Text tool: entering and driving an edit", () => {
  it("a click on a title enters editing with the caret at the pressed index", () => {
    const { ctx, state } = fakeContext(titleDoc());
    state.fakeIndexAt = () => 3;
    tap(createTextTool(), ctx, 50, 50);
    expect(state.textEdits[0]).toEqual({ op: "begin", id: "t", at: { x: 50, y: 50 } });
    expect(state.fakeTextEdit).toEqual({ id: "t", anchor: 3, focus: 3 });
    expect(state.titlesPlaced).toEqual([]);
  });

  it("a click on another title while editing enters that one", () => {
    const { ctx, state } = editing();
    tap(createTextTool(), ctx, 50, 150);
    expect(state.textEdits).toEqual([{ op: "begin", id: "u", at: { x: 50, y: 150 } }]);
  });

  it("a click inside the edited title puts the caret at the index", () => {
    const { ctx, state } = editing("Tallinn", 1);
    state.fakeIndexAt = () => 4;
    tap(createTextTool(), ctx, 50, 50);
    expect(state.textEdits).toEqual([{ op: "select", anchor: 4, focus: 4 }]);
  });

  it("Shift-click extends from the anchor", () => {
    const { ctx, state } = editing("Tallinn", 1);
    state.fakeIndexAt = () => 4;
    tap(createTextTool(), ctx, 50, 50, { shift: true });
    expect(state.textEdits).toEqual([{ op: "select", anchor: 1, focus: 4 }]);
  });

  it("a drag selects from the press index to the pointer", () => {
    const { ctx, state } = editing("Tallinn", 0);
    state.fakeIndexAt = (p) => Math.round(p.x / 10);
    const t = createTextTool();
    t.down(ctx, ev(20, 50));
    t.move(ctx, ev(40, 50));
    t.move(ctx, ev(60, 50));
    t.up(ctx, ev(60, 50));
    expect(selects(state)[0]).toEqual({ op: "select", anchor: 2, focus: 2 });
    expect(selects(state).at(-1)).toEqual({ op: "select", anchor: 2, focus: 6 });
    expect(state.fakeTextEdit).toEqual({ id: "t", anchor: 2, focus: 6 });
    expect(state.charNudges).toEqual([]);
  });

  it("a drag that starts on a title not yet edited selects from the press", () => {
    const { ctx, state } = fakeContext(titleDoc());
    state.fakeIndexAt = (p) => Math.round(p.x / 10);
    const t = createTextTool();
    t.down(ctx, ev(20, 50));
    t.move(ctx, ev(50, 50));
    t.up(ctx, ev(50, 50));
    expect(state.fakeTextEdit).toEqual({ id: "t", anchor: 2, focus: 5 });
  });

  it("a double tap on the edited title selects the word", () => {
    const { ctx, state } = fakeContext(titleDoc("ab cd"));
    state.fakeIndexAt = () => 4;
    const t = createTextTool();
    tap(t, ctx, 50, 50, {}, 0);
    tap(t, ctx, 50, 50, {}, 100);
    expect(state.textEdits).toEqual([
      { op: "begin", id: "t", at: { x: 50, y: 50 } },
      { op: "select", anchor: 3, focus: 5 },
    ]);
  });

  it("indices are code points (Review Focus 1): 'a😀b' at index 2 records 2", () => {
    const { ctx, state } = editing("a😀b", 0);
    state.fakeIndexAt = () => 2;
    tap(createTextTool(), ctx, 50, 50);
    expect(state.textEdits).toEqual([{ op: "select", anchor: 2, focus: 2 }]);
    expect(state.fakeTextEdit).toEqual({ id: "t", anchor: 2, focus: 2 });
  });

  it("Escape ends editing; busy() reports the session", () => {
    const { ctx, state } = editing();
    const t = createTextTool();
    t.activate?.(ctx);
    expect(t.busy?.()).toBe(true);
    expect(t.keydown?.(ctx, "escape")).toBe(true);
    expect(state.textEdits).toEqual([{ op: "end" }]);
    expect(t.busy?.()).toBe(false);
    expect(t.keydown?.(ctx, "escape")).toBe(false);
  });

  it("declines Enter and Backspace, which belong to the text field", () => {
    const { ctx } = editing();
    const t = createTextTool();
    expect(t.keydown?.(ctx, "enter")).toBe(false);
    expect(t.keydown?.(ctx, "backspace")).toBe(false);
  });
});

describe("the Text tool: dragging the selected character", () => {
  /** Editing with character 2 selected, and the press on it. */
  const onChar = () => {
    const f = editing("Tallinn", 2);
    f.state.fakeTextEdit = { id: "t", anchor: 2, focus: 3 };
    f.state.fakeCharSel = 2;
    f.state.fakeCharAt = () => 2;
    return f;
  };

  it("drags the selected character with absolute offsets from the drag's start", () => {
    const { ctx, state } = onChar();
    state.fakeCharOffset = { dx: 3, dy: -1 };
    const t = createTextTool();
    t.down(ctx, ev(10, 50));
    t.move(ctx, ev(30, 54));
    t.move(ctx, ev(35, 60));
    t.up(ctx, ev(35, 60));
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
    expect(state.textEdits).toEqual([]);
    expect(state.titlesPlaced).toEqual([]);
  });

  it("survives a call being dropped mid-drag, because each one is absolute", () => {
    const { ctx, state } = onChar();
    const t = createTextTool();
    t.down(ctx, ev(0, 50));
    t.move(ctx, ev(10, 60));
    // The browser may coalesce away every later move; the release still lands it correctly.
    t.up(ctx, ev(30, 80));
    expect(state.charNudges.at(-1)).toEqual({ x: 30, y: 30 });
  });

  it("a click on the selected character that never dragged puts the caret there", () => {
    const { ctx, state } = onChar();
    state.fakeIndexAt = () => 3;
    const t = createTextTool();
    t.down(ctx, ev(10, 50));
    t.move(ctx, ev(11, 50));
    t.up(ctx, ev(11, 50));
    expect(state.charNudges).toEqual([]);
    expect(state.textEdits).toEqual([{ op: "select", anchor: 3, focus: 3 }]);
  });

  it("a press on another character of the title selects text instead of dragging", () => {
    const { ctx, state } = onChar();
    state.fakeCharAt = () => 5;
    state.fakeIndexAt = (p) => Math.round(p.x / 10);
    const t = createTextTool();
    t.down(ctx, ev(50, 50));
    t.move(ctx, ev(70, 50));
    t.up(ctx, ev(70, 50));
    expect(state.charNudges).toEqual([]);
    expect(state.fakeTextEdit).toEqual({ id: "t", anchor: 5, focus: 7 });
  });
});

describe("the Text tool: a title inside a group", () => {
  /** Title "t" inside group "g", which has not been entered: `hitTest` answers "g". */
  const grouped = () => {
    const d = createDoc(400, 400);
    const g = {
      kind: "group" as const,
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [titleShape("t", "Tallinn"), titleShape("u", "Other", 150)],
    };
    return fakeContext({ ...d, layers: [{ ...d.layers[0], children: [g] }] });
  };

  it("a click on the selected title edits it rather than placing a new one", () => {
    const { ctx, state } = grouped();
    state.selection = ["t"];
    tap(createTextTool(), ctx, 50, 50);
    expect(state.titlesPlaced).toEqual([]);
    expect(state.textEdits[0]).toEqual({ op: "begin", id: "t", at: { x: 50, y: 50 } });
  });

  it("a click outside the selected title still hits only the group", () => {
    const { ctx, state } = grouped();
    state.selection = ["t"];
    tap(createTextTool(), ctx, 50, 150);
    expect(state.textEdits).toEqual([]);
  });
});
