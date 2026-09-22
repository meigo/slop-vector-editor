/** The only module that may import `opentype.js`, and only through a dynamic import, so the parser
 *  stays a lazy chunk — 67.7 KB gzipped, measured in the M10 spike, against 0.14 KB added to the
 *  app's own chunk. Everything outside this file sees plain `Subpath[]`. */
import type { Subpath, TextMeta } from "../doc/document";
import { applyMat, multiply, rotate, scale, skewX, translate, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";
import { transformSubpaths } from "../geom/shapes";
import { parsePathData } from "../svg/pathdata";
import { BUNDLED } from "./fonts";
import { layoutRun, splitLines } from "./layout";
import { charTransform, isIdentityChar, withOverride, type CharTransform } from "./random";

type OT = (typeof import("opentype.js"))["default"];
type ParsedFont = import("opentype.js").Font;
type Glyph = import("opentype.js").Glyph;

export type LoadedFont = { id: string; label: string; font: ParsedFont };

export const FONT_EXTS = [".ttf", ".otf", ".woff"] as const;
export const WOFF2_REFUSAL = "Fonts in .woff2 can't be read here — use .ttf, .otf or .woff";

/** The ESM export is a default object, not a namespace: `import * as ot` has no `parse`. */
let otPromise: Promise<OT> | null = null;

async function ot(): Promise<OT> {
  if (!otPromise) {
    otPromise = import("opentype.js")
      .then((m) => m.default)
      // A failed fetch must not be replayed from our cache (M7's rule). The browser's module map
      // caches the failure too, so the notice tells the user to reload.
      .catch((e: unknown) => {
        otPromise = null;
        throw e;
      });
  }
  return otPromise;
}

const loaded = new Map<string, LoadedFont>();
/** Fonts added this session. Not written into the document (spec M10 §5). */
const added = new Map<string, { label: string; buf: ArrayBuffer }>();
/** In-flight loads, so two callers for the same id share one fetch and one parse (invariant 37's
 *  rule: cache the promise, clear it on rejection). */
const loading = new Map<string, Promise<LoadedFont>>();

/** Notified whenever `added` changes. This module stays free of runes so it can be unit-tested in
 *  node; the store owns the reactive counter. A plain `Map` is invisible to Svelte, so a `$derived`
 *  over `fontChoices()` computed once and never saw a font the user had just added — the dropdown
 *  showed a loaded font as "(not loaded)" until the panel happened to remount. */
let onRegistryChange: (() => void) | null = null;

export function setFontRegistryListener(fn: (() => void) | null): void {
  onRegistryChange = fn;
}

/** Whether a title using this font can still be re-typed. A **bundled** font is always available
 *  even before it has been fetched — it ships with the app, and `loadFont` will get it on demand.
 *  Only a font added from a file is unavailable, and only in a later session, because those are
 *  not written into the document (spec M10 §5).
 *
 *  Asking `isFontLoaded` here was a bug: after a reload nothing has been fetched yet, so every
 *  title in the file came back read-only until something happened to load its font. */
export function fontAvailable(id: string): boolean {
  return loaded.has(id) || added.has(id) || BUNDLED.some((b) => b.id === id);
}

export function fontChoices(): { id: string; label: string }[] {
  return [
    ...BUNDLED.map((b) => ({ id: b.id, label: b.label })),
    // Marked, because a font you added often has the same family name as a bundled one and two
    // identical entries in the list tell you nothing about which is which.
    ...[...added].map(([id, v]) => ({ id, label: `${v.label} (added)` })),
  ];
}

/** The spike found `font.names.fontFamily` undefined for Anton: the name lives under a platform. */
function familyOf(font: ParsedFont, fallback: string): string {
  const n = font.names as Record<string, { fontFamily?: Record<string, string> }>;
  return (
    n.windows?.fontFamily?.en ??
    n.macintosh?.fontFamily?.en ??
    n.unicode?.fontFamily?.en ??
    fallback
  );
}

export async function loadFont(id: string): Promise<LoadedFont> {
  const already = loaded.get(id);
  if (already) return already;
  const inFlight = loading.get(id);
  if (inFlight) return inFlight;
  const p = loadFontOnce(id).catch((e: unknown) => {
    loading.delete(id); // a failure must stay retryable
    throw e;
  });
  loading.set(id, p);
  try {
    return await p;
  } finally {
    loading.delete(id);
  }
}

async function loadFontOnce(id: string): Promise<LoadedFont> {
  const o = await ot();
  const mine = added.get(id);
  let buf: ArrayBuffer;
  let label: string;
  if (mine) {
    buf = mine.buf;
    label = mine.label;
  } else {
    const b = BUNDLED.find((f) => f.id === id);
    if (!b) throw new FontUnavailableError(`The font "${id}" isn't loaded in this session.`);
    const res = await fetch(b.url);
    if (!res.ok) throw new Error(`Could not load the font "${b.label}"`);
    buf = await res.arrayBuffer();
    label = b.label;
  }
  const font = o.parse(buf);
  const entry = { id, label: familyOf(font, label), font };
  loaded.set(id, entry);
  return entry;
}

export class Woff2Error extends Error {}

/** The font was never registered in this session — a session font from a previous one. Nothing was
 *  downloaded, so telling the user to reload would be false. */
export class FontUnavailableError extends Error {}

/** Registers a font file for this session and returns its id. */
export async function registerFontFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".woff2")) throw new Woff2Error(WOFF2_REFUSAL);
  if (!FONT_EXTS.some((e) => name.endsWith(e))) {
    throw new Error(`"${file.name}" isn't a font — use .ttf, .otf or .woff`);
  }
  const o = await ot();
  const buf = await file.arrayBuffer();
  const font = o.parse(buf); // throws on anything unparseable, including a mislabelled .woff2
  const label = familyOf(font, file.name.replace(/\.[^.]+$/, ""));
  const id = `file:${label}`;
  added.set(id, { label, buf });
  loaded.set(id, { id, label, font });
  onRegistryChange?.();
  return id;
}

/** Scripts this layout cannot set correctly (spec M10 §9), for two different reasons:
 *
 *  - **Joining and reordering** — Arabic, Syriac, Thaana, N'Ko and the Indic and South-East Asian
 *    scripts need shaping that opentype.js does not do (it gives outlines and legacy kerning, not
 *    HarfBuzz), so the glyphs would come out detached and in the wrong order.
 *  - **Right-to-left** — Hebrew joins nothing, but `layoutRun` walks strictly left to right, so a
 *    Hebrew title would come out reversed.
 *
 *  Either way the result would be wrong rather than merely plain, so it is refused. Script escapes
 *  are used instead of code-point ranges: the ranges tripped `no-misleading-character-class`,
 *  because several of them contain combining marks that a character class treats as separate. */
const UNSHAPED =
  /\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Syriac}|\p{Script=Thaana}|\p{Script=Nko}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Gurmukhi}|\p{Script=Gujarati}|\p{Script=Oriya}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Sinhala}|\p{Script=Thai}|\p{Script=Lao}|\p{Script=Khmer}|\p{Script=Myanmar}/u;

export function unshapedScript(text: string): boolean {
  return UNSHAPED.test(text);
}

/** True when the font has no glyph for any character — every index is `.notdef`. Drawing that gives
 *  a row of boxes or nothing at all, which spec §9's principle says to refuse rather than draw. */
export function noGlyphsFor(f: LoadedFont, text: string): boolean {
  const chars = [...text].filter((c) => c !== "\n");
  if (chars.length === 0) return false;
  return chars.every((c) => f.font.charToGlyph(c).index === 0);
}

/** One placed glyph. `index` is into the whole string, newlines included, so overrides survive.
 *  Newlines themselves never appear here — they have no glyph. */
type Placed = { char: string; index: number; penX: number; penY: number; advance: number };

/** The shared layout behind both `outlineText` and `charQuads`, so a character's outline and its
 *  hit box can never disagree about where it is.
 *
 *  Alignment across lines needs no new arithmetic: applying the per-line rule to every line aligns
 *  the block on its own. With `left` every line starts at 0, with `center` every line is centred on
 *  0, with `right` every line ends at 0 — so the block is aligned because each line is. */
function runLayout(
  f: LoadedFont,
  m: TextMeta,
): { placed: Placed[]; font: ParsedFont; upm: number } {
  const font = f.font;
  const upm = font.unitsPerEm;
  const placed: Placed[] = [];
  const lines = splitLines(m.text);
  lines.forEach((line, lineNo) => {
    const chars = [...line.text];
    if (chars.length === 0) return;
    // One glyph per code point. `stringToGlyphs` applies `liga`, so "office" in Anton is four
    // glyphs and the loop below would drop `c` and `e`.
    const glyphs = chars.map((ch) => font.charToGlyph(ch));
    const advances = glyphs.map((g: Glyph) => (g.advanceWidth ?? 0) / upm);
    const kerns = glyphs.map((g: Glyph, i: number) =>
      i === 0 ? 0 : font.getKerningValue(glyphs[i - 1], g) / upm,
    );
    const { pen } = layoutRun(advances, kerns, m.size, m.letterSpacing, m.align);
    const penY = lineNo * m.lineHeight * m.size;
    for (let i = 0; i < chars.length && i < pen.length; i++) {
      placed.push({
        char: chars[i],
        index: line.start + i,
        penX: pen[i],
        penY,
        advance: advances[i] ?? 0,
      });
    }
  });
  return { placed, font, upm };
}

/** The transform a character ends up with: the roll, with any hand override on top. */
function transformFor(m: TextMeta, i: number): CharTransform {
  return withOverride(charTransform(m.seed, i, m.amounts), m.overrides[i]);
}

/** string + font + options → outlines, in the title's own space with the first baseline at y = 0. */
export function outlineText(f: LoadedFont, m: TextMeta): Subpath[] {
  const { placed, font } = runLayout(f, m);
  const out: Subpath[] = [];
  for (const p of placed) {
    const d = font.getPath(p.char, p.penX, p.penY, m.size).toPathData(3);
    // The outlines are quadratic; `parsePathData` already converts them to our cubics exactly.
    const glyph = parsePathData(d).filter((sp) => sp.nodes.length > 0);
    const t = transformFor(m, p.index);
    if (isIdentityChar(t)) {
      out.push(...glyph);
      continue;
    }
    out.push(...transformSubpaths(glyph, charMatrix(t, centreOf(p, m.size), p.penY)));
  }
  return out;
}

/** A glyph's hit box plus the string index it belongs to. The quad list skips newlines, so the
 *  slot in that list is not the override key. */
export type CharHit = { index: number; quad: Vec[] };

/** Each glyph's advance box, jittered like its outline, in the title's own space — four corners,
 *  clockwise from the top left. This is what a click is tested against (spec M10 §6). One per
 *  **glyph**, so a newline contributes none. */
export function charHits(f: LoadedFont, m: TextMeta): CharHit[] {
  const { placed, font, upm } = runLayout(f, m);
  const top = (-font.ascender / upm) * m.size;
  const bottom = (-font.descender / upm) * m.size;
  return placed.map((p) => {
    const x1 = p.penX + p.advance * m.size;
    const corners: Vec[] = [
      { x: p.penX, y: p.penY + top },
      { x: x1, y: p.penY + top },
      { x: x1, y: p.penY + bottom },
      { x: p.penX, y: p.penY + bottom },
    ];
    const t = transformFor(m, p.index);
    const quad = isIdentityChar(t)
      ? corners
      : corners.map((c) => applyMat(charMatrix(t, centreOf(p, m.size), p.penY), c));
    return { index: p.index, quad };
  });
}

export function charQuads(f: LoadedFont, m: TextMeta): Vec[][] {
  return charHits(f, m).map((h) => h.quad);
}

/** The centre of a glyph's own advance box, on its own baseline — the anchor every per-character
 *  transform turns about (spec M10 §4). `advance` is in em units, so it scales with the size. */
const centreOf = (p: Placed, size: number): number => p.penX + (p.advance * size) / 2;

const RAD = Math.PI / 180;

/** Baked into the outlines, never carried as a matrix (invariant 40): that is what lets booleans,
 *  the node tool and a future warp treat a title as ordinary artwork. */
function charMatrix(t: CharTransform, cx: number, cy: number): Mat {
  return multiply(
    translate(cx + t.dx, cy + t.dy),
    multiply(
      rotate(t.rotate * RAD),
      multiply(skewX(t.skew * RAD), multiply(scale(t.scale), translate(-cx, -cy))),
    ),
  );
}
