import { describe, expect, it } from "vitest";
import {
  clampRatio,
  clearedOverride,
  HEADER_PX,
  MIN_BODY_PX,
  MIN_PANEL_PX,
  propsOpen,
  ratioFromDrag,
  STRIP_PX,
} from "../lib/split";

describe("clampRatio", () => {
  it("leaves a ratio that starves neither panel alone", () => {
    expect(clampRatio(0.55, 800, 120)).toBe(0.55);
  });

  it("clamps to the minimum body at each end", () => {
    expect(clampRatio(0.01, 800, 120)).toBeCloseTo(0.15, 10);
    expect(clampRatio(0.99, 800, 120)).toBeCloseTo(0.85, 10);
  });

  it("splits evenly when the body cannot hold two minimums", () => {
    expect(clampRatio(0.8, 200, 120)).toBe(0.5);
    expect(clampRatio(0.8, 240, 120)).toBe(0.5);
  });

  it("splits evenly rather than trusting a non-finite number", () => {
    expect(clampRatio(Number.NaN, 800, 120)).toBe(0.5);
    expect(clampRatio(0.55, Number.NaN, 120)).toBe(0.5);
  });

  it("offers a minimum a layer row can use", () => {
    expect(MIN_BODY_PX).toBe(120);
    expect(HEADER_PX).toBe(40);
    expect(STRIP_PX).toBe(12);
  });

  it("counts the header in the minimum, because flex distributes whole panels", () => {
    expect(MIN_PANEL_PX).toBe(160);
    // A 751px column shares 739px between the two panels. At either clamp the losing panel keeps
    // its 40px header AND a 120px body — clamping against the body alone left it 95px.
    const share = 751 - STRIP_PX;
    const low = clampRatio(0, share, MIN_PANEL_PX);
    const high = clampRatio(1, share, MIN_PANEL_PX);
    expect(low * share - HEADER_PX).toBeCloseTo(MIN_BODY_PX, 6);
    expect((1 - high) * share - HEADER_PX).toBeCloseTo(MIN_BODY_PX, 6);
  });
});

describe("ratioFromDrag", () => {
  // Properties sits BELOW the divider, and the ratio is its share: dragging down shrinks it.
  it("moves the ratio against the pointer's share of the body", () => {
    expect(ratioFromDrag(0.5, 80, 800, 120)).toBeCloseTo(0.4, 10);
    expect(ratioFromDrag(0.5, -80, 800, 120)).toBeCloseTo(0.6, 10);
  });

  it("clamps a drag that would starve either panel", () => {
    expect(ratioFromDrag(0.5, 1000, 800, 120)).toBeCloseTo(0.15, 10);
    expect(ratioFromDrag(0.5, -1000, 800, 120)).toBeCloseTo(0.85, 10);
  });

  it("cannot divide by a body of zero", () => {
    expect(ratioFromDrag(0.55, 40, 0, 120)).toBe(0.5);
  });
});

describe("propsOpen", () => {
  it("follows the selection until someone overrides it", () => {
    expect(propsOpen(null, false)).toBe(false);
    expect(propsOpen(null, true)).toBe(true);
    expect(propsOpen(true, false)).toBe(true);
    expect(propsOpen(false, true)).toBe(false);
  });
});

describe("clearedOverride", () => {
  it("drops a decision when the selection's emptiness flips", () => {
    expect(clearedOverride(true, true, false)).toBeNull();
    expect(clearedOverride(false, false, true)).toBeNull();
  });

  it("keeps the same value when nothing flipped, so the caller can skip the write", () => {
    expect(clearedOverride(true, true, true)).toBe(true);
    expect(clearedOverride(false, false, false)).toBe(false);
    expect(clearedOverride(null, false, false)).toBeNull();
  });
});
