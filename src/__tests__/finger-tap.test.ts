import { describe, expect, it } from "vitest";
import { createFingerTap, TAP_MAX_DISTANCE, TAP_MAX_DURATION } from "../input/finger-tap";

/** Fingers land at `t`, lift at `t + dur`; returns what the last lift reports. */
function tap(count: number, dur = 120, move = 0) {
  const d = createFingerTap();
  for (let i = 0; i < count; i++) d.down(i, { x: 100 * i, y: 0 }, 1000 + i * 10);
  if (move) d.move(0, { x: move, y: 0 });
  let out: number | null = null;
  for (let i = 0; i < count; i++) out = d.up(i, 1000 + i * 10 + dur);
  return out;
}

describe("finger taps (ported from slop-paint's touch-gestures.ts)", () => {
  it("reports two- and three-finger taps", () => {
    expect(tap(2)).toBe(2);
    expect(tap(3)).toBe(3);
  });

  it("reports nothing for one finger or four", () => {
    expect(tap(1)).toBeNull();
    expect(tap(4)).toBeNull();
  });

  it("only on the last lift", () => {
    const d = createFingerTap();
    d.down(1, { x: 0, y: 0 }, 0);
    d.down(2, { x: 50, y: 0 }, 5);
    expect(d.up(1, 80)).toBeNull();
    expect(d.up(2, 90)).toBe(2);
  });

  it("is not a tap once a finger moved past the threshold", () => {
    expect(tap(2, 120, TAP_MAX_DISTANCE)).toBe(2);
    expect(tap(2, 120, TAP_MAX_DISTANCE + 1)).toBeNull();
  });

  it("is not a tap when held too long", () => {
    expect(tap(2, TAP_MAX_DURATION - 1)).toBe(2);
    expect(tap(2, TAP_MAX_DURATION)).toBeNull();
  });

  it("a pinch that moved does not hand its count to the next stationary tap", () => {
    const d = createFingerTap();
    d.down(1, { x: 0, y: 0 }, 0);
    d.down(2, { x: 50, y: 0 }, 5);
    d.move(2, { x: 150, y: 0 });
    d.up(1, 100);
    expect(d.up(2, 110)).toBeNull();
    d.down(3, { x: 0, y: 0 }, 1000);
    expect(d.up(3, 1050)).toBeNull(); // one finger: nothing, not a leftover "2"
  });

  it("is spoiled by a Pencil or mouse involved in the contact (a palm resting mid-stroke)", () => {
    const d = createFingerTap();
    d.down(1, { x: 0, y: 0 }, 0);
    d.down(2, { x: 50, y: 0 }, 5);
    d.spoil();
    d.up(1, 80);
    expect(d.up(2, 90)).toBeNull();
    // The next contact starts clean.
    d.down(3, { x: 0, y: 0 }, 1000);
    d.down(4, { x: 50, y: 0 }, 1005);
    d.up(3, 1080);
    expect(d.up(4, 1090)).toBe(2);
  });

  it("a cancelled finger spoils the contact", () => {
    const d = createFingerTap();
    d.down(1, { x: 0, y: 0 }, 0);
    d.down(2, { x: 50, y: 0 }, 5);
    d.cancel(1);
    expect(d.up(2, 90)).toBeNull();
  });

  it("debounces a second report within 100 ms", () => {
    const d = createFingerTap();
    d.down(1, { x: 0, y: 0 }, 0);
    d.down(2, { x: 50, y: 0 }, 0);
    d.up(1, 50);
    expect(d.up(2, 60)).toBe(2);
    d.down(3, { x: 0, y: 0 }, 70);
    d.down(4, { x: 50, y: 0 }, 70);
    d.up(3, 120);
    expect(d.up(4, 130)).toBeNull();
  });

  it("ignores a lift or move for a finger it never saw", () => {
    const d = createFingerTap();
    d.move(9, { x: 500, y: 0 });
    expect(d.up(9, 10)).toBeNull();
  });
});
