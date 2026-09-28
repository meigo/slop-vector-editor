import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { findNode } from "../doc/tree";
import { IDENTITY } from "../geom/mat";
import {
  app,
  cancelActiveGesture,
  registerToolActivate,
  registerToolSettle,
  replaceDocument,
  setSelection,
  setSelectionStyle,
  setTool,
  undo,
} from "../state/appState.svelte";
import { storeContext } from "../tools/context";
import { TOOLS } from "../tools/registry";
import { constrain45 } from "../tools/shape-tools";
import { ev } from "./fake-context";

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

describe("a store edit mid-warp keeps the warp (Review Focus 4)", () => {
  // The describe above nulls both hooks after each test; put back what `tools/context.ts` registers.
  beforeEach(() => {
    registerToolActivate(() => TOOLS[app.toolId].activate?.(storeContext));
    registerToolSettle(() => TOOLS[app.toolId].settle?.(storeContext));
  });
  afterEach(() => {
    setTool("select");
  });

  it("a fill change commits the warp first, as its own undo step", () => {
    replaceDocument(doc(), "t.svg", null, true);
    setSelection(["a"]);
    setTool("warp");
    expect(app.overlay?.kind).toBe("cage");
    TOOLS.warp.down(storeContext, ev(10, 10));
    TOOLS.warp.move(storeContext, ev(15, 15));
    TOOLS.warp.up(storeContext, ev(20, 20));
    const oldFill = (findNode(app.doc, "a")!.node as { style: typeof DEFAULT_STYLE }).style.fill;
    setSelectionStyle({ fill: { color: "#00ff00", opacity: 1 } });
    let a = findNode(app.doc, "a")!.node;
    expect(a.kind).toBe("path");
    expect(a.kind !== "group" && a.style.fill).toEqual({ color: "#00ff00", opacity: 1 });
    undo();
    a = findNode(app.doc, "a")!.node;
    expect(a.kind).toBe("path");
    expect(a.kind !== "group" && a.style.fill).toEqual(oldFill);
    undo();
    a = findNode(app.doc, "a")!.node;
    expect(a).toEqual(rect("a"));
  });

  const dragCorner = () => {
    TOOLS.warp.down(storeContext, ev(10, 10));
    TOOLS.warp.move(storeContext, ev(15, 15));
    TOOLS.warp.up(storeContext, ev(20, 20));
  };

  it("a tool change mid-bracket keeps the warp as ONE undo step", () => {
    replaceDocument(doc(), "t.svg", null, true);
    setSelection(["a"]);
    setTool("warp");
    const past = app.session.history.past.length;
    dragCorner();
    dragCorner();
    setTool("select");
    expect(app.session.gestureBase).toBeNull();
    expect(app.session.history.past.length).toBe(past + 1);
    expect(findNode(app.doc, "a")!.node.kind).toBe("path");
    undo();
    expect(findNode(app.doc, "a")!.node).toEqual(rect("a"));
  });

  it("undo mid-bracket reverses the warp, and the tool still warps afterwards", () => {
    const original = doc();
    replaceDocument(original, "t.svg", null, true);
    setSelection(["a"]);
    setTool("warp");
    dragCorner();
    undo();
    expect(app.doc).toBe(original);
    expect(app.session.gestureBase).toBeNull();
    expect(app.selection).toEqual(["a"]);
    // Fix round 1: the first press on a corner re-seeds the cage and drags, rather than selecting.
    dragCorner();
    expect(findNode(app.doc, "a")!.node.kind).toBe("path");
    expect(app.session.gestureBase).not.toBeNull();
  });
});
