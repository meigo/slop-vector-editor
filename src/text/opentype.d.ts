/** Hand-written types for the surface of `opentype.js` 2.0 this app uses.
 *
 *  `@types/opentype.js` is 1.3.10 — written for opentype.js **1.x** — and it describes an API that
 *  differs where it matters: it declares `Font.names.fontFamily`, which the M10 spike found to be
 *  `undefined` in 2.0 (the name lives under a platform, `names.windows.fontFamily.en`). Wrong types
 *  are worse than none, so this declares only what `src/text/font.ts` actually calls, matching what
 *  the spike verified at runtime. */
declare module "opentype.js" {
  export type NameTable = Record<string, Record<string, Record<string, string>>>;

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    /** The glyph's outline at a pen position — no string shaping involved (see `outlineText`). */
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface PathCommand {
    type: "M" | "L" | "C" | "Q" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Path {
    commands: PathCommand[];
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  }

  /** One axis of a variable font's `fvar` table. */
  export interface VariationAxis {
    tag: string;
    minValue: number;
    defaultValue: number;
    maxValue: number;
  }

  export interface Font {
    /** Present on a variable font only. */
    tables: { fvar?: { axes: VariationAxis[] } };
    /** A variable font's instancer. `getTransform` returns a NEW glyph at those coordinates — its
     *  `advanceWidth` and `getPath` both reflect them — but it also overwrites the base glyph's
     *  `advanceWidth` as a side effect, so the base glyph's advance must not be read afterwards. */
    variation?: {
      getTransform(glyph: Glyph, coords: Record<string, number>): Glyph;
    };
    unitsPerEm: number;
    ascender: number;
    descender: number;
    numGlyphs: number;
    /** Keyed by platform in 2.0 — see the note above. */
    names: NameTable;
    stringToGlyphs(text: string): Glyph[];
    /** One glyph for this code point. Missing characters come back as `.notdef` (index 0). */
    charToGlyph(char: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
    getPath(text: string, x: number, y: number, fontSize: number): Path;
    getAdvanceWidth(text: string, fontSize: number, opts?: { kerning?: boolean }): number;
  }

  /** Throws on WOFF2 ("require an external decompressor library") and on unparseable input. */
  export function parse(buffer: ArrayBuffer): Font;

  const opentype: { parse: typeof parse };
  export default opentype;
}
