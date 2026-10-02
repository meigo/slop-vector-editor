import { isValidArtboardSize, MAX_ARTBOARD, type Doc, type Node } from "./document";

/** Spec M23 §2: where a crop/extend keeps the drawing — 0 = left/top, 0.5 = centre, 1 = right/bottom. */
export type Anchor = 0 | 0.5 | 1;

export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Crop/extend's Keep ratio (slop-paint's `linkedSize`): the other side in whole pixels. */
export function linkedSize(v: number, from: number, to: number): number {
  return Math.max(1, Math.round((v * to) / from));
}

/** Scale drawing's other side: exact to 2 decimals, as the artboard is set (spec M23 §2). */
export function scaledSide(v: number, from: number, to: number): number {
  return round2((v * to) / from);
}

/** Why a page of `w × h` can't be set, or null. The dialog shows it under the fields. */
export function sizeRefusal(w: unknown, h: unknown): string | null {
  if (typeof w !== "number" || typeof h !== "number" || !Number.isFinite(w) || !Number.isFinite(h))
    return "Enter a width and a height";
  if (w > MAX_ARTBOARD || h > MAX_ARTBOARD) return `Too large — at most ${MAX_ARTBOARD} px a side`;
  if (!isValidArtboardSize(w) || !isValidArtboardSize(h))
    return "Too small — a side must be more than 0 px";
  return null;
}

/** Only the translation changes (invariant 26): nothing is baked, so everything stays live. */
function shift(n: Node, dx: number, dy: number): Node {
  const [a, b, c, d, e, f] = n.transform;
  return { ...n, transform: [a, b, c, d, e + dx, f + dy] };
}

/** Spec M23 §3: the page becomes `w × h` and every top-level node of every layer — hidden and
 *  locked ones too, since this changes the page, not the art — moves so the anchored part of the
 *  drawing keeps its place. Layers have no transform, so top-level nodes are in document space;
 *  nested ones move with their parents. */
export function extendCanvas(doc: Doc, w: number, h: number, ax: Anchor, ay: Anchor): Doc {
  const reason = sizeRefusal(w, h);
  if (reason) throw new RangeError(reason);
  const { w: w0, h: h0 } = doc.artboard;
  if (w === w0 && h === h0) return doc;
  const dx = ax * (w - w0);
  const dy = ay * (h - h0);
  const artboard = { ...doc.artboard, w, h };
  if (dx === 0 && dy === 0) return { ...doc, artboard };
  const layers = doc.layers.map((l) =>
    l.children.length === 0 ? l : { ...l, children: l.children.map((n) => shift(n, dx, dy)) },
  );
  return { ...doc, artboard, layers };
}
