import { describe, expect, it } from "vitest";
import type { Amounts } from "../text/attrs";
import {
  charTransform,
  IDENTITY_CHAR,
  isIdentityChar,
  newSeed,
  withOverride,
} from "../text/random";

const NONE: Amounts = { rotate: 0, scale: 0, offset: 0, skew: 0 };
const SOME: Amounts = { rotate: 12, scale: 0.08, offset: 4, skew: 6 };

describe("charTransform", () => {
  it("is deterministic", () => {
    expect(charTransform(418, 3, SOME)).toEqual(charTransform(418, 3, SOME));
  });

  it("gives each index its own jitter, independent of the others", () => {
    const five = charTransform(418, 5, SOME);
    // Asking for the earlier indices first must not change index 5 — a sequential PRNG would.
    for (let i = 0; i < 5; i++) charTransform(418, i, SOME);
    expect(charTransform(418, 5, SOME)).toEqual(five);
    expect(charTransform(418, 6, SOME)).not.toEqual(five);
  });

  it("gives a different seed a different result", () => {
    expect(charTransform(1, 3, SOME)).not.toEqual(charTransform(2, 3, SOME));
  });

  it("is the identity when every amount is zero", () => {
    for (let i = 0; i < 10; i++) {
      expect(charTransform(418, i, NONE)).toEqual(IDENTITY_CHAR);
      expect(isIdentityChar(charTransform(418, i, NONE))).toBe(true);
    }
  });

  it("stays inside the amount, and actually uses it", () => {
    let maxRot = 0;
    for (let i = 0; i < 200; i++) {
      const t = charTransform(7, i, SOME);
      expect(Math.abs(t.rotate)).toBeLessThanOrEqual(12);
      expect(Math.abs(t.scale - 1)).toBeLessThanOrEqual(0.08);
      expect(Math.abs(t.dy)).toBeLessThanOrEqual(4);
      maxRot = Math.max(maxRot, Math.abs(t.rotate));
    }
    expect(maxRot).toBeGreaterThan(9); // not merely bounded — the range is used
  });

  it("varies each property independently", () => {
    const rots = [];
    const scales = [];
    for (let i = 0; i < 200; i++) {
      const t = charTransform(7, i, { rotate: 1, scale: 1, offset: 1, skew: 1 });
      rots.push(t.rotate);
      scales.push(t.scale - 1);
    }
    expect(rots).not.toEqual(scales);
  });

  it("jitters the baseline only — dx is for a hand override", () => {
    for (let i = 0; i < 20; i++) expect(charTransform(418, i, SOME).dx).toBe(0);
    expect(charTransform(418, 1, SOME).dy).not.toBe(0);
  });
});

describe("withOverride", () => {
  it("replaces per property and leaves the rest of the roll alone", () => {
    const t = charTransform(418, 2, SOME);
    const o = withOverride(t, { r: -12, dx: 4 });
    expect(o.rotate).toBe(-12);
    expect(o.dx).toBe(4);
    expect(o.scale).toBe(t.scale);
    expect(o.dy).toBe(t.dy);
    expect(o.skew).toBe(t.skew);
  });

  it("returns the roll untouched when there is no override", () => {
    const t = charTransform(418, 2, SOME);
    expect(withOverride(t, undefined)).toBe(t);
  });
});

describe("newSeed", () => {
  it("is a non-negative 32-bit integer", () => {
    for (let i = 0; i < 50; i++) {
      const s = newSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(0x100000000);
    }
  });
});
