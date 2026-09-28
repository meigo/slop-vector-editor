/** The title attributes (spec M10 §7). Pure, and shaped like `parsePolygonAttr`: every field is
 *  validated and a bad one returns null rather than throwing, so a malformed file degrades to an
 *  ordinary path instead of losing its artwork. */
import { DEFAULT_WEIGHT } from "../doc/document";
import { fmt } from "../svg/fmt";
import type { Align } from "./layout";

export type CharOverride = { r?: number; s?: number; dx?: number; dy?: number; k?: number };
export type Amounts = { rotate: number; scale: number; offset: number; skew: number };
/** The line height a file written before M10d is read with. */
export const DEFAULT_LINE_HEIGHT = 1.2;

export type TextOpts = {
  size: number;
  letterSpacing: number;
  lineHeight: number;
  align: Align;
  seed: number;
  amounts: Amounts;
  /** Absent means 400; present only when it differs (invariant 39, spec M20 §4). */
  weight?: number;
  /** Absent means upright; present only as `true`. */
  italic?: true;
};

const ALIGNS: readonly string[] = ["left", "center", "right"];
/** The same ceiling `parse.ts` puts on every coordinate and length (invariant 8): `fmt`'s
 *  6-decimal rounding overflows to Infinity well before this, and a title is re-outlined at its
 *  size, so an unbounded size would produce a file that cannot be written back. */
const MAX_TEXT_NUM = 1e9;
/** A title is a title. Past this the next keystroke would outline tens of thousands of glyphs. */
export const MAX_TEXT_LENGTH = 2000;
const KEYS: readonly (keyof CharOverride)[] = ["r", "s", "dx", "dy", "k"];
const num = (v: string): number | null => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Nine fields while weight and italic are at their defaults, so every title written before M20
 *  — and every default title since — serializes byte-identically; eleven once either is set. */
export function formatTextOpts(o: TextOpts): string {
  const a = o.amounts;
  const weight = o.weight ?? DEFAULT_WEIGHT;
  const styled = weight !== DEFAULT_WEIGHT || o.italic === true;
  return [o.size, o.letterSpacing]
    .map(fmt)
    .concat(o.align, [o.seed, a.rotate, a.scale, a.offset, a.skew, o.lineHeight].map(fmt))
    .concat(styled ? [fmt(weight), o.italic ? "1" : "0"] : [])
    .join(" ");
}

export function parseTextOpts(s: string): TextOpts | null {
  const p = s.trim().split(/\s+/);
  // **Eight or nine.** M10d appended `lineHeight`; demanding nine would turn every title saved
  // before it into a plain path with its text lost — the same silent loss the seed ceiling caused.
  // **Or eleven** (M20): weight and italic are appended as a pair, only when either is set. Ten
  // is not a shape any version writes, so it is malformed.
  if (p.length !== 8 && p.length !== 9 && p.length !== 11) return null;
  if (!ALIGNS.includes(p[2])) return null;
  const n = [0, 1, 3, 4, 5, 6, 7].map((i) => num(p[i]));
  if (n.some((v) => v === null)) return null;
  const lineHeight = p.length >= 9 ? num(p[8]) : DEFAULT_LINE_HEIGHT;
  if (lineHeight === null || lineHeight <= 0) return null;
  const [size, letterSpacing, seed, rotate, scale, offset, skew] = n as number[];
  if (size <= 0) return null;
  // The seed is an opaque 32-bit integer, not a length: measuring it against MAX_TEXT_NUM rejected
  // any seed above 1e9 and silently turned the title back into an ordinary path on reload.
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  if ([size, letterSpacing, rotate, scale, offset, skew].some((v) => Math.abs(v) > MAX_TEXT_NUM)) {
    return null;
  }
  let weight = DEFAULT_WEIGHT;
  let italic = false;
  if (p.length === 11) {
    // An integer weight class, 1-1000 (OpenType's range for the `wght` axis).
    if (!/^\d+$/.test(p[9])) return null;
    weight = Number(p[9]);
    if (weight < 1 || weight > 1000) return null;
    if (p[10] !== "0" && p[10] !== "1") return null;
    italic = p[10] === "1";
  }
  // The defaults are absent keys, never written-out values (invariant 39), so a file spelling
  // them out in full reads back identical to one that omits them.
  return {
    size,
    letterSpacing,
    lineHeight,
    align: p[2] as Align,
    seed,
    amounts: { rotate, scale, offset, skew },
    ...(weight === DEFAULT_WEIGHT ? {} : { weight }),
    ...(italic ? { italic: true as const } : {}),
  };
}

export function formatOverrides(o: Record<number, CharOverride>): string {
  return Object.keys(o)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => {
      const props = KEYS.filter((k) => o[i][k] !== undefined)
        .map((k) => `${k}=${fmt(o[i][k] as number)}`)
        .join(",");
      return props === "" ? "" : `${i}:${props}`;
    })
    .filter((s) => s !== "")
    .join(";");
}

/** Anything malformed is skipped, not thrown: an override is a decoration, never the artwork. */
export function parseOverrides(s: string, length: number): Record<number, CharOverride> {
  const out: Record<number, CharOverride> = {};
  if (s.trim() === "") return out;
  for (const part of s.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const raw = part.slice(0, colon).trim();
    // `Number("")` is 0 and would land an override on the first character; require real digits.
    if (!/^\d+$/.test(raw)) continue;
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i >= length) continue;
    const ov: CharOverride = {};
    for (const pair of part.slice(colon + 1).split(",")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const key = pair.slice(0, eq).trim() as keyof CharOverride;
      if (!KEYS.includes(key)) continue;
      const v = num(pair.slice(eq + 1));
      if (v !== null) ov[key] = v;
    }
    if (Object.keys(ov).length > 0) out[i] = ov;
  }
  return out;
}
