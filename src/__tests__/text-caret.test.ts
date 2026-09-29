import * as fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { TextMeta } from "../doc/document";
import { caretStops, type LoadedFont } from "../text/font";

let f: LoadedFont;

beforeAll(async () => {
  const ot = (await import("opentype.js")).default;
  const b = fs.readFileSync("fixtures/Anton-Regular.ttf");
  const font = ot.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  f = { id: "anton", label: "Anton", font };
});

const meta = (text: string, over: Partial<TextMeta> = {}): TextMeta => ({
  text,
  font: "anton",
  size: 100,
  letterSpacing: 0,
  lineHeight: 1.2,
  align: "left",
  seed: 1,
  amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
  overrides: {},
  ...over,
});

describe("caretStops", () => {
  it("has one stop per index plus the end, first at the pen", () => {
    const s = caretStops(f, meta("AB"));
    expect(s).toHaveLength(3);
    expect(s[0].x).toBe(0);
    expect(s[1].x).toBeGreaterThan(0);
    expect(s[2].x).toBeGreaterThan(s[1].x);
    expect(new Set(s.map((q) => q.line))).toEqual(new Set([0]));
  });
  it("puts an empty line and a trailing newline on their own lines at x 0", () => {
    const s = caretStops(f, meta("A\n\nB\n"));
    expect(s.map((q) => q.line)).toEqual([0, 0, 1, 2, 2, 3]);
    expect(s[2].x).toBe(0);
    expect(s[5].x).toBe(0);
    expect(s[3].baseline).toBeCloseTo(2 * 1.2 * 100);
  });
  it("follows alignment: a right-aligned line ends at 0", () => {
    const s = caretStops(f, meta("AB", { align: "right" }));
    expect(s[2].x).toBeCloseTo(0);
    expect(s[0].x).toBeLessThan(0);
  });
  it("ignores the randomiser (stops are un-jittered)", () => {
    const a = caretStops(f, meta("AB"));
    const b = caretStops(
      f,
      meta("AB", { amounts: { rotate: 30, scale: 20, offset: 10, skew: 10 } }),
    );
    expect(b).toEqual(a);
  });
});
