/** The title attributes (spec M10 §7). Pure, and shaped like `parsePolygonAttr`: every field is
 *  validated and a bad one returns null rather than throwing, so a malformed file degrades to an
 *  ordinary path instead of losing its artwork. */
import { fmt } from "../svg/fmt";
import type { Align } from "./layout";

export type CharOverride = { r?: number; s?: number; dx?: number; dy?: number; k?: number };
export type Amounts = { rotate: number; scale: number; offset: number; skew: number };
export type TextOpts = {
  size: number;
  letterSpacing: number;
  align: Align;
  seed: number;
  amounts: Amounts;
};

const ALIGNS: readonly string[] = ["left", "center", "right"];
const KEYS: readonly (keyof CharOverride)[] = ["r", "s", "dx", "dy", "k"];
const num = (v: string): number | null => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

export function formatTextOpts(o: TextOpts): string {
  const a = o.amounts;
  return [o.size, o.letterSpacing]
    .map(fmt)
    .concat(o.align, [o.seed, a.rotate, a.scale, a.offset, a.skew].map(fmt))
    .join(" ");
}

export function parseTextOpts(s: string): TextOpts | null {
  const p = s.trim().split(/\s+/);
  if (p.length !== 8) return null;
  if (!ALIGNS.includes(p[2])) return null;
  const n = [0, 1, 3, 4, 5, 6, 7].map((i) => num(p[i]));
  if (n.some((v) => v === null)) return null;
  const [size, letterSpacing, seed, rotate, scale, offset, skew] = n as number[];
  if (size <= 0) return null;
  return {
    size,
    letterSpacing,
    align: p[2] as Align,
    seed,
    amounts: { rotate, scale, offset, skew },
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
    const i = Number(part.slice(0, colon));
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
