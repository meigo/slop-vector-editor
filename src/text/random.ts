/** Per-character jitter for a title (spec M10 §4). Pure, and deliberately integer-only: a title
 *  must look identical on every machine, so nothing here may depend on float formatting or on
 *  `Math.random` — a title that re-rolled itself because it was opened elsewhere would be a data
 *  bug, not a surprise. */
import type { Amounts, CharOverride } from "./attrs";

export type CharTransform = { rotate: number; scale: number; dx: number; dy: number; skew: number };

export const IDENTITY_CHAR: CharTransform = { rotate: 0, scale: 1, dx: 0, dy: 0, skew: 0 };

export const isIdentityChar = (t: CharTransform): boolean =>
  t.rotate === 0 && t.scale === 1 && t.dx === 0 && t.dy === 0 && t.skew === 0;

/** A 32-bit mix of (seed, index, salt). Each property gets its own salt, so rotation and scale are
 *  independent rather than one stream read twice. And because the index goes *in* rather than
 *  being consumed in order, character 5's jitter never depends on characters 0-4 — inserting a
 *  letter at the front must not reshuffle every letter after it. */
function hash(seed: number, index: number, salt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (index + 0x165667b1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ salt, 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** −1 … +1 from a 32-bit hash. */
const signed = (h: number): number => (h / 0x100000000) * 2 - 1;

/** A negative roll times an amount of zero is `-0`, which `===` calls equal to `0` but `Object.is`
 *  does not — so an "identity" transform silently failed a deep comparison. `+ 0` normalises it and
 *  leaves every other value untouched. */
const jitter = (h: number, amount: number): number => signed(h) * amount + 0;

export function charTransform(seed: number, index: number, a: Amounts): CharTransform {
  return {
    rotate: jitter(hash(seed, index, 1), a.rotate),
    scale: 1 + jitter(hash(seed, index, 2), a.scale),
    dx: 0,
    // "Baseline": the jitter is vertical. `dx` exists for a hand override, not for the dice.
    dy: jitter(hash(seed, index, 3), a.offset),
    skew: jitter(hash(seed, index, 4), a.skew),
  };
}

/** A hand-set value replaces the rolled one for that property only, so a tweaked letter survives a
 *  re-roll of the rest (spec M10 §4). */
export function withOverride(t: CharTransform, o: CharOverride | undefined): CharTransform {
  if (!o) return t;
  return {
    rotate: o.r ?? t.rotate,
    scale: o.s ?? t.scale,
    dx: o.dx ?? t.dx,
    dy: o.dy ?? t.dy,
    skew: o.k ?? t.skew,
  };
}

export function newSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
