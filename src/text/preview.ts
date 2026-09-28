import type { TextMeta } from "../doc/document";
import { flattenSubpath } from "../geom/bezier";
import { boxFromPoints, type Box } from "../geom/box";
import { subpathsToD } from "../svg/pathdata";
import { outlineText, type LoadedFont } from "./font";

/** The Google Fonts dialog's sample line (spec M20 §6), shown under the family's own name: the
 *  Estonian letters are the ones a font most often turns out not to have. */
export const PREVIEW_SAMPLE = "Tallinn — šž õäöü";

/** The sample outlined in `f`, through the same pipeline a title uses, as SVG path data and the
 *  outlines' bounds (the preview's `viewBox`). Null when nothing drew. */
export function previewOutline(f: LoadedFont, family: string): { d: string; box: Box } | null {
  const meta: TextMeta = {
    text: `${family}\n${PREVIEW_SAMPLE}`,
    font: f.id,
    size: 32,
    letterSpacing: 0,
    lineHeight: 1.3,
    align: "left",
    seed: 0,
    amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
    overrides: {},
  };
  const subpaths = outlineText(f, meta);
  const box = boxFromPoints(subpaths.flatMap((sp) => flattenSubpath(sp)));
  if (!box || box.w === 0 || box.h === 0) return null;
  return { d: subpathsToD(subpaths), box };
}
