import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Layer,
  type Node,
} from "../doc/document";
import { insertNodes } from "../doc/edits";
import { applyMat, IDENTITY, translate } from "../geom/mat";
import {
  clipboardText,
  EMPTY,
  isPasteError,
  looksLikeSvg,
  NO_LAYER,
  NOT_SVG,
  planPaste,
  type Clip,
  type PastePlan,
} from "../state/clipboard";
import { parseSvg } from "../svg/parse";
import { deepFreeze, stripIds } from "./helpers";

const rect = (id: string, x: number, y: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w: 20,
  h: 20,
  rx: 0,
});

function doc(layers: Partial<Layer>[], nextId = 50): Doc {
  return deepFreeze({
    ...createDoc(100, 100),
    nextId,
    layers: layers.map((l, i) => ({
      id: `L${i}`,
      name: `L${i}`,
      visible: true,
      locked: false,
      children: [],
      ...l,
    })),
  });
}

const view = { x: 0, y: 0, w: 100, h: 100 };
const plan = (r: ReturnType<typeof planPaste>): PastePlan => {
  if (isPasteError(r)) throw new Error(r.error);
  return r;
};
const originOf = (d: Doc, id: string) =>
  applyMat(d.layers.flatMap((l) => l.children).find((n) => n.id === id)!.transform, { x: 0, y: 0 });

describe("insertNodes", () => {
  it("appends deep copies with fresh ids, translated", () => {
    const d = doc([{ children: [rect("a", 0, 0)] }]);
    const g: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("inner", 0, 0)],
    };
    const r = insertNodes(d, "L0", [rect("x", 1, 1), g], 5, 6);
    expect(r.ids).toEqual(["n50", "n51"]);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "n50", "n51"]);
    expect((r.doc.layers[0].children[2] as Group).children[0].id).toBe("n52");
    expect(r.doc.nextId).toBe(53);
    expect(r.doc.layers[0].children[1].transform).toEqual(translate(5, 6));
    const none = insertNodes(d, "L0", [], 1, 1);
    expect(none.doc).toBe(d);
    expect(none.ids).toEqual([]);
    expect(() => insertNodes(d, "nope", [rect("x", 0, 0)], 0, 0)).toThrow();
    const still = insertNodes(d, "L0", [rect("x", 0, 0)], 0, 0);
    expect(still.doc.layers[0].children[1].transform).toBe(IDENTITY);
  });
});

describe("clipboardText", () => {
  it("serialises the selected top-level nodes in document order", () => {
    const d = doc([
      { children: [rect("a", 10, 10), rect("b", 50, 50)] },
      { children: [rect("c", 0, 0)] },
    ]);
    expect(clipboardText(d, [])).toBeNull();
    expect(clipboardText(d, ["zz"])).toBeNull();
    const text = clipboardText(d, ["c", "a"])!;
    expect(text).toContain('data-sv-name="Clipboard"');
    expect(looksLikeSvg(text)).toBe(true);
    const back = parseSvg(text).doc;
    expect(back.layers).toHaveLength(1);
    expect(stripIds(back).layers[0].children).toEqual(
      stripIds({
        ...d,
        layers: [{ ...d.layers[0], children: [rect("a", 10, 10), rect("c", 0, 0)] }],
      }).layers[0].children,
    );
  });
});

describe("planPaste", () => {
  const source = doc([{ children: [rect("a", 10, 10)] }]);
  const text = clipboardText(source, ["a"])!;

  it("cascades repeated pastes of our own copy by 10", () => {
    const clip: Clip = { text, pastes: 0 };
    const first = plan(planPaste(source, text, clip, view));
    expect(first.ids).toEqual(["n50"]);
    expect(originOf(first.doc, "n50")).toEqual({ x: 10, y: 10 });
    expect(first.clip).toEqual({ text, pastes: 1 });
    expect(first.dropped).toEqual([]);
    const second = plan(planPaste(first.doc, text, first.clip, view));
    expect(originOf(second.doc, second.ids[0])).toEqual({ x: 20, y: 20 });
    expect(second.clip).toEqual({ text, pastes: 2 });
  });

  it("recognises our own copy even after a CRLF round-trip", () => {
    const crlf = text.replace(/\n/g, "\r\n");
    const clip: Clip = { text, pastes: 0 };
    const r = plan(planPaste(source, crlf, clip, view));
    expect(originOf(r.doc, r.ids[0])).toEqual({ x: 10, y: 10 });
    expect(r.clip).toEqual({ text: crlf, pastes: 1 });
  });

  it("centres our copy in the view when the offset copy would be off-screen", () => {
    const far = { x: 500, y: 500, w: 100, h: 100 };
    const r = plan(planPaste(source, text, { text, pastes: 0 }, far));
    // bounds (10,10,20,20) centre (20,20) → view centre (550,550)
    expect(originOf(r.doc, r.ids[0])).toEqual({ x: 530, y: 530 });
    expect(r.clip).toEqual({ text, pastes: 1 });
  });

  it("centres external SVG on the view and keeps the in-app copy", () => {
    const clip: Clip = { text, pastes: 3 };
    const ext = `<svg viewBox="0 0 50 50"><circle cx="5" cy="5" r="5"/><text>hi</text></svg>`;
    expect(looksLikeSvg(ext)).toBe(true);
    const r = plan(planPaste(source, ext, clip, view));
    expect(r.clip).toBe(clip);
    expect(r.dropped).toEqual(["<text>"]);
    expect(originOf(r.doc, r.ids[0])).toEqual({ x: 45, y: 45 });
    const noClip = plan(planPaste(source, ext, null, view));
    expect(noClip.clip).toBeNull();
  });

  it("pastes into the top-most visible unlocked layer", () => {
    const d = doc([{ children: [] }, { children: [] }, { children: [], locked: true }]);
    const r = plan(planPaste(d, text, null, view));
    expect(r.doc.layers[1].children.map((n) => n.id)).toEqual(r.ids);
    expect(r.doc.layers[0].children).toHaveLength(0);
  });

  it("reports errors without changing anything", () => {
    expect(planPaste(source, "hello", null, view)).toEqual({ error: NOT_SVG });
    expect(planPaste(source, "<html></html>", null, view)).toEqual({ error: NOT_SVG });
    expect(planPaste(source, "<svg/>", null, view)).toEqual({ error: EMPTY });
    const locked = doc([{ children: [], locked: true }]);
    expect(planPaste(locked, text, null, view)).toEqual({ error: NO_LAYER });
    expect(looksLikeSvg("just text")).toBe(false);
    expect(looksLikeSvg("<SVG width='1'/>")).toBe(true);
  });
});
