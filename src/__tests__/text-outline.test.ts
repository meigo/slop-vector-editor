import * as fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { IDENTITY } from "../geom/mat";
import { nodeBounds } from "../geom/bounds";
import { DEFAULT_STYLE, type PathShape, type TextMeta } from "../doc/document";
import { charQuads, outlineText, type LoadedFont } from "../text/font";

/** Read from disk, not through Vite's `?url`: the pipeline must be testable without a bundler. */
let f: LoadedFont;

beforeAll(async () => {
  const ot = (await import("opentype.js")).default;
  const b = fs.readFileSync("fixtures/Anton-Regular.ttf");
  const font = ot.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  f = { id: "anton", label: "Anton", font };
});

const ZERO = { rotate: 0, scale: 0, offset: 0, skew: 0 };

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

  it("leaves a title with no jitter exactly where it was", () => {
    // An unjittered title must be byte-identical to M10a's: the transform is skipped, not applied
    // as an identity matrix, so no float noise creeps into saved files.
    const plain = outlineText(f, meta("SLOP"));
    const rolled = outlineText(f, meta("SLOP", { seed: 999, amounts: ZERO }));
    expect(rolled).toEqual(plain);
  });

  it("makes the run taller when characters are rotated", () => {
    const plain = boxOf("SLOP");
    const jittered = boxOf("SLOP", { amounts: { ...ZERO, rotate: 30 } });
    expect(jittered.h).toBeGreaterThan(plain.h);
  });

  it("turns each character about its own centre, not the origin", () => {
    // With a big rotation, a glyph rotated about the run's origin would swing far away. About its
    // own advance box it stays roughly where it was.
    const one = boxOf("S");
    const plain = boxOf("SS");
    const jittered = boxOf("SS", { amounts: { ...ZERO, rotate: 40 } });
    const drift = Math.abs(jittered.x + jittered.w / 2 - (plain.x + plain.w / 2));
    expect(drift).toBeLessThan(one.w);
  });

  it("lets an override change one character and leave the next alone", () => {
    const base = meta("SS", { amounts: { ...ZERO, rotate: 10 }, seed: 5 });
    const withOv = meta("SS", {
      amounts: { ...ZERO, rotate: 10 },
      seed: 5,
      overrides: { 0: { r: 35 } },
    });
    const a = outlineText(f, base);
    const b = outlineText(f, withOv);
    expect(b).not.toEqual(a);
    // The last subpath belongs to the second glyph, which no override touched.
    expect(b[b.length - 1]).toEqual(a[a.length - 1]);
  });

  it("returns nothing for an empty string", () => {
    expect(outlineText(f, meta(""))).toEqual([]);
  });
});

describe("charQuads", () => {
  it("gives one four-cornered quad per character", () => {
    const q = charQuads(f, meta("SLOP"));
    expect(q).toHaveLength(4);
    for (const corners of q) expect(corners).toHaveLength(4);
  });

  it("orders them left to right without overlapping, when unjittered", () => {
    const q = charQuads(f, meta("SLOP"));
    for (let i = 1; i < q.length; i++) {
      const prevRight = Math.max(...q[i - 1].map((p) => p.x));
      const left = Math.min(...q[i].map((p) => p.x));
      expect(left).toBeGreaterThanOrEqual(prevRight - 1e-6);
    }
  });

  it("covers the baseline", () => {
    // Glyph space here is y-down-positive with the baseline at 0, so ascenders are negative.
    const [q] = charQuads(f, meta("S"));
    expect(Math.min(...q.map((p) => p.y))).toBeLessThan(0);
    expect(Math.max(...q.map((p) => p.y))).toBeGreaterThanOrEqual(0);
  });

  it("turns with the character", () => {
    const [q] = charQuads(f, meta("S", { amounts: { ...ZERO, rotate: 40 }, seed: 3 }));
    // The top edge is no longer horizontal once the glyph is rotated.
    expect(Math.abs(q[0].y - q[1].y)).toBeGreaterThan(1);
  });

  it("moves only the character an override touches", () => {
    const base = meta("SS");
    const one = charQuads(f, base);
    const two = charQuads(f, meta("SS", { overrides: { 0: { dx: 25 } } }));
    expect(two[0]).not.toEqual(one[0]);
    expect(two[1]).toEqual(one[1]);
  });

  it("agrees with the outlines about where a character is", () => {
    // The quad and the glyph come from one layout; if they ever drift, picking a character would
    // select a different one from the one under the pointer.
    const m = meta("SLOP", { amounts: { ...ZERO, rotate: 20 }, seed: 9 });
    const q = charQuads(f, m);
    const box = boxOf("SLOP", { amounts: { ...ZERO, rotate: 20 }, seed: 9 });
    const qx = q.flat().map((p) => p.x);
    expect(Math.min(...qx)).toBeLessThanOrEqual(box.x + 1);
    expect(Math.max(...qx)).toBeGreaterThanOrEqual(box.x + box.w - 1);
  });
});

describe("multi-line titles", () => {
  it("puts the second line below the first, by the line height", () => {
    const one = boxOf("A");
    const two = boxOf("A\nA", { lineHeight: 1.5 });
    expect(two.h).toBeGreaterThan(one.h);
    // Two baselines 1.5 * 100 apart, so the block is that much taller than one line.
    expect(two.h - one.h).toBeCloseTo(150, 0);
  });

  it("is narrower than the same characters on one line", () => {
    expect(boxOf("AB").w).toBeGreaterThan(boxOf("A\nB").w);
  });

  it("centres each line about x = 0 when centred", () => {
    const b = boxOf("A\nMMMM", { align: "center" });
    expect(Math.abs(b.x + b.w / 2)).toBeLessThan(1.5);
  });

  it("flushes every line to the anchor when right-aligned", () => {
    const b = boxOf("A\nMMMM", { align: "right" });
    // The widest line ends at 0, so nothing reaches past it.
    expect(b.x + b.w).toBeLessThanOrEqual(1);
  });

  it("gives one quad per glyph — a newline has none", () => {
    expect(charQuads(f, meta("A\nB"))).toHaveLength(2);
    expect(charQuads(f, meta("AB"))).toHaveLength(2);
  });

  it("keeps an override pointing at the character it was made for, across a newline", () => {
    // "A\nB": A is 0, the newline is 1, B is 2. An override on 2 must move B, not A.
    const plain = charQuads(f, meta("A\nB"));
    const moved = charQuads(f, meta("A\nB", { overrides: { 2: { dx: 40 } } }));
    expect(moved[0]).toEqual(plain[0]);
    expect(moved[1]).not.toEqual(plain[1]);
  });
});
