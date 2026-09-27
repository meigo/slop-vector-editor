import { afterEach, describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import {
  cancelActiveGesture,
  registerToolActivate,
  registerToolSettle,
  replaceDocument,
  setSelection,
  setTool,
} from "../state/appState.svelte";
import { constrain45 } from "../tools/shape-tools";

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const doc = (): Doc => {
  const d = createDoc(100, 100);
  return { ...d, layers: [{ ...d.layers[0], children: [rect("a"), rect("b")] }] };
};

describe("tool hooks (spec M14 §5, plan rulings 1–2)", () => {
  afterEach(() => {
    registerToolActivate(null);
    registerToolSettle(null);
    setTool("select");
  });

  it("setTool calls the activate hook after switching", () => {
    let seen = "";
    registerToolActivate(() => (seen = "called"));
    setTool("gradient");
    expect(seen).toBe("called");
  });

  it("cancelActiveGesture and a selection change call the settle hook", () => {
    replaceDocument(doc(), "t.svg", null, true);
    let n = 0;
    registerToolSettle(() => n++);
    cancelActiveGesture();
    expect(n).toBe(1);
    setSelection(["a"]);
    expect(n).toBe(2);
    setSelection(["a"]);
    expect(n).toBe(2);
  });

  it("constrain45 rotates about the pivot to the nearest 45°, keeping distance", () => {
    const p = constrain45({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.x).toBeCloseTo(Math.hypot(10, 1), 9);
    expect(p.y).toBeCloseTo(0, 9);
  });
});
