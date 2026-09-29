import * as fs from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type PathShape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { app, replaceDocument, setSelection, setTitleText } from "../state/appState.svelte";

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
  replaceDocument(docWith(), "Untitled.svg", null, true);
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
