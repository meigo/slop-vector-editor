import { describe, expect, it } from "vitest";
import {
  clampPercent,
  clampPress,
  clampSize,
  DEFAULT_BRUSH,
  sanitizeBrush,
} from "../brush/settings";
import { app, setBrushPrefs } from "../state/appState.svelte";
import { DEFAULT_PREFS, sanitizePrefs, SECTION_IDS } from "../persist/preferences";

describe("brush settings", () => {
  it("clamps size, falling back on nonsense", () => {
    expect(clampSize(0.1)).toBe(0.5);
    expect(clampSize(9999)).toBe(500);
    expect(clampSize(NaN)).toBe(8);
  });
  it("snaps pressure to half steps inside 1–8", () => {
    expect(clampPress(2.26)).toBe(2.5);
    expect(clampPress(0)).toBe(1);
    expect(clampPress(20)).toBe(8);
    expect(clampPress(Infinity)).toBe(3);
  });
  it("clamps percentages", () => {
    expect(clampPercent(-5, 30)).toBe(0);
    expect(clampPercent(150, 30)).toBe(100);
    expect(clampPercent(NaN, 30)).toBe(30);
  });
  it("sanitizes each field on its own", () => {
    expect(sanitizeBrush(null)).toEqual(DEFAULT_BRUSH);
    expect(
      sanitizeBrush({ size: 12, pressure: "x", taper: false, stream: 50, smooth: 999 }),
    ).toEqual({ size: 12, pressure: 3, taper: false, stream: 50, smooth: 100 });
  });
});

describe("prefs.brush", () => {
  it("defaults and round-trips through sanitizePrefs", () => {
    expect(DEFAULT_PREFS.brush).toEqual(DEFAULT_BRUSH);
    const raw = JSON.parse(
      JSON.stringify({ ...DEFAULT_PREFS, brush: { ...DEFAULT_BRUSH, size: 20 } }),
    );
    expect(sanitizePrefs(raw).brush.size).toBe(20);
    expect(sanitizePrefs({}).brush).toEqual(DEFAULT_BRUSH);
  });
  it("knows the brush section", () => {
    expect(SECTION_IDS).toContain("brush");
  });
  it("setBrushPrefs clamps what it writes", () => {
    setBrushPrefs({ size: 0, pressure: 9.3, smooth: 150 });
    expect(app.prefs.brush).toMatchObject({ size: 0.5, pressure: 8, smooth: 100 });
  });
});
