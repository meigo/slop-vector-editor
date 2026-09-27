import { beforeEach, describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  isGradient,
  type Doc,
  type LinearGradient,
  type Node,
  type Shape,
} from "../doc/document";
import { findNode } from "../doc/tree";
import { IDENTITY } from "../geom/mat";
import {
  app,
  clearOrLeaveGroup,
  replaceDocument,
  setGradientStop,
  setGradientTarget,
  setSelection,
  setSelectionGradientStop,
  setSelectionPaintKind,
  undo,
} from "../state/appState.svelte";

/** Real-store coverage for M15 §6–§7: the gradient kind/stop actions and the picked-stop store
 *  state, modelled on node-store.test.ts. */

const rect = (id: string, x: number, y: number, w: number, h: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: { ...DEFAULT_STYLE, fill: { color: "#ff0000", opacity: 1 } },
  x,
  y,
  w,
  h,
  rx: 0,
});

/** Two red rects "a" and "b", both on layer "L0". */
function makeDoc(): Doc {
  return {
    ...createDoc(100, 100),
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [rect("a", 0, 0, 10, 10), rect("b", 40, 40, 10, 10)],
      },
    ],
  };
}

function styleOf(id: string): Shape["style"] {
  return (findNode(app.doc, id)!.node as Shape).style;
}

beforeEach(() => {
  replaceDocument(makeDoc(), "Untitled.svg", null, true);
  setSelection(["a", "b"]);
});

describe("gradient store actions", () => {
  it("Flat→Linear and a stop edit are single undo steps per shape", () => {
    setSelectionPaintKind("fill", "linear");
    expect(isGradient(styleOf("a").fill)).toBe(true);
    setSelectionGradientStop("fill", "end", { color: "#00ff00", opacity: 1 });
    expect((styleOf("b").fill as LinearGradient).end.color).toBe("#00ff00");
    undo();
    expect((styleOf("b").fill as LinearGradient).end.color).toBe("#ff0000");
    undo();
    expect(isGradient(styleOf("a").fill)).toBe(false);
  });

  it("a picked stop is cleared by a selection change and by Escape before the selection", () => {
    setGradientStop({ id: "a", stop: "start", which: "fill" });
    setSelection(["a"]);
    expect(app.gradientStop).toBeNull();
    setGradientStop({ id: "a", stop: "end", which: "fill" });
    clearOrLeaveGroup();
    expect(app.gradientStop).toBeNull();
    expect(app.selection).toEqual(["a"]);
    clearOrLeaveGroup();
    expect(app.selection).toEqual([]);
  });

  it("the target defaults to fill and is kept", () => {
    expect(app.gradientTarget).toBe("fill");
    setGradientTarget("stroke");
    expect(app.gradientTarget).toBe("stroke");
  });
});
