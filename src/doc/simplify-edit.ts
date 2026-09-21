import { nodeBounds } from "../geom/bounds";
import { IDENTITY } from "../geom/mat";
import { simplifyOf } from "../geom/simplify";
import { withBakedSubpaths, type Doc, type Node, type PathShape } from "./document";
import { pathOpRefusal } from "./path-ops";
import { findNode, mapNodes } from "./tree";

export type SimplifyOutcome =
  | { kind: "ok"; doc: Doc; before: number; after: number }
  /** It ran and removed nothing: the document must not change (invariant 1). */
  | { kind: "none" }
  | { kind: "refused"; why: string };

/** Spec (M11) §6, amended 2026-09-21. Relative to the path's own bounding-box diagonal, never
 *  absolute: paper's default of 2.5 is meaningful only in its own example's coordinate space, and a
 *  20-unit logo and an artboard-sized traced path cannot share a number.
 *
 *  **The value passed to paper is `(diag × TOL_FRACTION) ** 2`, and the square is load-bearing —
 *  do not "simplify" it away.** Paper's own `tolerance` bounds a *squared* distance internally, so
 *  passing `diag × k` directly yields a deviation proportional to `√diag`, not to `diag`, which is
 *  not scale-invariant at all and defeats the entire reason this is relative to the diagonal.
 *  Measured, on one shape scaled ×1 / ×10 / ×100: `diag × 2e-3` left 60 / 81 / 81 segments — the
 *  same drawing simplified differently purely because it was bigger — while `(diag × 2e-3) ** 2`
 *  left 81 / 81 / 81.
 *
 *  The fraction is 5e-3, also measured: squared, 2e-3 removes *nothing* from a realistically noisy
 *  path (81 → 81 segments, 0% deviation), so Simplify would report "nothing to remove" and look
 *  broken; 1e-2 is more aggressive than a destructive command should be by default (81 → 33 nodes,
 *  0.97% of the diagonal). 5e-3 takes 81 → 56 nodes, at a measured maximum deviation of 0.49% of
 *  the diagonal — so the resulting bound on a path's actual worst-case drift is `diag × 5e-3`,
 *  i.e. 0.5% of its diagonal, even though that number is never passed to paper directly. */
export const TOL_FRACTION = 5e-3;

const countNodes = (p: PathShape): number => p.subpaths.reduce((n, sp) => n + sp.nodes.length, 0);

/** Spec (M11) §6. Async, so it copies `booleanShapes`' shape: the caller must re-check that the
 *  document has not moved under the await before committing (invariant 15's hazard, across an
 *  await). */
export async function simplifyShapes(doc: Doc, ids: readonly string[]): Promise<SimplifyOutcome> {
  const unique = [...new Set(ids)];
  const why = pathOpRefusal(doc, unique, "simplify");
  if (why) return { kind: "refused", why };
  const targets = unique
    .flatMap((id) => findNode(doc, id) ?? [])
    .flatMap((f) => (f.node.kind === "path" ? [f.node] : []));

  let before = 0;
  let after = 0;
  const done = new Map<string, PathShape>();
  for (const p of targets) {
    // Measured in the path's own space, not its parent's: `p.subpaths` below is untransformed,
    // so the tolerance must be too, or a non-isometric transform (scale, rotation) makes the
    // bound disagree with the geometry it is applied to (spec M11 §6, amended 2026-09-21).
    const box = nodeBounds({ ...p, transform: IDENTITY }, IDENTITY);
    const diag = box ? Math.hypot(box.w, box.h) : 0;
    if (diag === 0) continue;
    const subpaths = await simplifyOf(p.subpaths, (diag * TOL_FRACTION) ** 2);
    // A subpath the fit left with fewer than two nodes is dropped, and a path left with none is
    // not written at all — the importer would drop it (invariant 30). `fromPaperItem` already
    // filters this; the check stays here too, since this is the document-layer boundary that
    // owns invariant 30 and should not lean on a geometry module to keep it true.
    const kept = subpaths.filter((sp) => sp.nodes.length >= 2);
    if (kept.length === 0) continue;
    const next = withBakedSubpaths(p, kept);
    const n = countNodes(next);
    if (n === countNodes(p)) continue;
    before += countNodes(p);
    after += n;
    done.set(p.id, next);
  }
  if (done.size === 0) return { kind: "none" };
  const out = mapNodes(doc, [...done.keys()], (n) => (done.get(n.id) ?? n) as Node);
  return { kind: "ok", doc: out, before, after };
}
