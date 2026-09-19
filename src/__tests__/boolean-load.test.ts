import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { app, booleanSelection, replaceDocument, setSelection } from "../state/appState.svelte";

/** Paper is fetched on first use, so the realistic failure is the network — a dropped connection,
 *  or a tab asking for the chunk of a build a deploy has replaced. The whole file runs with that
 *  import failing, which is why it is a file of its own (spec M7 §7). */
vi.mock("paper/dist/paper-core", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

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
    layers: [{ ...d.layers[0], id: "L0", children: [rect("a", 0, 0), rect("b", 40, 40)] }],
  };
};

beforeEach(() => {
  replaceDocument(makeDoc(), "Untitled.svg", null, true);
  app.notices = [];
});

describe("booleanSelection when paper cannot be loaded", () => {
  it("leaves the document alone and raises one error notice", async () => {
    setSelection(["a", "b"]);
    const before = app.doc;
    await booleanSelection("unite");
    expect(app.doc).toBe(before);
    expect(app.selection).toEqual(["a", "b"]);
    expect(app.canUndo).toBe(false);
    expect(app.notices).toHaveLength(1);
    // An error, not an info: an info fades after six seconds, and a failure the user has no other
    // sign of would then leave four buttons that look enabled and do nothing.
    expect(app.notices[0].kind).toBe("error");
    expect(app.notices[0].text).toBe(
      "Unite — the operation could not load. Check your connection, then reload the page.",
    );
  });

  it("stays usable after a failure: the next attempt runs and reports for itself", async () => {
    setSelection(["a", "b"]);
    await booleanSelection("unite");
    await booleanSelection("subtract");
    expect(app.doc).toEqual(makeDoc());
    expect(app.notices).toHaveLength(2);
    expect(app.notices[1].text.startsWith("Subtract —")).toBe(true);
  });
});
