import * as fs from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type PathShape } from "../doc/document";
import { applyMat, IDENTITY } from "../geom/mat";
import {
  app,
  beginDocGesture,
  beginTextEdit,
  endTextEdit,
  finishCharDrag,
  placeTitle,
  registerTextBlur,
  registerTextFocus,
  replaceDocument,
  setCaretStops,
  setCharOffset,
  setSelection,
  setTextSelection,
  setTitleOpts,
  setTitleText,
  setTool,
  textIndexAt,
  titleInFlight,
  toggleLayerLocked,
  typeTextEdit,
  undo,
} from "../state/appState.svelte";
import { caretStops, loadFace } from "../text/font";

/** Overrides follow their characters when text is inserted before them (spec M22 §4). */
const title = (): PathShape => ({
  kind: "path",
  id: "t",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  subpaths: [
    {
      closed: true,
      nodes: [
        { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 }, type: "corner" },
        { p: { x: 10, y: 0 }, in: { x: 10, y: 0 }, out: { x: 10, y: 0 }, type: "corner" },
        { p: { x: 10, y: 10 }, in: { x: 10, y: 10 }, out: { x: 10, y: 10 }, type: "corner" },
      ],
    },
  ],
  text: {
    text: "Tallinn",
    font: "anton",
    size: 50,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: "left",
    seed: 1,
    amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
    overrides: { 2: { dx: 5 } },
  },
});

const docWith = (): Doc => {
  const d = createDoc(400, 400);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children: [title()] }] };
};

const node = (): PathShape => app.doc.layers[0].children[0] as PathShape;

beforeAll(() => {
  // The bundled font is fetched by URL; serve the committed Anton fixture instead.
  const b = fs.readFileSync("fixtures/Anton-Regular.ttf");
  const bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }));
});

beforeEach(() => {
  registerTextFocus(null);
  registerTextBlur(null);
  replaceDocument(docWith(), "Untitled.svg", null, true);
  setCaretStops(null, []);
  app.notices = [];
});

describe("setTitleText keeps overrides on their characters", () => {
  it("an insertion at the front shifts the override and the character selection", async () => {
    setSelection(["t"]);
    app.charSel = 2;
    await setTitleText("XTallinn");
    expect(node().text?.text).toBe("XTallinn");
    expect(node().text?.overrides).toEqual({ 3: { dx: 5 } });
    expect(app.charSel).toBe(3);
  });

  it("replacing the overridden character drops it and clears the selection", async () => {
    setSelection(["t"]);
    app.charSel = 2;
    await setTitleText("Tainn");
    expect(node().text?.overrides).toEqual({});
    expect(app.charSel).toBeNull();
  });
});

/** Two titles and a caller-chosen text/transform for the first (spec M22 §2-§3). */
const twoTitles = (text = "Tallinn", transform = IDENTITY, font = "anton"): Doc => {
  const d = createDoc(400, 400);
  const t = title();
  const first: PathShape = { ...t, transform, text: { ...t.text!, text, font, overrides: {} } };
  const second: PathShape = {
    ...t,
    id: "t2",
    transform: [1, 0, 0, 1, 0, 200],
    text: { ...t.text!, text: "Tartu", overrides: {} },
  };
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children: [first, second] }] };
};

const textOf = (id: string): string | undefined =>
  (app.doc.layers[0].children.find((n) => n.id === id) as PathShape | undefined)?.text?.text;

describe("the text edit session (spec M22 §2-§3)", () => {
  beforeEach(() => replaceDocument(twoTitles(), "Untitled.svg", null, true));

  it("entering with 'all' selects the whole text and focuses synchronously", () => {
    const focus = vi.fn();
    registerTextFocus(focus);
    beginTextEdit("t", "all");
    // Before any await: iOS raises the keyboard only for a focus inside the tap (spec §1).
    expect(focus).toHaveBeenCalledTimes(1);
    expect(app.textEdit).toEqual({ id: "t", anchor: 0, focus: 7 });
    expect(app.selection).toEqual(["t"]);
  });

  it("three keystrokes and the end are one undo step", async () => {
    beginTextEdit("t", "all");
    typeTextEdit("X");
    typeTextEdit("XY");
    typeTextEdit("XYZ");
    await endTextEdit();
    expect(textOf("t")).toBe("XYZ");
    expect(app.textEdit).toBeNull();
    undo();
    expect(textOf("t")).toBe("Tallinn");
    expect(app.canUndo).toBe(false);
  });

  it("a one-character selection is the picked character, and nothing else is", () => {
    beginTextEdit("t", "all");
    setTextSelection(2, 3);
    expect(app.charSel).toBe(2);
    setTextSelection(4, 3);
    expect(app.charSel).toBe(3);
    setTextSelection(2, 4);
    expect(app.charSel).toBeNull();
    setTextSelection(5, 5);
    expect(app.charSel).toBeNull();
  });

  it("a selection of the newline does not pick it", () => {
    replaceDocument(twoTitles("Ta\nll"), "Untitled.svg", null, true);
    beginTextEdit("t", "all");
    setTextSelection(2, 3);
    expect(app.charSel).toBeNull();
    setTextSelection(3, 4);
    expect(app.charSel).toBe(3);
  });

  it("selecting another object ends the session; the text stays on the edited title", async () => {
    const blur = vi.fn();
    registerTextBlur(blur);
    beginTextEdit("t", "all");
    typeTextEdit("XTallinn");
    await titleInFlight();
    setSelection(["t2"]);
    expect(app.textEdit).toBeNull();
    expect(blur).toHaveBeenCalledTimes(1);
    expect(textOf("t")).toBe("XTallinn");
    expect(textOf("t2")).toBe("Tartu");
    // The bracket closed with the leave: the session is one undo step.
    undo();
    expect(textOf("t")).toBe("Tallinn");
  });

  it("a keystroke still queued when the selection changes never lands on the new selection", async () => {
    beginTextEdit("t", "all");
    typeTextEdit("A1");
    typeTextEdit("A12");
    setSelection(["t2"]);
    await titleInFlight();
    expect(textOf("t2")).toBe("Tartu");
  });

  it("re-selecting exactly the edited title does not end the session", () => {
    beginTextEdit("t", "all");
    setTextSelection(2, 3);
    setSelection(["t"]);
    expect(app.textEdit).not.toBeNull();
    expect(app.charSel).toBe(2);
  });

  it("undo during a session ends it and removes the whole session in one step", async () => {
    beginTextEdit("t", "all");
    typeTextEdit("Ab");
    typeTextEdit("Abc");
    await titleInFlight();
    expect(textOf("t")).toBe("Abc");
    undo();
    expect(app.textEdit).toBeNull();
    expect(textOf("t")).toBe("Tallinn");
    expect(app.canUndo).toBe(false);
  });

  it("switching to the Text tool keeps the session; any other tool ends it", () => {
    beginTextEdit("t", "all");
    setTool("text");
    expect(app.textEdit).not.toBeNull();
    setTool("select");
    expect(app.textEdit).toBeNull();
  });

  it("textIndexAt maps a document point through a rotated title's world matrix", async () => {
    const rot: [number, number, number, number, number, number] = [0, 1, -1, 0, 200, 100];
    replaceDocument(twoTitles("Tallinn", rot), "Untitled.svg", null, true);
    const t = app.doc.layers[0].children[0] as PathShape;
    const stops = caretStops(await loadFace(t.text!), t.text!);
    beginTextEdit("t", "all");
    setCaretStops("t", stops);
    // Just right of character 3's leading edge, mid-line, in the title's own space.
    const local = { x: stops[3].x + 1, y: (stops[3].top + stops[3].bottom) / 2 };
    expect(textIndexAt(applyMat(rot, local))).toBe(3);
    // Unrotated, the same document point is nowhere near that character.
    expect(textIndexAt(local)).not.toBe(3);
  });

  it("textIndexAt is null when stops are for another title", async () => {
    const t2 = app.doc.layers[0].children[1] as PathShape;
    const stops = caretStops(await loadFace(t2.text!), t2.text!);
    beginTextEdit("t", "all");
    setCaretStops("t2", stops);
    expect(textIndexAt({ x: 10, y: 10 })).toBeNull();
  });

  it("a click point that arrives before the stops is resolved when they do", async () => {
    const t = app.doc.layers[0].children[0] as PathShape;
    const stops = caretStops(await loadFace(t.text!), t.text!);
    beginTextEdit("t", { x: stops[4].x + 1, y: stops[4].baseline - 10 });
    setCaretStops("t", stops);
    expect(app.textEdit).toEqual({ id: "t", anchor: 4, focus: 4 });
  });

  it("a title whose font is unavailable refuses with a notice", () => {
    replaceDocument(twoTitles("Tallinn", IDENTITY, "gf:no-such-font"), "Untitled.svg", null, true);
    const focus = vi.fn();
    registerTextFocus(focus);
    beginTextEdit("t", "all");
    expect(app.textEdit).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    expect(app.notices.map((n) => n.text).join()).toMatch(/Needs the font/);
  });

  it("placing a title enters editing with its whole text selected", async () => {
    const focus = vi.fn();
    registerTextFocus(focus);
    setTool("text"); // placing enters editing only from the Text tool
    await placeTitle({ x: 50, y: 60 });
    const placed = app.doc.layers[0].children.at(-1) as PathShape;
    expect(placed.text?.text).toBe("Title");
    expect(app.selection).toEqual([placed.id]);
    expect(app.textEdit).toEqual({ id: placed.id, anchor: 0, focus: 5 });
    expect(focus).toHaveBeenCalledTimes(2);
    await endTextEdit();
  });

  it("placing focuses the field before the font resolves", async () => {
    const focus = vi.fn();
    const blur = vi.fn();
    registerTextFocus(focus);
    registerTextBlur(blur);
    setTool("text"); // placing enters editing only from the Text tool
    const placing = placeTitle({ x: 50, y: 60 });
    // Still inside the tap: iOS raises the keyboard only for a synchronous focus (spec §1).
    expect(focus).toHaveBeenCalledTimes(1);
    await placing;
    expect(app.textEdit).not.toBeNull();
    expect(blur).not.toHaveBeenCalled();
    await endTextEdit();
  });

  it("a placement refused after the font loads lets the field go", async () => {
    const focus = vi.fn();
    const blur = vi.fn();
    registerTextFocus(focus);
    registerTextBlur(blur);
    const placing = placeTitle({ x: 50, y: 60 });
    expect(focus).toHaveBeenCalledTimes(1);
    toggleLayerLocked("L0");
    await placing;
    expect(app.textEdit).toBeNull();
    expect(blur).toHaveBeenCalledTimes(1);
    expect(app.doc.layers[0].children).toHaveLength(2);
  });
});

const sizeOf = (id: string): number | undefined =>
  (app.doc.layers[0].children.find((n) => n.id === id) as PathShape | undefined)?.text?.size;

describe("the text edit session — fix round 1", () => {
  beforeEach(() => replaceDocument(twoTitles(), "Untitled.svg", null, true));

  it("a character drag inside a session does not close the session's bracket", async () => {
    beginTextEdit("t", "all");
    typeTextEdit("XTallinn");
    await titleInFlight();
    setTextSelection(1, 2);
    expect(app.charSel).toBe(1);
    // What the Text tool does for a drag of the picked character.
    beginDocGesture();
    void setCharOffset(3, 4);
    finishCharDrag();
    await titleInFlight();
    await Promise.resolve();
    typeTextEdit("XYTallinn");
    await titleInFlight();
    await endTextEdit();
    expect(textOf("t")).toBe("XYTallinn");
    undo();
    expect(textOf("t")).toBe("Tallinn");
    expect(app.canUndo).toBe(false);
  });

  it("a queued patch for one title is replaced, not merged, by one for another", async () => {
    setSelection(["t"]);
    void setTitleText("A1");
    void setTitleOpts({ size: 80 });
    setSelection(["t2"]);
    void setTitleText("Tartu!");
    await titleInFlight();
    expect(textOf("t2")).toBe("Tartu!");
    expect(sizeOf("t2")).toBe(50);
  });

  it("a dropped queued patch says so, unless it was a live keystroke", async () => {
    setSelection(["t"]);
    void setTitleText("A1");
    void setTitleText("A12");
    setSelection(["t2"]);
    await titleInFlight();
    const said = () => app.notices.filter((n) => /selection changed/.test(n.text)).length;
    // One for the outline in flight, one for the queued patch.
    expect(said()).toBe(2);
    app.notices = [];
    beginTextEdit("t", "all");
    typeTextEdit("B1");
    typeTextEdit("B12");
    setSelection(["t2"]);
    await titleInFlight();
    // Neither the keystroke in flight nor the queued one says anything (final review, minor 1).
    expect(said()).toBe(0);
  });

  it("re-entering the title while its end is awaiting keeps the new session", async () => {
    beginTextEdit("t", "all");
    typeTextEdit("XTallinn");
    const ending = endTextEdit();
    beginTextEdit("t", "all");
    await ending;
    expect(app.textEdit).toEqual({ id: "t", anchor: 0, focus: 8 });
    await endTextEdit();
    expect(app.textEdit).toBeNull();
  });

  it("the selection is clamped to the text being typed, not the lagging document", async () => {
    beginTextEdit("t", "all");
    typeTextEdit("Tallinn!!");
    setTextSelection(9, 9);
    expect(app.textEdit).toEqual({ id: "t", anchor: 9, focus: 9 });
    await endTextEdit();
  });

  it("entering a second title while editing the first ends the first as one step", async () => {
    const focus = vi.fn();
    const blur = vi.fn();
    registerTextFocus(focus);
    registerTextBlur(blur);
    beginTextEdit("t", "all");
    typeTextEdit("XTallinn");
    await titleInFlight();
    beginTextEdit("t2", "all");
    expect(app.textEdit).toEqual({ id: "t2", anchor: 0, focus: 5 });
    expect(app.selection).toEqual(["t2"]);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(textOf("t")).toBe("XTallinn");
    undo();
    expect(textOf("t")).toBe("Tallinn");
    expect(app.canUndo).toBe(false);
  });
});

describe("the text edit session — final review fixes", () => {
  beforeEach(() => replaceDocument(twoTitles(), "Untitled.svg", null, true));

  it("a session change that prunes the edited title from the selection ends the session", async () => {
    const blur = vi.fn();
    registerTextBlur(blur);
    beginTextEdit("t", "all");
    typeTextEdit("XTallinn");
    await titleInFlight();
    // Locking the title's layer prunes it from the selection through `setSession`, not
    // `setSelection` (the same path as dragging its Layers row into a locked layer).
    toggleLayerLocked("L0");
    await Promise.resolve();
    expect(app.selection).toEqual([]);
    expect(app.textEdit).toBeNull();
    expect(blur).toHaveBeenCalledTimes(1);
    // The bracket closed with the leave, so the next edit is an undo step of its own.
    toggleLayerLocked("L0");
    undo();
    expect(app.doc.layers[0].locked).toBe(true);
    expect(textOf("t")).toBe("XTallinn");
  });

  it("a live keystroke in flight when a store-driven leave happens is dropped quietly", async () => {
    beginTextEdit("t", "all");
    typeTextEdit("B1");
    setSelection(["t2"]);
    await titleInFlight();
    expect(app.notices.filter((n) => /selection changed/.test(n.text))).toHaveLength(0);
    expect(textOf("t2")).toBe("Tartu");
  });

  it("a tool change while placing's font loads does not start a session", async () => {
    const blur = vi.fn();
    registerTextBlur(blur);
    setTool("text");
    const placing = placeTitle({ x: 50, y: 60 });
    setTool("select");
    await placing;
    const placed = app.doc.layers[0].children.at(-1) as PathShape;
    expect(placed.text?.text).toBe("Title");
    expect(app.selection).toEqual([placed.id]);
    expect(app.textEdit).toBeNull();
    expect(blur).toHaveBeenCalledTimes(1);
  });
});
