import * as fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { IDENTITY } from "../geom/mat";
import { nodeBounds } from "../geom/bounds";
import { DEFAULT_STYLE, type PathShape, type TextMeta } from "../doc/document";
import { outlineText, type LoadedFont } from "../text/font";

/** Read from disk, not through Vite's `?url`: the pipeline must be testable without a bundler. */
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
  align: "left",
  seed: 1,
  amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
  overrides: {},
  ...over,
});

const boxOf = (text: string, over: Partial<TextMeta> = {}) => {
  const node: PathShape = {
    kind: "path",
    id: "t",
    transform: IDENTITY,
    style: DEFAULT_STYLE,
    subpaths: outlineText(f, meta(text, over)),
  };
  return nodeBounds(node, IDENTITY)!;
};

describe("outlineText", () => {
  it("outlines a glyph", () => {
    const sps = outlineText(f, meta("S"));
    expect(sps.length).toBeGreaterThanOrEqual(1);
    expect(sps[0].nodes.length).toBeGreaterThan(2);
  });

  it("gives O two contours, so its counter is a hole under nonzero fill", () => {
    expect(outlineText(f, meta("O"))).toHaveLength(2);
  });

  it("emits cubics only — the font's quadratics are converted on the way in", () => {
    for (const sp of outlineText(f, meta("SLOP"))) {
      for (const n of sp.nodes) {
        expect(Number.isFinite(n.p.x) && Number.isFinite(n.p.y)).toBe(true);
      }
    }
    // parsePathData is the converter; a Q surviving would show up as a node with no handles
    // between two curved segments, which the bounds test below would also catch.
    expect(outlineText(f, meta("S")).some((sp) => sp.nodes.some((n) => n.out !== null))).toBe(true);
  });

  it("places the second glyph to the right of the first", () => {
    const one = boxOf("S");
    const two = boxOf("SS");
    expect(two.x + two.w).toBeGreaterThan(one.x + one.w);
  });

  it("centres the run about x = 0 when asked", () => {
    const b = boxOf("SLOP", { align: "center" });
    expect(Math.abs(b.x + b.w / 2)).toBeLessThan(1.5);
  });

  it("scales linearly with size", () => {
    const a = boxOf("SLOP", { size: 50 });
    const b = boxOf("SLOP", { size: 100 });
    expect(b.w / a.w).toBeCloseTo(2, 2);
  });

  it("returns nothing for an empty string", () => {
    expect(outlineText(f, meta(""))).toEqual([]);
  });
});
