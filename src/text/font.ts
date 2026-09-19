/** The only module that may import `opentype.js`, and only through a dynamic import, so the parser
 *  stays a lazy chunk — 67.7 KB gzipped, measured in the M10 spike, against 0.14 KB added to the
 *  app's own chunk. Everything outside this file sees plain `Subpath[]`. */
import type { Subpath, TextMeta } from "../doc/document";
import { parsePathData } from "../svg/pathdata";
import { BUNDLED } from "./fonts";
import { layoutRun } from "./layout";

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

/** Whether this font has already been fetched and parsed. Almost nothing should ask this — see
 *  `fontAvailable`, which is the question the UI actually has. */
export function isFontLoaded(id: string): boolean {
  return loaded.has(id);
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
    ...[...added].map(([id, v]) => ({ id, label: v.label })),
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
  const o = await ot();
  const mine = added.get(id);
  let buf: ArrayBuffer;
  let label: string;
  if (mine) {
    buf = mine.buf;
    label = mine.label;
  } else {
    const b = BUNDLED.find((f) => f.id === id);
    if (!b) throw new Error(`Unknown font "${id}"`);
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

/** string + font + options → outlines, in the title's own space with the baseline at y = 0.
 *  M10a applies no per-character transform; `seed`, `amounts` and `overrides` ride along unused
 *  and M10b adds that step here. */
export function outlineText(f: LoadedFont, m: TextMeta): Subpath[] {
  const chars = [...m.text];
  if (chars.length === 0) return [];
  const font = f.font;
  const upm = font.unitsPerEm;
  const glyphs = font.stringToGlyphs(m.text);
  const advances = glyphs.map((g: Glyph) => (g.advanceWidth ?? 0) / upm);
  const kerns = glyphs.map((g: Glyph, i: number) =>
    i === 0 ? 0 : font.getKerningValue(glyphs[i - 1], g) / upm,
  );
  const { pen } = layoutRun(advances, kerns, m.size, m.letterSpacing, m.align);
  const out: Subpath[] = [];
  for (let i = 0; i < chars.length && i < pen.length; i++) {
    const d = font.getPath(chars[i], pen[i], 0, m.size).toPathData(3);
    // The outlines are quadratic; `parsePathData` already converts them to our cubics exactly.
    for (const sp of parsePathData(d)) if (sp.nodes.length > 0) out.push(sp);
  }
  return out;
}
