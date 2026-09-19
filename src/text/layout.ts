/** Title layout (spec M10 §4). Pure: no fonts, no DOM — the caller turns glyphs into the numbers
 *  this needs, so the arithmetic is testable on its own. */

export type Align = "left" | "center" | "right";

/** `advances[i]` and `kerns[i]` are in em units (font units ÷ unitsPerEm); `kerns[i]` is the kern
 *  applied *before* character `i`, so `kerns[0]` is always 0. Returns each character's pen x and
 *  the run's width, both already scaled by `size` and shifted by `align`. */
export function layoutRun(
  advances: readonly number[],
  kerns: readonly number[],
  size: number,
  letterSpacing: number,
  align: Align,
): { pen: number[]; width: number } {
  if (advances.length === 0) return { pen: [], width: 0 };
  const pen: number[] = [];
  let x = 0;
  for (let i = 0; i < advances.length; i++) {
    if (i > 0) x += advances[i - 1] * size + (kerns[i] ?? 0) * size + letterSpacing;
    pen.push(x);
  }
  // No trailing letter-spacing: the run ends at the last glyph, not a gap after it.
  const width = x + advances[advances.length - 1] * size;
  const shift = align === "center" ? -width / 2 : align === "right" ? -width : 0;
  return { pen: shift === 0 ? pen : pen.map((p) => p + shift), width };
}
