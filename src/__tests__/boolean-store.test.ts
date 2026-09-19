import { beforeEach, describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import {
  app,
  booleanSelection,
  replaceDocument,
  setSelection,
  undo,
} from "../state/appState.svelte";

/** `booleanSelection` is async even with paper already loaded, so everything the user can do
 *  during that await is a real case (spec M7 §7). Runs against the real paper, as the geometry
 *  tests do. */

const rect = (id: string, x: number, y: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w: 60,
  h: 60,
  rx: 0,
});

const makeDoc = (): Doc => {
  const d = createDoc(200, 200);
  return {
    ...d,
    layers: [
      {
        ...d.layers[0],
        id: "L0",
        children: [rect("a", 0, 0), rect("b", 40, 40), rect("c", 150, 0)],
      },
    ],
  };
};

beforeEach(() => {
  replaceDocument(makeDoc(), "Untitled.svg", null, true);
  app.notices = [];
});

describe("booleanSelection while one is already running", () => {
  it("ignores the second of two quick clicks instead of blaming the user's own edit", async () => {
    setSelection(["a", "b"]);
    const both = Promise.all([booleanSelection("unite"), booleanSelection("unite")]);
    await both;
    // One commit, one undo step — and no "the document changed while it loaded" notice, which is
    // what the second call reported before, about the first call's commit.
    expect(app.notices).toEqual([]);
    expect(app.doc.layers[0].children.map((n) => n.id)).toEqual(["b", "c"]);
    undo();
    expect(app.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(app.canUndo).toBe(false);
  });
});

describe("booleanSelection when the selection moves during the await", () => {
  it("still commits the operation but does not take the selection back", async () => {
    setSelection(["a", "b"]);
    const running = booleanSelection("unite");
    // A plain click on another shape changes the selection and no document, so the commit's own
    // guard (`app.doc !== before`) lets the operation through.
    setSelection(["c"]);
    await running;
    expect(app.doc.layers[0].children.map((n) => n.id)).toEqual(["b", "c"]);
    expect(app.selection).toEqual(["c"]);
    expect(app.notices).toEqual([]);
  });

  it("selects the result when the selection did not move", async () => {
    setSelection(["a", "b"]);
    await booleanSelection("unite");
    expect(app.selection).toEqual(["b"]);
  });
});
