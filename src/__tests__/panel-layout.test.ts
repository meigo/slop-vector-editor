import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_PX,
  MIN_SIDEBAR_PX,
  resizedSidebarWidth,
} from "../lib/panel-layout";

describe("clampSidebarWidth", () => {
  it("leaves a width that is already in range", () => {
    expect(clampSidebarWidth(320, 1600)).toBe(320);
  });

  it("raises a width below the minimum", () => {
    expect(clampSidebarWidth(40, 1600)).toBe(MIN_SIDEBAR_PX);
  });

  it("caps a width at half the viewport", () => {
    expect(clampSidebarWidth(1400, 1600)).toBe(800);
  });

  it("lets the minimum win over the ceiling on a narrow window", () => {
    // 300px wide: half is 150, below the floor. The panel keeps its 200 and the canvas loses the
    // room — the canvas can be panned and zoomed, and a 150px properties panel cannot be read.
    expect(clampSidebarWidth(240, 300)).toBe(MIN_SIDEBAR_PX);
  });

  it("rounds to whole pixels", () => {
    expect(clampSidebarWidth(320.6, 1600)).toBe(321);
  });

  it("falls back to the default for a non-finite width", () => {
    expect(clampSidebarWidth(Number.NaN, 1600)).toBe(DEFAULT_SIDEBAR_PX);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY, 1600)).toBe(DEFAULT_SIDEBAR_PX);
  });

  it("enforces only the floor when the viewport is unknown", () => {
    expect(clampSidebarWidth(5000, Number.NaN)).toBe(MIN_SIDEBAR_PX);
  });
});

describe("resizedSidebarWidth", () => {
  it("widens as the pointer travels left, because the sidebar is docked right", () => {
    expect(resizedSidebarWidth(240, 1000, 900, 1600)).toBe(340);
  });

  it("narrows as the pointer travels right", () => {
    expect(resizedSidebarWidth(340, 1000, 1060, 1600)).toBe(280);
  });

  it("clamps at both ends of a drag", () => {
    expect(resizedSidebarWidth(240, 1000, 1400, 1600)).toBe(MIN_SIDEBAR_PX);
    expect(resizedSidebarWidth(240, 1000, 0, 1600)).toBe(800);
  });

  it("is computed from the pointer-down snapshot, not accumulated", () => {
    // The same pointer position gives the same width however many moves preceded it, so a dropped
    // move event cannot make the width drift away from the pointer.
    const once = resizedSidebarWidth(240, 1000, 880, 1600);
    for (let x = 999; x > 880; x -= 7) resizedSidebarWidth(240, 1000, x, 1600);
    expect(resizedSidebarWidth(240, 1000, 880, 1600)).toBe(once);
  });
});
