import type { PathNode, Subpath } from "../doc/document";

/** The module's own types, taken from the dynamic import so nothing is imported at load time. */
type Paper = typeof import("paper/dist/paper-core");
type PaperPath = InstanceType<Paper["Path"]>;
type PaperItem = InstanceType<Paper["PathItem"]>;
type PaperSegment = InstanceType<Paper["Segment"]>;

/** Spec (M7) §4. */
export type BoolOp = "unite" | "subtract" | "intersect" | "exclude";

/** The command names, used by every surface and by the notices, so they cannot drift apart. */
export const BOOL_LABEL: Readonly<Record<BoolOp, string>> = {
  unite: "Unite",
  subtract: "Subtract",
  intersect: "Intersect",
  exclude: "Exclude",
};

export const BOOL_OPS: readonly BoolOp[] = ["unite", "subtract", "intersect", "exclude"];

/** Tooltips read as actions, because every title is also the status-bar hint (invariant 24). */
export const BOOL_TITLE: Readonly<Record<BoolOp, string>> = {
  unite: "Combine the selected shapes into one",
  subtract: "Remove what is in front from what is behind",
  intersect: "Keep only where the selected shapes overlap",
  exclude: "Keep everything except where they overlap",
};

/** Spec (M7) §7. */
export const BOOL_REASON = {
  few: "select two or more shapes",
  group: "a group can't take part",
  open: "an open path can't take part",
} as const;

/** Two handles that mirror each other about the point are a symmetric node. This is not the
 *  importer's rule: `inferNodeTypes` never emits `symmetric` and tests collinearity at 1e-3, while
 *  this tests the mirror at 1e-6. */
const MIRROR = 1e-6;

/** Paper is ~72 KB gzipped — as much as the rest of the app — and boolean operations are rare, so
 *  it is fetched on first use rather than at load (spec M7 §2). Nothing else imports it, and the
 *  refusal rules the menus need are pure, so no menu ever waits on this.
 *
 *  The *promise* is cached, not the module: a value cached after the await would let two
 *  overlapping first calls both fall through the guard and each run `setup()`, leaving a spare
 *  project behind for the life of the page. A rejection clears the cache again, so a failed
 *  download (the realistic case — a dropped connection, or a tab whose build's chunk a deploy has
 *  replaced) leaves the next attempt free to re-fetch instead of being dead for that tab. */
let loading: Promise<Paper> | null = null;
function load(): Promise<Paper> {
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

function toPaperItem(P: Paper, subpaths: readonly Subpath[]): PaperItem {
  const paths = subpaths.map((sp) => toPaperPath(P, sp));
  return paths.length === 1 ? paths[0] : new P.CompoundPath({ children: paths, insert: false });
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

function fromPaperItem(item: PaperItem): Subpath[] {
  const paths =
    "children" in item && item.children ? (item.children as PaperPath[]) : [item as PaperPath];
  return paths
    .filter((p) => p.segments && p.segments.length >= 2)
    .map((p) => ({ nodes: p.segments.map(nodeFrom), closed: p.closed }));
}

/** Spec (M7) §4. Every operand is in document space already. Returns [] when the result is empty —
 *  the caller must leave the document alone rather than write a path the importer would drop. */
export async function booleanOf(
  operands: readonly (readonly Subpath[])[],
  op: BoolOp,
): Promise<Subpath[]> {
  const P = await load();
  const items = operands.map((o) => toPaperItem(P, o));
  let acc = items[0];
  // The result is not inserted either, for the same reason.
  for (const next of items.slice(1)) acc = acc[op](next, { insert: false });
  return fromPaperItem(acc);
}
