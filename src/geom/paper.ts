import type { PathNode, Subpath } from "../doc/document";

/** The module's own types, taken from the dynamic import so nothing is imported at load time. */
export type Paper = typeof import("paper/dist/paper-core");
export type PaperPath = InstanceType<Paper["Path"]>;
export type PaperItem = InstanceType<Paper["PathItem"]>;
export type PaperSegment = InstanceType<Paper["Segment"]>;

/** Two handles that mirror each other about the point are a symmetric node. This is not the
 *  importer's rule: `inferNodeTypes` never emits `symmetric` and tests collinearity at 1e-3, while
 *  this tests the mirror at 1e-6. */
const MIRROR = 1e-6;

/** Paper is ~72 KB gzipped — as much as the rest of the app — and the operations that need it are
 *  rare, so it is fetched on first use rather than at load (spec M7 §2, M11 §6). **This module is
 *  the only importer of paper** (invariant 37); the refusal rules the menus need are pure, so no
 *  menu ever waits on this.
 *
 *  The *promise* is cached, not the module: a value cached after the await would let two
 *  overlapping first calls both fall through the guard and each run `setup()`, leaving a spare
 *  project behind for the life of the page. A rejection clears the cache again, so a failed
 *  download leaves the next attempt free to re-fetch instead of being dead for that tab. */
let loading: Promise<Paper> | null = null;
export function loadPaper(): Promise<Paper> {
  loading ??= import("paper/dist/paper-core")
    .then((mod) => {
      const p = (mod as unknown as { default?: Paper }).default ?? (mod as unknown as Paper);
      // No canvas and no DOM: paper only ever does geometry here.
      p.setup(new p.Size(1, 1));
      return p;
    })
    .catch((e: unknown) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** Our handles are absolute in the shape's own space; paper's are relative to the segment point. */
function toPaperPath(P: Paper, sp: Subpath): PaperPath {
  return new P.Path({
    // Never attach to paper's project: an item created here would stay in the module-level project
    // for the life of the page, and there would be nothing to clean it up if an operation threw.
    insert: false,
    segments: sp.nodes.map(
      (n) =>
        new P.Segment(
          new P.Point(n.p.x, n.p.y),
          n.in ? new P.Point(n.in.x - n.p.x, n.in.y - n.p.y) : undefined,
          n.out ? new P.Point(n.out.x - n.p.x, n.out.y - n.p.y) : undefined,
        ),
    ),
    closed: sp.closed,
  });
}

export function toPaperItem(P: Paper, subpaths: readonly Subpath[]): PaperItem {
  const paths = subpaths.map((sp) => toPaperPath(P, sp));
  return paths.length === 1 ? paths[0] : new P.CompoundPath({ children: paths, insert: false });
}

/** The `Path` children of an item, so a caller can act on each one. A lone `Path` is its own only
 *  child here; paper puts `simplify` on `Path`, not on `CompoundPath`. */
export function paperPaths(item: PaperItem): PaperPath[] {
  return "children" in item && item.children ? (item.children as PaperPath[]) : [item as PaperPath];
}

function nodeFrom(s: PaperSegment): PathNode {
  const inH = s.handleIn.isZero()
    ? null
    : { x: s.point.x + s.handleIn.x, y: s.point.y + s.handleIn.y };
  const outH = s.handleOut.isZero()
    ? null
    : { x: s.point.x + s.handleOut.x, y: s.point.y + s.handleOut.y };
  const mirrored =
    inH !== null &&
    outH !== null &&
    Math.abs(inH.x + outH.x - 2 * s.point.x) <= MIRROR &&
    Math.abs(inH.y + outH.y - 2 * s.point.y) <= MIRROR;
  return {
    p: { x: s.point.x, y: s.point.y },
    in: inH,
    out: outH,
    type: inH === null && outH === null ? "corner" : mirrored ? "symmetric" : "smooth",
  };
}

export function fromPaperItem(item: PaperItem): Subpath[] {
  return paperPaths(item)
    .filter((p) => p.segments && p.segments.length >= 2)
    .map((p) => ({ nodes: p.segments.map(nodeFrom), closed: p.closed }));
}
