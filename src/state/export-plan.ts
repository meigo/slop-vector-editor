import type { Doc } from "../doc/document";
import type { Box } from "../geom/box";
import { selectionBounds } from "../tools/frame";

/** Spec (M12) §4. */
export type ExportRegion = "artboard" | "selection";

/** Spec (M12) §5. Deliberately below what Chrome manages — the spike reached 16384 per side there,
 *  but iOS caps total **area** rather than per-side dimensions and is unverified. A cap that is too
 *  generous fails silently and hands the user an empty file; one that is too strict says so out
 *  loud, and that is the better failure. */
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 16_777_216; // 4096²

/** The document-space box a PNG covers, or null when there is nothing to export. */
export function exportBox(doc: Doc, region: ExportRegion, ids: readonly string[]): Box | null {
  if (region === "artboard") {
    const { w, h } = doc.artboard;
    return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null;
  }
  const b = selectionBounds(doc, ids);
  return b && b.w > 0 && b.h > 0 ? b : null;
}

/** Spec (M12) §5. The artboard's units are pixels at 1×, so scale is the whole of the arithmetic. */
export function exportSize(box: Box, scale: number): { w: number; h: number } {
  return { w: Math.round(box.w * scale), h: Math.round(box.h * scale) };
}

/** Spec (M12) §5. Why the export cannot run, or null.
 *
 *  **Pre-emptive by design.** Past the canvas ceiling the browser throws nothing: it hands back a
 *  blank canvas and a null blob, so a `try`/`catch` around the draw would catch nothing and the
 *  user would get an empty file. This predicate is the only thing standing between them and that. */
export function exportRefusal(box: Box | null, scale: number): string | null {
  if (!box) return "nothing to export";
  if (!Number.isFinite(scale) || scale <= 0) return "scale must be a positive number";
  const { w, h } = exportSize(box, scale);
  if (w < 1 || h < 1) return "that scale rounds to nothing";
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) {
    return `${w} × ${h} is too large; reduce the scale`;
  }
  return null;
}

/** The document's name with a PNG extension. Kept here, beside the other pure export decisions,
 *  so it is testable without a DOM. */
export function pngFileName(svgName: string): string {
  const base = svgName.replace(/\.svg$/i, "").trim();
  return `${base === "" ? "Untitled" : base}.png`;
}

/** The dialog's live readout, so the pixel count is never a surprise (spec M12 §5). */
export function sizeLabel(box: Box | null, scale: number): string {
  if (!box || !Number.isFinite(scale) || scale <= 0) return "—";
  const { w, h } = exportSize(box, scale);
  return `${w} × ${h} px`;
}
