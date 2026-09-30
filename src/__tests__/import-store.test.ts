import { beforeEach, describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import {
  app,
  importSvgText,
  replaceDocument,
  toggleLayerLocked,
  undo,
} from "../state/appState.svelte";

/** File ▸ Import SVG… and a dropped file (2026-09-30): the file's drawing goes into the current
 *  layer through the paste plan — one undo step, selected, dropped content reported. */

const existing = (): Doc => {
  const d = createDoc(200, 200);
  return {
    ...d,
    layers: [
      {
        ...d.layers[0],
        id: "L0",
        name: "Back",
        children: [
          {
            kind: "rect",
            id: "a",
            transform: IDENTITY,
            style: DEFAULT_STYLE,
            x: 0,
            y: 0,
            w: 20,
            h: 20,
            rx: 0,
          },
        ],
      },
    ],
  };
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <g id="layer1"><rect x="10" y="10" width="30" height="30" fill="#ff0000"/></g>
  <g id="layer2"><circle cx="70" cy="70" r="10" fill="#0000ff"/><foreignObject/></g>
</svg>`;

beforeEach(() => {
  replaceDocument(existing(), "Untitled.svg", null, true);
  app.notices = [];
});

describe("importSvgText", () => {
  it("adds the file's drawing to the current layer, selected, as one undo step", () => {
    importSvgText(SVG);
    const kids = app.doc.layers[0].children;
    expect(kids.length).toBeGreaterThan(1);
    expect(kids[0].id).toBe("a");
    expect(app.selection.length).toBe(kids.length - 1);
    expect(app.selection).not.toContain("a");
    undo();
    expect(app.doc.layers[0].children.map((n) => n.id)).toEqual(["a"]);
  });

  it("reports content it could not import", () => {
    importSvgText(SVG);
    expect(app.notices.map((n) => n.text).join(" ")).toMatch(/not imported/);
  });

  it("refuses a file that is not an SVG drawing, leaving the document alone", () => {
    const before = app.doc;
    importSvgText("hello");
    expect(app.doc).toBe(before);
    expect(app.notices.map((n) => n.text)).toContain("The file isn't an SVG drawing.");
  });

  it("refuses a locked current layer, naming the import", () => {
    toggleLayerLocked("L0");
    importSvgText(SVG);
    expect(app.notices.map((n) => n.text).join(" ")).toMatch(/unlock it to import/);
    expect(app.doc.layers[0].children.map((n) => n.id)).toEqual(["a"]);
  });
});
