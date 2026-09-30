import { describe, expect, it } from "vitest";
import { fingerPicks, FINGER_TAP_MS, FINGER_TAP_SLOP, isFingerTap } from "../input/finger-pick";
import { DEFAULT_PREFS, sanitizePrefs } from "../persist/preferences";

/** "Fingers select" (2026-09-30): after the Pencil has been used, fingers normally only navigate;
 *  with the dock's toggle on, a quick still finger tap acts as a click for the picking tools. */
describe("finger picking", () => {
  it("is off by default and survives a reload", () => {
    expect(DEFAULT_PREFS.fingerSelect).toBe(false);
    expect(sanitizePrefs({ ...DEFAULT_PREFS, fingerSelect: true }).fingerSelect).toBe(true);
    expect(sanitizePrefs({ fingerSelect: "yes" }).fingerSelect).toBe(false);
  });

  it("reaches only the tools where a tap picks, never a drawing tool", () => {
    for (const t of ["select", "node", "gradient", "text"] as const)
      expect(fingerPicks(t)).toBe(true);
    for (const t of [
      "brush",
      "pen",
      "rect",
      "ellipse",
      "line",
      "polygon",
      "warp",
      "hand",
    ] as const) {
      expect(fingerPicks(t)).toBe(false);
    }
  });

  it("is a tap only when short and still", () => {
    const at = { x: 100, y: 100, t: 1000 };
    expect(isFingerTap(at, { x: 100 + FINGER_TAP_SLOP, y: 100, t: 1100 })).toBe(true);
    expect(isFingerTap(at, { x: 100 + FINGER_TAP_SLOP + 1, y: 100, t: 1100 })).toBe(false);
    expect(isFingerTap(at, { x: 100, y: 100, t: 1000 + FINGER_TAP_MS - 1 })).toBe(true);
    expect(isFingerTap(at, { x: 100, y: 100, t: 1000 + FINGER_TAP_MS })).toBe(false);
  });
});
