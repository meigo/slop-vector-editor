import { describe, expect, it } from "vitest";
import { FINE_FACTOR, SCRUB_THRESHOLD_PX, scrubbedValue, stepDecimals } from "../lib/scrub";

const base = { startValue: 10, step: 1, pxPerStep: 4, fine: false, min: 0, max: 100 };

describe("scrubbedValue (drag-adjustable number fields)", () => {
  it("moves one step per pxPerStep of travel, measured from the press", () => {
    expect(scrubbedValue({ ...base, dx: 0 })).toBe(10);
    expect(scrubbedValue({ ...base, dx: 4 })).toBe(11);
    expect(scrubbedValue({ ...base, dx: 41 })).toBe(20);
    expect(scrubbedValue({ ...base, dx: -8 })).toBe(8);
  });

  it("Shift needs FINE_FACTOR times the travel per step, on the same grid", () => {
    expect(scrubbedValue({ ...base, dx: 4, fine: true })).toBe(10);
    expect(scrubbedValue({ ...base, dx: 4 * FINE_FACTOR, fine: true })).toBe(11);
  });

  it("clamps to min/max", () => {
    expect(scrubbedValue({ ...base, dx: -400 })).toBe(0);
    expect(scrubbedValue({ ...base, dx: 4000 })).toBe(100);
  });

  /** Review L18 (2026-09-30): clamping before rounding took W's 0.01 minimum to 0. */
  it("never rounds below the minimum", () => {
    expect(scrubbedValue({ ...base, startValue: 5, min: 0.01, dx: -400 })).toBe(0.01);
    expect(scrubbedValue({ ...base, startValue: 5, min: 0.01, dx: 0 })).toBe(5);
  });

  it("snaps to the step grid anchored at min, and cleans float noise", () => {
    expect(scrubbedValue({ ...base, startValue: 1, step: 0.05, min: 0.5, max: 4, dx: 4 })).toBe(
      1.05,
    );
    // One step from an off-grid value: 12.37 + 0.5 = 12.87, snapped to the nearest grid point.
    expect(scrubbedValue({ ...base, startValue: 12.37, step: 0.5, dx: 4 })).toBe(13);
    expect(scrubbedValue({ ...base, startValue: 3, min: 3, max: 32, dx: 8 })).toBe(5);
  });

  it("anchors the grid at 0 when there is no finite min", () => {
    const free = { ...base, min: -Infinity, max: Infinity };
    expect(scrubbedValue({ ...free, startValue: -7, dx: -4 })).toBe(-8);
    expect(scrubbedValue({ ...free, startValue: 2.3, step: 0.5, dx: 4 })).toBe(3);
  });

  it("returns the start value for a non-finite travel", () => {
    expect(scrubbedValue({ ...base, dx: Number.NaN })).toBe(10);
  });

  it("stepDecimals reads the step's precision", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.05)).toBe(2);
    expect(SCRUB_THRESHOLD_PX).toBe(3);
  });
});
