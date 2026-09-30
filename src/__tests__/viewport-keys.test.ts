import { describe, expect, it } from "vitest";
import { commandForKey } from "../state/keys";
import {
  docToScreen,
  fitRect,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  pinch,
  screenToDoc,
  wheelView,
  zoomAt,
} from "../state/viewport";

const v0 = { x: 10, y: 20, zoom: 2 };

describe("viewport", () => {
  it("converts between doc and screen", () => {
    expect(docToScreen(v0, { x: 5, y: 5 })).toEqual({ x: 20, y: 30 });
    expect(screenToDoc(v0, { x: 20, y: 30 })).toEqual({ x: 5, y: 5 });
  });

  it("pans", () => {
    expect(panBy(v0, 3, -4)).toEqual({ x: 13, y: 16, zoom: 2 });
  });

  it("zooms around a fixed screen point and clamps", () => {
    const at = { x: 100, y: 50 };
    const before = screenToDoc(v0, at);
    const v = zoomAt(v0, at, 3);
    expect(v.zoom).toBe(6);
    const after = screenToDoc(v, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(v0, at, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(v0, at, 0.00001).zoom).toBe(MIN_ZOOM);
  });

  it("fits and centers a rect", () => {
    const v = fitRect({ x: 0, y: 0, w: 100, h: 50 }, 280, 280, 40);
    expect(v.zoom).toBe(2);
    expect(docToScreen(v, { x: 50, y: 25 })).toEqual({ x: 140, y: 140 });
  });

  it("pinch zooms by the finger-distance ratio and follows the midpoint", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const out = pinch(v, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 30, y: 10 });
    expect(out.zoom).toBe(2);
    // doc point under the old midpoint (5,0) is now under the new midpoint (20,10)
    expect(docToScreen(out, { x: 5, y: 0 })).toEqual({ x: 20, y: 10 });
  });

  it("wheel pans, and zooms with ctrl/meta", () => {
    const base = { deltaX: 5, deltaY: 10, deltaMode: 0, ctrlKey: false, metaKey: false };
    expect(wheelView(v0, base, { x: 0, y: 0 })).toEqual({ x: 5, y: 10, zoom: 2 });
    expect(wheelView(v0, { ...base, deltaMode: 1 }, { x: 0, y: 0 })).toEqual({
      x: -70,
      y: -140,
      zoom: 2,
    });
    const z = wheelView(v0, { ...base, deltaY: -100, ctrlKey: true }, { x: 0, y: 0 });
    expect(z.zoom).toBeCloseTo(2 * Math.E);
  });
});

describe("commandForKey", () => {
  const k = (
    key: string,
    mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {},
  ) => commandForKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

  it("maps the file and history shortcuts", () => {
    expect(k("z", { metaKey: true })).toBe("undo");
    expect(k("Z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(k("y", { ctrlKey: true })).toBe("redo");
    expect(k("s", { ctrlKey: true })).toBe("save");
    expect(k("S", { ctrlKey: true, shiftKey: true })).toBe("saveAs");
    expect(k("o", { metaKey: true })).toBe("open");
  });

  it("maps zoom keys with and without modifiers", () => {
    expect(k("0", { metaKey: true })).toBe("fit");
    expect(k("1", { metaKey: true })).toBe("zoom100");
    expect(k("=")).toBe("zoomIn");
    expect(k("+", { metaKey: true })).toBe("zoomIn");
    expect(k("-")).toBe("zoomOut");
  });

  it("ignores everything else", () => {
    expect(k("z")).toBeNull();
    expect(k("0")).toBeNull();
    expect(k("a", { metaKey: true })).toBeNull();
  });
});

/** Review M20/M21 (2026-09-30): which app keys a focused field lets through. A text field keeps its
 *  keys (⌘Z is its own text undo) but not ⌘S/⌘O — those opened the browser's Save Page / Open File.
 *  A non-text control (slider, swatch, select, checkbox) keeps only arrows and Space; before, it
 *  swallowed every shortcut until focus moved. */
describe("keys a focused field lets through", () => {
  const k = (key: string, mods: { meta?: boolean; shift?: boolean } = {}) => ({
    key,
    metaKey: !!mods.meta,
    ctrlKey: false,
    shiftKey: !!mods.shift,
  });
  it("a text field passes only the file commands", async () => {
    const { fieldPassesKey } = await import("../state/keys");
    expect(fieldPassesKey("text", k("s", { meta: true }))).toBe(true);
    expect(fieldPassesKey("text", k("S", { meta: true, shift: true }))).toBe(true);
    expect(fieldPassesKey("text", k("o", { meta: true }))).toBe(true);
    expect(fieldPassesKey("text", k("z", { meta: true }))).toBe(false);
    expect(fieldPassesKey("text", k("Backspace"))).toBe(false);
    expect(fieldPassesKey("text", k("v"))).toBe(false);
    expect(fieldPassesKey("text", k("+"))).toBe(false);
  });
  it("a non-text control passes everything but arrows and Space", async () => {
    const { fieldPassesKey } = await import("../state/keys");
    expect(fieldPassesKey("control", k("z", { meta: true }))).toBe(true);
    expect(fieldPassesKey("control", k("Backspace"))).toBe(true);
    expect(fieldPassesKey("control", k("v"))).toBe(true);
    expect(fieldPassesKey("control", k("Escape"))).toBe(true);
    for (const a of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]) {
      expect(fieldPassesKey("control", k(a))).toBe(false);
    }
  });
});
