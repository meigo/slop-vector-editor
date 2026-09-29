import type { FlatStyle, Paint, Style } from "../doc/document";

/** The largest deviation Simplify may introduce, in screen px at the zoom the stroke was drawn at
 *  (spec M21 §4.2): what you drew is what you get at the zoom you drew it at.
 *
 *  Measured on a 200-point wavy 100×10 outline at zoom 1, as the maximum distance from the exact
 *  (unsimplified) curve to the simplified one: 0.25 px → 23 nodes, 0.153 px; **0.5 px → 20 nodes,
 *  0.314 px**; 1 px → 19 nodes, 0.471 px. Measured from the raw outline points instead, all three
 *  read 0.534 px — that is the exact curve itself cutting the band's square corners (it passes
 *  through edge midpoints, not vertices), which no tolerance changes. 0.5 keeps a tenth of the
 *  points and stays well inside a pixel; going to 1 saves only one more node. */
export const BRUSH_TOL_PX = 0.5;

/** Paper's `simplify` tolerance is a SQUARED distance (see `TOL_FRACTION` in
 *  `doc/simplify-edit.ts`), so the document-space bound `BRUSH_TOL_PX / zoom` is squared. */
export function brushTolerance(zoom: number): number {
  return (BRUSH_TOL_PX / zoom) ** 2;
}

const BLACK: Paint = { color: "#000000", opacity: 1 };

/** A brush stroke is a filled outline (spec M21 ruling 3): it paints in the stroke colour — what a
 *  pen draws with — falling back to the fill, then black, and has no stroke of its own. */
export function brushStyle(defaults: FlatStyle): Style {
  return { ...defaults, fill: defaults.stroke ?? defaults.fill ?? BLACK, stroke: null };
}
