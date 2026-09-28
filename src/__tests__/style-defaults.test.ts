import { beforeEach, describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { DEFAULT_PREFS } from "../persist/preferences";
import {
  app,
  replaceDocument,
  setPrefs,
  setSelection,
  setSelectionOpacity,
  setSelectionStyle,
} from "../state/appState.svelte";

/** 2026-09-28: the last style set on a selection becomes the default for new shapes. */

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: { ...DEFAULT_STYLE, fill: { color: "#ff0000", opacity: 1 } },
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const doc = (): Doc => {
  const d = createDoc(100, 100);
  return { ...d, layers: [{ ...d.layers[0], children: [rect("a")] }] };
};

describe("style edits on a selection become the defaults for new shapes", () => {
  beforeEach(() => {
    setPrefs(DEFAULT_PREFS);
    replaceDocument(doc(), "t.svg", null, true);
  });

  it("selecting alone changes nothing", () => {
    const before = app.prefs.style;
    setSelection(["a"]);
    expect(app.prefs.style).toBe(before);
  });

  it("a flat fill, stroke, width, cap and join edit is remembered", () => {
    setSelection(["a"]);
    setSelectionStyle({ fill: { color: "#00ff00", opacity: 0.5 } });
    setSelectionStyle({ stroke: { color: "#0000ff", opacity: 1 }, strokeWidth: 3 });
    setSelectionStyle({ cap: "round", join: "bevel" });
    expect(app.prefs.style.fill).toEqual({ color: "#00ff00", opacity: 0.5 });
    expect(app.prefs.style.stroke).toEqual({ color: "#0000ff", opacity: 1 });
    expect(app.prefs.style.strokeWidth).toBe(3);
    expect(app.prefs.style.cap).toBe("round");
    expect(app.prefs.style.join).toBe("bevel");
  });

  it("turning fill off is remembered", () => {
    setSelection(["a"]);
    setSelectionStyle({ fill: null });
    expect(app.prefs.style.fill).toBeNull();
  });

  it("a gradient edit leaves the default paint alone (new shapes are drawn flat)", () => {
    setSelection(["a"]);
    const before = app.prefs.style.fill;
    setSelectionStyle({
      fill: {
        kind: "linear",
        from: { x: 0, y: 0 },
        to: { x: 10, y: 0 },
        start: { color: "#000000", opacity: 1 },
        end: { color: "#ffffff", opacity: 1 },
      },
    });
    expect(app.prefs.style.fill).toEqual(before);
  });

  it("an opacity edit is remembered", () => {
    setSelection(["a"]);
    setSelectionOpacity(0.4);
    expect(app.prefs.style.opacity).toBe(0.4);
  });

  it("with nothing selected the defaults still change, as before", () => {
    setSelectionStyle({ strokeWidth: 7 });
    expect(app.prefs.style.strokeWidth).toBe(7);
  });
});
