import { describe, expect, it } from "vitest";
import { dockDown, dockUp, latchOn, TAP_MS } from "../input/dock";

describe("modifier dock", () => {
  it("holds while pressed", () => {
    expect(dockDown("off", 1000)).toEqual({ state: "held", press: { before: "off", at: 1000 } });
    expect(dockDown("latched", 5)).toEqual({ state: "held", press: { before: "latched", at: 5 } });
  });

  it("latches on a tap and unlatches on the next tap", () => {
    expect(dockUp({ before: "off", at: 1000 }, 1000 + TAP_MS - 1)).toBe("latched");
    expect(dockUp({ before: "latched", at: 1000 }, 1100)).toBe("off");
  });

  it("releases after a hold", () => {
    expect(dockUp({ before: "off", at: 1000 }, 1000 + TAP_MS)).toBe("off");
    expect(dockUp({ before: "latched", at: 1000 }, 2000)).toBe("off");
  });

  it("reports whether a latch counts as pressed", () => {
    expect(latchOn("off")).toBe(false);
    expect(latchOn("held")).toBe(true);
    expect(latchOn("latched")).toBe(true);
  });
});
