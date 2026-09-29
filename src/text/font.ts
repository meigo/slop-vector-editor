/** The only module that may import `opentype.js`, and only through a dynamic import, so the parser
 *  stays a lazy chunk — 67.7 KB gzipped, measured in the M10 spike, against 0.14 KB added to the
 *  app's own chunk. Everything outside this file sees plain `Subpath[]`. */
import type { Subpath, TextMeta } from "../doc/document";
import { applyMat, multiply, rotate, scale, skewX, translate, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";
import { transformSubpaths } from "../geom/shapes";
import { parsePathData } from "../svg/pathdata";
import type { CachedFamily } from "../persist/font-cache";
import { BUNDLED } from "./fonts";
import { chooseFace, hasItalic } from "./google-fonts";
import { layoutRun, splitLines } from "./layout";
import type { CaretStop } from "./edit";
import { charTransform, isIdentityChar, withOverride, type CharTransform } from "./random";

type OT = (typeof import("opentype.js"))["default"];
type ParsedFont = import("opentype.js").Font;
type Glyph = import("opentype.js").Glyph;
type PathCommand = import("opentype.js").PathCommand;
type Path = import("opentype.js").Path;

/** `id` is the font id, not the face: every face of a family shares it. `wght` is the weight
 *  axis's range, present only on a variable Google face — the one kind that draws other weights. */
export type LoadedFont = {
  id: string;
  label: string;
  font: ParsedFont;
  wght?: { min: number; max: number };
};

/** Which face of a family to draw (spec M20 §3). Absent weight is 400, absent italic upright. */
export type FaceRequest = { font: string; weight?: number; italic?: boolean };

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

/** Parsed faces, keyed `${font id}|${filename}` for a Google face and `${font id}|bundled` for
 *  every other font (one face each). */
const loaded = new Map<string, LoadedFont>();
/** Fonts added this session. Not written into the document (spec M10 §5). */
const added = new Map<string, { label: string; buf: ArrayBuffer }>();
/** Google families (spec M20 §5), by `gf:` font id. The loader hands back a face file's bytes —
 *  from the cache or the network, which is the caller's business, so this module stays the only
 *  importer of opentype.js and never touches either. */
const google = new Map<
  string,
  { entry: CachedFamily; loader: (filename: string) => Promise<ArrayBuffer> }
>();
/** In-flight loads, so two callers for the same face share one fetch and one parse (invariant
 *  37's rule: cache the promise, clear it on rejection). */
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
  return google.has(id) || added.has(id) || BUNDLED.some((b) => b.id === id);
}

export function fontChoices(): { id: string; label: string }[] {
  return [
    ...BUNDLED.map((b) => ({ id: b.id, label: b.label })),
    // By family name alone: a Google family's id says where it came from, and its name is the
    // catalogue's, so it cannot be confused with a bundled face the way a file's can.
    ...[...google].map(([id, g]) => ({ id, label: g.entry.family.family })),
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

/** Registers a Google family for this session (spec M20 §5) and tells the listener. */
export function registerGoogleFamily(
  entry: CachedFamily,
  loader: (filename: string) => Promise<ArrayBuffer>,
): void {
  google.set(entry.id, { entry, loader });
  onRegistryChange?.();
}

/** The weights a family offers: a Google family's catalogue weights; any other font only
 *  Regular (spec M20 §1). */
export function familyWeights(fontId: string): number[] {
  return google.get(fontId)?.entry.family.weights ?? [400];
}

/** From the faces, not the catalogue flag: the faces are what `chooseFace` actually draws. */
export function familyHasItalic(fontId: string): boolean {
  const g = google.get(fontId);
  return g ? hasItalic(g.entry.faces) : false;
}

export function familyLicense(fontId: string): string | null {
  return google.get(fontId)?.entry.family.license ?? null;
}

export function loadFont(id: string): Promise<LoadedFont> {
  return loadFace({ font: id });
}

export async function loadFace(req: FaceRequest): Promise<LoadedFont> {
  const id = req.font;
  const g = google.get(id);
  const face = g ? chooseFace(g.entry.faces, req.weight ?? 400, req.italic ?? false) : null;
  const key = `${id}|${face ? face.filename : "bundled"}`;
  return loadOnce(key, () => (g && face ? loadGoogleFace(id, g, face.filename) : loadFontOnce(id)));
}

/** A Google family's regular face WITHOUT registering the family — the dialog's preview (spec
 *  M20 §6). Parsed into the same cache `loadFace` reads, so adding the family afterwards neither
 *  downloads nor parses it again. */
export async function previewFace(
  entry: CachedFamily,
  loader: (filename: string) => Promise<ArrayBuffer>,
): Promise<LoadedFont> {
  const face = chooseFace(entry.faces, 400, false);
  if (!face) throw new Error(`${entry.family.family} has no faces to draw`);
  return loadOnce(`${entry.id}|${face.filename}`, () =>
    loadGoogleFace(entry.id, { entry, loader }, face.filename),
  );
}

async function loadOnce(key: string, load: () => Promise<LoadedFont>): Promise<LoadedFont> {
  const already = loaded.get(key);
  if (already) return already;
  const inFlight = loading.get(key);
  if (inFlight) return inFlight;
  const p = load().then((entry) => {
    loaded.set(key, entry);
    return entry;
  });
  loading.set(key, p);
  try {
    return await p;
  } finally {
    loading.delete(key); // a failure must stay retryable
  }
}

async function loadGoogleFace(
  id: string,
  g: { entry: CachedFamily; loader: (filename: string) => Promise<ArrayBuffer> },
  filename: string,
): Promise<LoadedFont> {
  const o = await ot();
  const font = o.parse(await g.loader(filename));
  const axis = font.variation ? font.tables.fvar?.axes.find((a) => a.tag === "wght") : undefined;
  return {
    id,
    label: g.entry.family.family,
    font,
    ...(axis ? { wght: { min: axis.minValue, max: axis.maxValue } } : {}),
  };
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
  return { id, label: familyOf(font, label), font };
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
  loaded.set(`${id}|bundled`, { id, label, font });
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
type Placed = {
  char: string;
  index: number;
  penX: number;
  penY: number;
  advance: number;
  /** The glyph as drawn — at the title's weight on a variable face — so the outline and the
   *  advance the layout used come from one object. */
  glyph: Glyph;
};

/** The glyph at the title's weight. Only a variable Google face (`f.wght`) is instanced; every
 *  other font draws its one design exactly as before M20. A variable face is instanced at every
 *  weight, 400 included, because `getTransform` overwrites the base glyph's advance as a side
 *  effect: after drawing 700, the base glyph would lay 400 out with 700's advances. */
function drawnGlyph(f: LoadedFont, base: Glyph, weight: number | undefined): Glyph {
  if (!f.wght || !f.font.variation) return base;
  const wght = Math.min(f.wght.max, Math.max(f.wght.min, weight ?? 400));
  return f.font.variation.getTransform(base, { wght });
}

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
    // Weight changes advances as well as outlines (spec M20 §3). Kerning stays on the base
    // glyphs: `getKerningValue` reads glyph indices, which a variation does not change.
    const drawn = glyphs.map((g: Glyph) => drawnGlyph(f, g, m.weight));
    const advances = drawn.map((g: Glyph) => (g.advanceWidth ?? 0) / upm);
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
        glyph: drawn[i],
      });
    }
  });
  return { placed, font, upm };
}

/** The transform a character ends up with: the roll, with any hand override on top. */
function transformFor(m: TextMeta, i: number): CharTransform {
  return withOverride(charTransform(m.seed, i, m.amounts), m.overrides[i]);
}

/** A coordinate to 3 decimals, exactly as `toPathData(3)` rounded it where that worked — the
 *  fraction rounded through its decimal string, so a value on a …5 boundary lands where it always
 *  did and re-derived outlines match the ones already in documents — but never NaN: a fraction
 *  small enough to print in exponent form rounds to 0. Written with `toFixed`, so the string is
 *  never in exponent form, and never `-0`. */
function num(v: number): string {
  const whole = Math.floor(v);
  const frac = v - whole;
  const scaled = Math.round(Number(`${frac}e+3`));
  const r = whole + (Number.isFinite(scaled) ? Number(`${scaled}e-3`) : 0);
  if (r === 0) return "0";
  return Math.round(r) === r ? String(r) : r.toFixed(3);
}

/** The clean-up `toPathData` applied by default (opentype.js 2.0's `optimizeCommands`), kept
 *  exactly so outlines stay what they were: per contour, a closing `L` that lands within 1 unit of
 *  the start before `Z` is dropped (otherwise the closed subpath would end on a repeat of its first
 *  node, which invariant 30 forbids), an `L` repeating the previous point is dropped, and a contour
 *  written `M a, L …, L a, Z` starts from its second point instead. */
function optimizeCommands(commands: readonly PathCommand[]): PathCommand[] {
  const contours: PathCommand[][] = [[]];
  let startX = 0;
  let startY = 0;
  for (let i = 0; i < commands.length; i++) {
    const contour = contours[contours.length - 1];
    const cmd = { ...commands[i] };
    const first = contour[0];
    const second = contour[1];
    const previous = contour[contour.length - 1];
    const next = commands[i + 1];
    contour.push(cmd);
    if (cmd.type === "M") {
      startX = cmd.x!;
      startY = cmd.y!;
    } else if (cmd.type === "L" && (!next || next.type === "Z")) {
      if (!(Math.abs(cmd.x! - startX) > 1 || Math.abs(cmd.y! - startY) > 1)) contour.pop();
    } else if (cmd.type === "L" && previous && previous.x === cmd.x && previous.y === cmd.y) {
      contour.pop();
    } else if (cmd.type === "Z") {
      if (
        first?.type === "M" &&
        second?.type === "L" &&
        previous?.type === "L" &&
        previous.x === first.x &&
        previous.y === first.y
      ) {
        contour.shift();
        contour[0].type = "M";
      }
      if (i + 1 < commands.length) contours.push([]);
    }
  }
  return contours.flat();
}

/** A glyph path's commands as SVG path data. Never through opentype.js's `toPathData`: its
 *  rounding appends `"e+" + places` to the number's string form, and a coordinate whose fractional
 *  part is tiny already prints in exponent form ("1.2e-7"), so it parses "1.2e-7e+3" to NaN — and
 *  caches that NaN. `parsePathData` then drops the rest of the contour, so at some pen positions a
 *  letter lost most of its outline (Lora's "l" came out as a thin sliver). */
function pathDataOf(commands: readonly PathCommand[]): string {
  const parts: string[] = [];
  for (const c of optimizeCommands(commands)) {
    if (c.type === "Z") parts.push("Z");
    else if (c.type === "Q") parts.push(`Q${num(c.x1!)} ${num(c.y1!)} ${num(c.x!)} ${num(c.y!)}`);
    else if (c.type === "C") {
      parts.push(
        `C${num(c.x1!)} ${num(c.y1!)} ${num(c.x2!)} ${num(c.y2!)} ${num(c.x!)} ${num(c.y!)}`,
      );
    } else parts.push(`${c.type}${num(c.x!)} ${num(c.y!)}`);
  }
  return parts.join("");
}

/** string + font + options → outlines, in the title's own space with the first baseline at y = 0. */
export function outlineText(f: LoadedFont, m: TextMeta): Subpath[] {
  const { placed } = runLayout(f, m);
  const out: Subpath[] = [];
  for (const p of placed) {
    // Through the glyph, never `font.getPath(text, …)`: that runs opentype.js's string shaping,
    // which throws on many modern fonts once it sees two or more characters (Lora: "lookupType 6,
    // substFormat 2 is not yet supported"). One character at a time happened to be safe, but the
    // glyph route avoids that code entirely and is the one variable-font weights need (a variation
    // transforms a glyph, not a string). It is the very glyph the layout measured.
    const path = p.glyph.getPath(p.penX, p.penY, m.size);
    const d = pathDataOf(path.commands);
    // The outlines are quadratic; `parsePathData` already converts them to our cubics exactly.
    const glyph = parsePathData(d).filter((sp) => sp.nodes.length > 0);
    const t = transformFor(m, p.index);
    if (isIdentityChar(t)) {
      out.push(...glyph);
      continue;
    }
    const c = pivotOf(p, m, path, f.font);
    out.push(...transformSubpaths(glyph, charMatrix(t, c.x, c.y)));
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
    if (isIdentityChar(t)) return { index: p.index, quad: corners };
    const o = pivotOf(p, m, p.glyph.getPath(p.penX, p.penY, m.size), font);
    const matrix = charMatrix(t, o.x, o.y);
    const quad = corners.map((c) => applyMat(matrix, c));
    return { index: p.index, quad };
  });
}

/** A caret position for every string index, plus the end (spec M22 §2): `[...m.text].length + 1`
 *  stops. Un-jittered by design — the caret sits on the layout, not on the randomised glyphs. A
 *  newline's stop is the end of its line; an empty line sits at x 0. */
export function caretStops(f: LoadedFont, m: TextMeta): CaretStop[] {
  const { placed, font, upm } = runLayout(f, m);
  const top = (-font.ascender / upm) * m.size;
  const bottom = (-font.descender / upm) * m.size;
  const byIndex = new Map(placed.map((p) => [p.index, p]));
  const out: CaretStop[] = [];
  splitLines(m.text).forEach((line, lineNo) => {
    const baseline = lineNo * m.lineHeight * m.size;
    const n = [...line.text].length;
    const stop = (x: number): CaretStop => ({
      x,
      baseline,
      top: baseline + top,
      bottom: baseline + bottom,
      line: lineNo,
    });
    let end = 0;
    for (let k = 0; k < n; k++) {
      const p = byIndex.get(line.start + k);
      out.push(stop(p ? p.penX : end));
      if (p) end = p.penX + p.advance * m.size;
    }
    out.push(stop(end));
  });
  return out;
}

export function charQuads(f: LoadedFont, m: TextMeta): Vec[][] {
  return charHits(f, m).map((h) => h.quad);
}

/** The point every per-character transform turns, scales and skews about: the centre of the
 *  glyph's own outline bounds (2026-09-29). It was the advance box's centre ON THE BASELINE (spec
 *  M10 §4), so a rotated tall letter swung its top sideways into its neighbours and a scaled one
 *  grew upwards only. A glyph with no outline (a space) falls back to its advance box's centre —
 *  the middle of the box `charHits` tests clicks against. `advance` is in em units, so it scales
 *  with the size; the path is the glyph as drawn at this pen position and size. */
function pivotOf(p: Placed, m: TextMeta, path: Path, font: ParsedFont): Vec {
  const b = path.getBoundingBox();
  if ([b.x1, b.y1, b.x2, b.y2].every(Number.isFinite) && (b.x2 > b.x1 || b.y2 > b.y1)) {
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  }
  const upm = font.unitsPerEm;
  const mid = ((-font.ascender - font.descender) / 2 / upm) * m.size;
  return { x: p.penX + (p.advance * m.size) / 2, y: p.penY + mid };
}

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
