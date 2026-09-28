import * as fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { IDENTITY } from "../geom/mat";
import { nodeBounds } from "../geom/bounds";
import { DEFAULT_STYLE, type PathShape, type TextMeta } from "../doc/document";
import {
  charHits,
  charQuads,
  familyHasItalic,
  familyLicense,
  familyWeights,
  fontAvailable,
  fontChoices,
  loadFace,
  loadFont,
  outlineText,
  registerGoogleFamily,
  setFontRegistryListener,
  type LoadedFont,
} from "../text/font";
import type { CachedFamily } from "../persist/font-cache";
import type { GoogleFamily } from "../text/google-catalogue";
import { previewOutline } from "../text/preview";

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
    // "A\nB": A is 0, the newline is 1, B is 2. The quad slot is not that index.
    expect(charHits(f, meta("A\nB")).map((h) => h.index)).toEqual([0, 2]);
  });

  it("places every character of a ligature pair", () => {
    expect(charQuads(f, meta("office"))).toHaveLength(6);
    expect(charQuads(f, meta("fi"))).toHaveLength(2);
  });

  it("keeps an override pointing at the character it was made for, across a newline", () => {
    // "A\nB": A is 0, the newline is 1, B is 2. An override on 2 must move B, not A.
    const plain = charQuads(f, meta("A\nB"));
    const moved = charQuads(f, meta("A\nB", { overrides: { 2: { dx: 40 } } }));
    expect(moved[0]).toEqual(plain[0]);
    expect(moved[1]).not.toEqual(plain[1]);
  });
});

describe("drawing avoids opentype.js's string shaping (2026-09-28)", () => {
  it("outlines through each glyph, never font.getPath", () => {
    // `font.getPath(text, …)` runs opentype.js's string shaping, which throws on many modern fonts
    // for multi-character strings (Lora: "lookupType: 6 - substFormat: 2 is not yet supported").
    // Drawing must not depend on it: a font whose getPath throws must still outline, identically.
    const expected = outlineText(f, meta("Tallinn"));
    const crashing = new Proxy(f.font, {
      get(target, prop, receiver) {
        if (prop === "getPath") {
          return () => {
            throw new Error(
              "substitutionType : 62 lookupType: 6 - substFormat: 2 is not yet supported",
            );
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const out = outlineText({ ...f, font: crashing }, meta("Tallinn"));
    expect(out).toEqual(expected);
  });
});

describe("Google families and variable-weight outlining (M20 §3)", () => {
  const read = (path: string): ArrayBuffer => {
    const b = fs.readFileSync(path);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const LORA = read("fixtures/Lora[wght].ttf");
  const ANTON = read("fixtures/Anton-Regular.ttf");

  const catalogue = (id: string, over: Partial<GoogleFamily> = {}): GoogleFamily => ({
    id,
    family: "Lora",
    category: "serif",
    license: "OFL-1.1",
    weights: [400, 500, 600, 700],
    italic: false,
    variable: true,
    ...over,
  });

  /** Upright only: the fixture has no italic, so this family has none either. */
  const lora: CachedFamily = {
    id: "gf:lora",
    family: catalogue("lora"),
    faces: [{ style: "normal", weight: 400, filename: "Lora[wght].ttf" }],
  };
  const loaderCalls: string[] = [];
  const loader = async (filename: string) => {
    loaderCalls.push(filename);
    return LORA;
  };

  let notified = 0;
  beforeAll(() => {
    setFontRegistryListener(() => notified++);
    registerGoogleFamily(lora, loader);
    setFontRegistryListener(null);
  });

  const lm = (text: string, over: Partial<TextMeta> = {}) =>
    meta(text, { font: "gf:lora", ...over });
  const width = (hits: { quad: { x: number }[] }[]) =>
    Math.max(...hits.flatMap((h) => h.quad.map((p) => p.x))) -
    Math.min(...hits.flatMap((h) => h.quad.map((p) => p.x)));

  it("registers the family: available, in the menu by name, listener notified", () => {
    expect(notified).toBe(1);
    expect(fontAvailable("gf:lora")).toBe(true);
    expect(fontAvailable("gf:nope")).toBe(false);
    expect(fontChoices()).toContainEqual({ id: "gf:lora", label: "Lora" });
  });

  it("answers weights, italic and licence from the registry", () => {
    expect(familyWeights("gf:lora")).toEqual([400, 500, 600, 700]);
    expect(familyWeights("anton")).toEqual([400]);
    expect(familyHasItalic("gf:lora")).toBe(false);
    expect(familyHasItalic("anton")).toBe(false);
    expect(familyLicense("gf:lora")).toBe("OFL-1.1");
    expect(familyLicense("anton")).toBeNull();
  });

  it("loads a variable face with its weight axis range, parsed once", async () => {
    const a = await loadFace({ font: "gf:lora" });
    const b = await loadFace({ font: "gf:lora", weight: 700 });
    expect(a.wght).toEqual({ min: 400, max: 700 });
    expect(a.label).toBe("Lora");
    expect(a.id).toBe("gf:lora");
    expect(b).toBe(a); // one variable file covers every weight
    expect(await loadFont("gf:lora")).toBe(a);
    expect(loaderCalls).toEqual(["Lora[wght].ttf"]);
  });

  it("draws 700 heavier and wider than 400", async () => {
    const f = await loadFace({ font: "gf:lora" });
    const regular = outlineText(f, lm("Tallinn"));
    const bold = outlineText(f, lm("Tallinn", { weight: 700 }));
    expect(bold).not.toEqual(regular);
    expect(width(charHits(f, lm("Tallinn", { weight: 700 })))).toBeGreaterThan(
      width(charHits(f, lm("Tallinn"))),
    );
  });

  it("draws 400 the same before and after drawing 700", async () => {
    // opentype.js's `getTransform` overwrites the BASE glyph's advanceWidth, so reading base
    // glyphs after a transform would lay 400 out with 700's advances.
    const f = await loadFace({ font: "gf:lora" });
    const fresh = outlineText(f, lm("Sõna"));
    const freshHits = charHits(f, lm("Sõna"));
    outlineText(f, lm("Sõna", { weight: 700 }));
    expect(outlineText(f, lm("Sõna"))).toEqual(fresh);
    expect(charHits(f, lm("Sõna"))).toEqual(freshHits);
  });

  it("clamps a weight outside the axis to its range", async () => {
    const f = await loadFace({ font: "gf:lora" });
    expect(outlineText(f, lm("Ag", { weight: 900 }))).toEqual(
      outlineText(f, lm("Ag", { weight: 700 })),
    );
    expect(outlineText(f, lm("Ag", { weight: 100 }))).toEqual(outlineText(f, lm("Ag")));
  });

  it("puts each character's hit box around its outline at 700", async () => {
    const f = await loadFace({ font: "gf:lora" });
    const m = lm("MW", { weight: 700 });
    const hits = charHits(f, m);
    const regular = charHits(f, lm("MW"));
    expect(hits).not.toEqual(regular);
    // The second glyph's box starts where the first glyph's advance at 700 ends.
    const x1 = Math.max(...hits[0].quad.map((p) => p.x));
    expect(Math.min(...hits[1].quad.map((p) => p.x))).toBeCloseTo(x1, 6);
    // Each glyph outline sits inside its own box, give or take a small side bearing overhang.
    const one = (ch: string) => {
      const node: PathShape = {
        kind: "path",
        id: "t",
        transform: IDENTITY,
        style: DEFAULT_STYLE,
        subpaths: outlineText(f, lm(ch, { weight: 700 })),
      };
      return nodeBounds(node, IDENTITY)!;
    };
    const m0 = one("M");
    expect(m0.x).toBeGreaterThanOrEqual(-2);
    expect(m0.x + m0.w).toBeLessThanOrEqual(x1 + 2);
  });

  it("outlines an italic request upright when the family has no italic", async () => {
    const upright = await loadFace({ font: "gf:lora" });
    const asked = await loadFace({ font: "gf:lora", italic: true });
    expect(asked).toBe(upright);
    expect(outlineText(asked, lm("Tallinn", { italic: true }))).toEqual(
      outlineText(upright, lm("Tallinn")),
    );
  });

  it("loads the italic face's own file when the family has one", async () => {
    const calls: string[] = [];
    registerGoogleFamily(
      {
        id: "gf:lora-both",
        family: catalogue("lora-both", { italic: true }),
        faces: [
          { style: "normal", weight: 400, filename: "Lora[wght].ttf" },
          { style: "italic", weight: 400, filename: "Lora-Italic[wght].ttf" },
        ],
      },
      async (name) => {
        calls.push(name);
        return LORA;
      },
    );
    expect(familyHasItalic("gf:lora-both")).toBe(true);
    const up = await loadFace({ font: "gf:lora-both" });
    const ital = await loadFace({ font: "gf:lora-both", italic: true });
    expect(ital).not.toBe(up);
    expect(calls).toEqual(["Lora[wght].ttf", "Lora-Italic[wght].ttf"]);
  });

  it("draws a static Google face at its own design, with no synthetic bold", async () => {
    registerGoogleFamily(
      {
        id: "gf:anton",
        family: catalogue("anton", { family: "Anton", weights: [400], variable: false }),
        faces: [{ style: "normal", weight: 400, filename: "Anton-Regular.ttf" }],
      },
      async () => ANTON,
    );
    const g = await loadFace({ font: "gf:anton", weight: 700 });
    expect(g.wght).toBeUndefined();
    const plain = outlineText(f, meta("SLOP"));
    expect(outlineText(g, meta("SLOP", { font: "gf:anton", weight: 700 }))).toEqual(plain);
  });

  it("leaves a bundled font at weight 700 unchanged — no variation for non-Google fonts", () => {
    expect(f.wght).toBeUndefined();
    expect(outlineText(f, meta("SLOP", { weight: 700 }))).toEqual(outlineText(f, meta("SLOP")));
  });

  it("refuses an unregistered Google font as unavailable, not a download failure", async () => {
    await expect(loadFace({ font: "gf:missing" })).rejects.toThrow(/isn't loaded/);
  });

  it("surfaces the loader's download error and stays retryable", async () => {
    let fail = true;
    registerGoogleFamily(
      {
        id: "gf:flaky",
        family: catalogue("flaky"),
        faces: [{ style: "normal", weight: 400, filename: "Lora[wght].ttf" }],
      },
      async () => {
        if (fail) throw new Error("Couldn't download Lora — check your connection");
        return LORA;
      },
    );
    await expect(loadFace({ font: "gf:flaky" })).rejects.toThrow(/Couldn't download/);
    fail = false;
    expect((await loadFace({ font: "gf:flaky" })).wght).toEqual({ min: 400, max: 700 });
  });
});

describe("previewOutline", () => {
  it("outlines the family name over the sample, with bounds for the viewBox", () => {
    const p = previewOutline(f, "Anton");
    expect(p).not.toBeNull();
    expect(p!.d.startsWith("M")).toBe(true);
    // Two lines: the second baseline is a whole line (32px × 1.3) below the first.
    expect(p!.box.h).toBeGreaterThan(32 * 1.3);
    expect(p!.box.w).toBeGreaterThan(0);
  });
});
