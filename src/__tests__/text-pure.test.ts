import { describe, expect, it } from "vitest";
import { layoutRun, splitLines } from "../text/layout";
import {
  formatOverrides,
  formatTextOpts,
  parseOverrides,
  parseTextOpts,
  type TextOpts,
} from "../text/attrs";
import { withItalic, withWeight, type TextMeta } from "../doc/document";

const opts: TextOpts = {
  size: 96,
  letterSpacing: 2.5,
  lineHeight: 1.2,
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

  it("still reads a file written before line heights existed", () => {
    // THE regression guard for M10d. `data-sv-text-opts` had eight fields; demanding nine would
    // turn every title already saved into a plain path with its text gone.
    const old = parseTextOpts("96 2.5 center 418 12 0.08 4 0");
    expect(old).not.toBeNull();
    expect(old?.lineHeight).toBe(1.2);
    expect(old?.size).toBe(96);
    expect(old?.align).toBe("center");
  });

  it("round-trips a line height when the file has one", () => {
    const nine = parseTextOpts("96 2.5 center 418 12 0.08 4 0 1.65");
    expect(nine?.lineHeight).toBe(1.65);
    expect(formatTextOpts(nine!).split(" ")).toHaveLength(9);
  });

  it("refuses a line height that is absent-but-malformed, or the wrong field count", () => {
    expect(parseTextOpts("96 2.5 center 418 12 0.08 4 0 0")).toBeNull();
    expect(parseTextOpts("96 2.5 center 418 12 0.08 4 0 -1")).toBeNull();
    expect(parseTextOpts("96 2.5 center 418 12 0.08 4 0 x")).toBeNull();
    expect(parseTextOpts("96 2.5 center 418 12 0.08 4")).toBeNull();
    expect(parseTextOpts("96 2.5 center 418 12 0.08 4 0 1.2 9")).toBeNull();
  });

  it("accepts a full 32-bit seed — it is an id, not a length", () => {
    // Regression: `newSeed()` returns up to 2^32, and measuring it against the coordinate ceiling
    // rejected the attribute, so every title with a large seed reloaded as an ordinary path.
    const o = parseTextOpts("96 0 left 4294967295 12 0.08 4 0");
    expect(o?.seed).toBe(4294967295);
    expect(parseTextOpts("96 0 left 4294967296 12 0.08 4 0")).toBeNull();
    expect(parseTextOpts("96 0 left -1 12 0.08 4 0")).toBeNull();
    expect(parseTextOpts("96 0 left 1.5 12 0.08 4 0")).toBeNull();
  });

  it("refuses numbers big enough to overflow the writer (invariant 8's ceiling)", () => {
    expect(parseTextOpts("1e300 0 left 1 0 0 0 0")).toBeNull();
    expect(parseTextOpts("96 -1e200 left 1 0 0 0 0")).toBeNull();
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

describe("splitLines", () => {
  it("keeps each line's index into the whole string, newline included", () => {
    expect(splitLines("AB\nCD")).toEqual([
      { text: "AB", start: 0 },
      { text: "CD", start: 3 },
    ]);
  });

  it("leaves a single line alone", () => {
    expect(splitLines("AB")).toEqual([{ text: "AB", start: 0 }]);
  });

  it("gives a trailing newline its empty final line", () => {
    expect(splitLines("A\n")).toEqual([
      { text: "A", start: 0 },
      { text: "", start: 2 },
    ]);
    expect(splitLines("\n")).toHaveLength(2);
  });

  it("counts by code point, so an astral character does not shift later indices", () => {
    // "\u{1D400}" is one character but two UTF-16 units; [...s] is what the layout iterates.
    expect(splitLines("\u{1D400}\nB")[1].start).toBe(2);
  });
});

describe("weight and italic in the text-opts attribute (M20 §4)", () => {
  it("stays nine fields at the defaults — byte-identical to a pre-M20 file", () => {
    // Written by M10d-M19 for `opts`; a default title must serialize to exactly this.
    expect(formatTextOpts(opts)).toBe("96 2.5 center 418 12 0.08 4 0 1.2");
    expect(formatTextOpts({ ...opts, weight: 400 })).toBe("96 2.5 center 418 12 0.08 4 0 1.2");
  });

  it("appends weight and italic as eleven fields once either is set", () => {
    expect(formatTextOpts({ ...opts, weight: 700 })).toBe(
      "96 2.5 center 418 12 0.08 4 0 1.2 700 0",
    );
    expect(formatTextOpts({ ...opts, italic: true })).toBe(
      "96 2.5 center 418 12 0.08 4 0 1.2 400 1",
    );
    expect(formatTextOpts({ ...opts, weight: 300, italic: true })).toBe(
      "96 2.5 center 418 12 0.08 4 0 1.2 300 1",
    );
  });

  it("round-trips eleven fields", () => {
    const o: TextOpts = { ...opts, weight: 700, italic: true };
    expect(parseTextOpts(formatTextOpts(o))).toEqual(o);
  });

  it("reads defaults written out in full as absent keys (invariant 39)", () => {
    const o = parseTextOpts("96 2.5 center 418 12 0.08 4 0 1.2 400 0")!;
    expect(o).not.toBeNull();
    expect("weight" in o).toBe(false);
    expect("italic" in o).toBe(false);
  });

  it("still reads eight and nine fields with no weight or italic keys", () => {
    for (const s of ["96 2.5 center 418 12 0.08 4 0", "96 2.5 center 418 12 0.08 4 0 1.65"]) {
      const o = parseTextOpts(s)!;
      expect("weight" in o).toBe(false);
      expect("italic" in o).toBe(false);
    }
  });

  it("refuses ten fields, a bad weight or a bad italic flag", () => {
    const base = "96 2.5 center 418 12 0.08 4 0 1.2";
    expect(parseTextOpts(`${base} 700`)).toBeNull();
    for (const w of ["0", "1001", "1.5", "-400", "x", "1e3.5"]) {
      expect(parseTextOpts(`${base} ${w} 0`)).toBeNull();
    }
    expect(parseTextOpts(`${base} 1 0`)).not.toBeNull();
    expect(parseTextOpts(`${base} 1000 0`)).not.toBeNull();
    for (const i of ["2", "-1", "true", "x"]) expect(parseTextOpts(`${base} 700 ${i}`)).toBeNull();
    expect(parseTextOpts(`${base} 700 0 1`)).toBeNull(); // 12 fields
  });
});

describe("withWeight / withItalic", () => {
  const m: TextMeta = {
    ...opts,
    text: "A",
    font: "gf:lora",
    overrides: {},
  };

  it("sets a non-default value and deletes the key at the default", () => {
    const bold = withWeight(m, 700);
    expect(bold.weight).toBe(700);
    const back = withWeight(bold, 400);
    expect("weight" in back).toBe(false);
    expect(back).toEqual(m);
    const ital = withItalic(m, true);
    expect(ital.italic).toBe(true);
    expect("italic" in withItalic(ital, false)).toBe(false);
  });

  it("returns the same reference when nothing changes (invariant 1)", () => {
    expect(withWeight(m, 400)).toBe(m);
    expect(withItalic(m, false)).toBe(m);
    const bold = withWeight(m, 700);
    expect(withWeight(bold, 700)).toBe(bold);
    const ital = withItalic(m, true);
    expect(withItalic(ital, true)).toBe(ital);
  });
});
