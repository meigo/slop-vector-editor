import { describe, expect, it } from "vitest";
import { layoutRun } from "../text/layout";
import {
  formatOverrides,
  formatTextOpts,
  parseOverrides,
  parseTextOpts,
  type TextOpts,
} from "../text/attrs";

const opts: TextOpts = {
  size: 96,
  letterSpacing: 2.5,
  align: "center",
  seed: 418,
  amounts: { rotate: 12, scale: 0.08, offset: 4, skew: 0 },
};

describe("layoutRun", () => {
  it("places each glyph after the one before it", () => {
    expect(layoutRun([10, 20, 10], [0, 0, 0], 1, 0, "left")).toEqual({
      pen: [0, 10, 30],
      width: 40,
    });
  });

  it("pulls a pair together with a negative kern", () => {
    const { pen } = layoutRun([10, 20, 10], [0, -3, 0], 1, 0, "left");
    expect(pen).toEqual([0, 7, 27]);
  });

  it("adds letter-spacing between characters but not after the last", () => {
    const { pen, width } = layoutRun([10, 10], [0, 0], 1, 5, "left");
    expect(pen).toEqual([0, 15]);
    expect(width).toBe(25);
  });

  it("scales everything by size", () => {
    expect(layoutRun([10, 20], [0, 0], 2, 0, "left")).toEqual({ pen: [0, 20], width: 60 });
  });

  it("shifts the whole run to align it", () => {
    expect(layoutRun([10, 10], [0, 0], 1, 0, "left").pen).toEqual([0, 10]);
    expect(layoutRun([10, 10], [0, 0], 1, 0, "center").pen).toEqual([-10, 0]);
    expect(layoutRun([10, 10], [0, 0], 1, 0, "right").pen).toEqual([-20, -10]);
  });

  it("handles the empty run", () => {
    expect(layoutRun([], [], 96, 3, "center")).toEqual({ pen: [], width: 0 });
  });
});

describe("the text-opts attribute", () => {
  it("round-trips", () => {
    expect(parseTextOpts(formatTextOpts(opts))).toEqual(opts);
  });

  it("refuses numbers big enough to overflow the writer (invariant 8's ceiling)", () => {
    expect(parseTextOpts("1e300 0 left 1 0 0 0 0")).toBeNull();
    expect(parseTextOpts("96 -1e200 left 1 0 0 0 0")).toBeNull();
    expect(parseTextOpts("96 0 left 1e300 0 0 0 0")).toBeNull();
    expect(parseTextOpts("96 0 left 1 0 0 0 0")).not.toBeNull();
  });

  it("refuses anything malformed rather than guessing", () => {
    expect(parseTextOpts("")).toBeNull();
    expect(parseTextOpts("96 2.5 center 418 12 0.08 4")).toBeNull(); // 7 fields
    expect(parseTextOpts("96 2.5 sideways 418 12 0.08 4 0")).toBeNull();
    expect(parseTextOpts("96 x center 418 12 0.08 4 0")).toBeNull();
    expect(parseTextOpts("0 2.5 center 418 12 0.08 4 0")).toBeNull(); // size must be positive
  });
});

describe("the overrides attribute", () => {
  it("round-trips, sorted by index", () => {
    const o = { 7: { dx: 4 }, 3: { r: -12, s: 1.2 } };
    expect(formatOverrides(o)).toBe("3:r=-12,s=1.2;7:dx=4");
    expect(parseOverrides("3:r=-12,s=1.2;7:dx=4", 10)).toEqual(o);
  });

  it("is empty for an empty map", () => {
    expect(formatOverrides({})).toBe("");
    expect(parseOverrides("", 10)).toEqual({});
  });

  it("skips what it cannot use instead of throwing", () => {
    expect(parseOverrides("12:r=5", 10)).toEqual({}); // index past the string
    expect(parseOverrides("-1:r=5", 10)).toEqual({});
    expect(parseOverrides("2:zz=5", 10)).toEqual({}); // unknown key
    expect(parseOverrides("2:r=nope", 10)).toEqual({});
    expect(parseOverrides("garbage", 10)).toEqual({});
    expect(parseOverrides(":r=5", 10)).toEqual({}); // Number("") is 0 — must not land on char 0
    expect(parseOverrides("1.5:r=5", 10)).toEqual({});
    expect(parseOverrides("2:r=5;garbage;3:dy=1", 10)).toEqual({ 2: { r: 5 }, 3: { dy: 1 } });
  });
});
