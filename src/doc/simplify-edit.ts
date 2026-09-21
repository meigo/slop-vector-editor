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

/** Spec (M11) §6. Relative to the path's own bounding-box diagonal, never absolute: paper's
 *  default of 2.5 is meaningful only in its own example's coordinate space, and a 20-unit logo and
 *  an artboard-sized traced path cannot share a number. */
const TOL_FRACTION = 2e-3;

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
    const box = nodeBounds(p, IDENTITY);
    const diag = box ? Math.hypot(box.w, box.h) : 0;
    if (diag === 0) continue;
    const subpaths = await simplifyOf(p.subpaths, diag * TOL_FRACTION);
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
