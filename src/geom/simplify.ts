import type { Subpath } from "../doc/document";
import { fromPaperItem, loadPaper, paperPaths, toPaperItem } from "./paper";

/** Spec (M11) §6. Paper's own `simplify` is Schneider's curve fitter, so there is no fitting code
 *  of ours here — only the conversion, which `geom/paper.ts` already owns.
 *
 *  `simplify` lives on `Path`, not on `CompoundPath`, so each child is fitted on its own. */
export async function simplifyOf(
  subpaths: readonly Subpath[],
  tolerance: number,
): Promise<Subpath[]> {
  const P = await loadPaper();
  const item = toPaperItem(P, subpaths);
  for (const p of paperPaths(item)) p.simplify(tolerance);
  return fromPaperItem(item);
}
