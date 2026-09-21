import { segmentCubic, splitCubic } from "../geom/bezier";
import type { Vec } from "../geom/vec";
import type { NodeType, PathNode, PathShape, Subpath } from "./document";

/** Spec (M4a) §3: pure edits of one path's nodes. Every edit returns the same path when nothing
 *  changes, and none may leave a shape the importer would drop. */

export type NodeRef = { sub: number; i: number };

const EPS = 1e-9;
const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const sameHandle = (a: Vec | null, b: Vec | null) =>
  a === null || b === null ? a === b : same(a, b);
const shift = (v: Vec | null, dx: number, dy: number): Vec | null =>
  v === null ? null : { x: v.x + dx, y: v.y + dy };
const minus = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const length = (v: Vec) => Math.hypot(v.x, v.y);

/** Refs grouped by subpath, so each subpath is walked once. */
function bySubpath(refs: readonly NodeRef[]): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const r of refs) {
    const set = out.get(r.sub);
    if (set) set.add(r.i);
    else out.set(r.sub, new Set([r.i]));
  }
  return out;
}

/** The single funnel for every structural edit here. Spec M10 §3: reshaping a title's nodes
 *  **drops its `text`** — the geometry is hand-edited from now on, and re-typing would silently
 *  throw the reshaping away. Every edit in this file goes through here so none can forget. */
function withSubpaths(path: PathShape, subpaths: Subpath[], changed: boolean): PathShape {
  if (!changed) return path;
  const next = { ...path, subpaths };
  delete next.text;
  return next;
}

export function movePathNodes(
  path: PathShape,
  refs: readonly NodeRef[],
  dx: number,
  dy: number,
): PathShape {
  if (dx === 0 && dy === 0) return path;
  const groups = bySubpath(refs);
  let changed = false;
  const subpaths = path.subpaths.map((sp, si) => {
    const idx = groups.get(si);
    if (!idx) return sp;
    let hit = false;
    const nodes = sp.nodes.map((n, i) => {
      if (!idx.has(i)) return n;
      hit = true;
      return {
        ...n,
        p: { x: n.p.x + dx, y: n.p.y + dy },
        in: shift(n.in, dx, dy),
        out: shift(n.out, dx, dy),
      };
    });
    if (!hit) return sp;
    changed = true;
    return { ...sp, nodes };
  });
  return withSubpaths(path, subpaths, changed);
}

export function moveHandle(
  path: PathShape,
  ref: NodeRef,
  which: "in" | "out",
  to: Vec,
  breakSymmetry: boolean,
): PathShape {
  const sp = path.subpaths[ref.sub];
  const node = sp?.nodes[ref.i];
  if (!sp || !node) return path;

  const dropped = same(to, node.p);
  const moved: Vec | null = dropped ? null : to;
  let next: PathNode = which === "in" ? { ...node, in: moved } : { ...node, out: moved };

  if (breakSymmetry) {
    next = { ...next, type: "corner" };
  } else if (moved && node.type !== "corner") {
    const other = which === "in" ? node.out : node.in;
    const d = minus(moved, node.p);
    const l = length(d);
    if (other && l > EPS) {
      const keep = node.type === "symmetric" ? l : length(minus(other, node.p));
      const mirror: Vec = { x: node.p.x - (d.x / l) * keep, y: node.p.y - (d.y / l) * keep };
      next = which === "in" ? { ...next, out: mirror } : { ...next, in: mirror };
    }
  }

  if (next.type === node.type && sameHandle(next.in, node.in) && sameHandle(next.out, node.out)) {
    return path;
  }
  const nodes = sp.nodes.slice();
  nodes[ref.i] = next;
  const subpaths = path.subpaths.slice();
  subpaths[ref.sub] = { ...sp, nodes };
  return withSubpaths(path, subpaths, true);
}

/** Splits the segment that starts at node `seg` at `t`, leaving the outline where it was. */
export function insertNode(
  path: PathShape,
  sub: number,
  seg: number,
  t: number,
): { path: PathShape; ref: NodeRef } {
  const sp = path.subpaths[sub];
  const fail = { path, ref: { sub, i: seg } };
  if (!sp) return fail;
  const a = sp.nodes[seg];
  const wraps = sp.closed && seg === sp.nodes.length - 1;
  const b = wraps ? sp.nodes[0] : sp.nodes[seg + 1];
  if (!a || !b || !(t > 0 && t < 1)) return fail;

  const cubic = segmentCubic(a, b);
  let head: PathNode;
  let mid: PathNode;
  let tail: PathNode;
  if (cubic) {
    const [first, second] = splitCubic(cubic, t);
    head = { ...a, out: same(first[1], a.p) ? null : first[1] };
    mid = {
      p: first[3],
      in: same(first[2], first[3]) ? null : first[2],
      out: same(second[1], first[3]) ? null : second[1],
      type: "smooth",
    };
    tail = { ...b, in: same(second[2], b.p) ? null : second[2] };
  } else {
    head = a;
    mid = {
      p: { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t },
      in: null,
      out: null,
      type: "corner",
    };
    tail = b;
  }

  const nodes = sp.nodes.slice();
  nodes[seg] = head;
  if (wraps) {
    nodes[0] = tail;
    nodes.push(mid);
  } else {
    nodes[seg + 1] = tail;
    nodes.splice(seg + 1, 0, mid);
  }
  const subpaths = path.subpaths.slice();
  subpaths[sub] = { ...sp, nodes };
  return {
    path: withSubpaths(path, subpaths, true),
    ref: { sub, i: wraps ? nodes.length - 1 : seg + 1 },
  };
}

/** Null when the path would be left with no subpaths — the caller then deletes it outright. */
export function deletePathNodes(path: PathShape, refs: readonly NodeRef[]): PathShape | null {
  const groups = bySubpath(refs);
  let changed = false;
  const subpaths: Subpath[] = [];
  path.subpaths.forEach((sp, si) => {
    const idx = groups.get(si);
    if (!idx) {
      subpaths.push(sp);
      return;
    }
    const nodes = sp.nodes.filter((_, i) => !idx.has(i));
    if (nodes.length === sp.nodes.length) {
      subpaths.push(sp);
      return;
    }
    changed = true;
    // A subpath needs two nodes to draw anything; the importer drops the rest.
    if (nodes.length >= 2) subpaths.push({ ...sp, nodes });
  });
  if (!changed) return path;
  return subpaths.length === 0 ? null : withSubpaths(path, subpaths, true);
}

function retype(node: PathNode, type: NodeType): PathNode {
  if (type === "corner" || !node.in || !node.out) {
    return node.type === type ? node : { ...node, type };
  }
  const inV = minus(node.in, node.p);
  const outV = minus(node.out, node.p);
  const li = length(inV);
  const lo = length(outV);
  if (li < EPS || lo < EPS) return node.type === type ? node : { ...node, type };
  const ux = inV.x / li;
  const uy = inV.y / li;
  const keepIn = type === "symmetric" ? (li + lo) / 2 : li;
  const keepOut = type === "symmetric" ? (li + lo) / 2 : lo;
  const next: PathNode = {
    ...node,
    type,
    in: { x: node.p.x + ux * keepIn, y: node.p.y + uy * keepIn },
    out: { x: node.p.x - ux * keepOut, y: node.p.y - uy * keepOut },
  };
  return node.type === type && sameHandle(next.in, node.in) && sameHandle(next.out, node.out)
    ? node
    : next;
}

export function setNodeType(path: PathShape, refs: readonly NodeRef[], type: NodeType): PathShape {
  const groups = bySubpath(refs);
  let changed = false;
  const subpaths = path.subpaths.map((sp, si) => {
    const idx = groups.get(si);
    if (!idx) return sp;
    let hit = false;
    const nodes = sp.nodes.map((n, i) => {
      if (!idx.has(i)) return n;
      const next = retype(n, type);
      if (next !== n) hit = true;
      return next;
    });
    if (!hit) return sp;
    changed = true;
    return { ...sp, nodes };
  });
  return withSubpaths(path, subpaths, changed);
}

/** Closing never repeats the first node as the last: the writer emits `Z` and the importer would
 *  merge such a node away, losing it on reload (CLAUDE.md's M4 constraint). */
export function closeSubpath(path: PathShape, sub: number): PathShape {
  const sp = path.subpaths[sub];
  if (!sp || sp.closed || sp.nodes.length < 2) return path;
  const subpaths = path.subpaths.slice();
  subpaths[sub] = { ...sp, closed: true };
  return withSubpaths(path, subpaths, true);
}

/** Spec (M4b) §6. Adds `node` to the end of an open subpath; a closed one is left alone. */
export function appendNode(path: PathShape, sub: number, node: PathNode): PathShape {
  const sp = path.subpaths[sub];
  if (!sp || sp.closed) return path;
  const subpaths = path.subpaths.slice();
  subpaths[sub] = { ...sp, nodes: [...sp.nodes, node] };
  return withSubpaths(path, subpaths, true);
}

/** Reverses a subpath's nodes and swaps each one's handles, so the drawn shape is unchanged.
 *  The pen uses it to resume from a path's first node while still appending (spec M4b §5). */
export function reverseSubpath(path: PathShape, sub: number): PathShape {
  const sp = path.subpaths[sub];
  if (!sp || sp.nodes.length < 2) return path;
  const nodes = sp.nodes.map((n) => ({ ...n, in: n.out, out: n.in })).reverse();
  const subpaths = path.subpaths.slice();
  subpaths[sub] = { ...sp, nodes };
  return withSubpaths(path, subpaths, true);
}

/** Spec (M11) §5. Splits one subpath's every segment at `t = 0.5`, the wrap segment of a closed
 *  subpath included.
 *
 *  Each node's `in` comes from the segment that *ends* at it and its `out` from the segment that
 *  *starts* there, so the incoming handle is only known one iteration late — hence `pendingIn`. */
function subdivideSubpath(sp: Subpath): Subpath {
  const n = sp.nodes;
  if (n.length < 2) return sp;
  const segments = sp.closed ? n.length : n.length - 1;
  const out: PathNode[] = [];
  let pendingIn: Vec | null = null;
  for (let s = 0; s < segments; s++) {
    const a = n[s];
    const b = n[(s + 1) % n.length];
    const c = segmentCubic(a, b);
    if (c) {
      const [L, R] = splitCubic(c, 0.5);
      out.push({ ...a, in: s === 0 ? a.in : pendingIn, out: L[1] });
      // A midpoint split leaves the two halves' handles mirrored about the new point, which is
      // exactly what `symmetric` asserts — so it is a fact here, not a guess.
      out.push({ p: L[3], in: L[2], out: R[1], type: "symmetric" });
      pendingIn = R[2];
    } else {
      out.push({ ...a, in: s === 0 ? a.in : pendingIn, out: null });
      out.push({
        p: { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 },
        in: null,
        out: null,
        type: "corner",
      });
      pendingIn = null;
    }
  }
  if (sp.closed) {
    // Node 0's incoming handle comes from the wrap segment, which is only fitted at the very end.
    out[0] = { ...out[0], in: pendingIn };
  } else {
    // An open subpath's final anchor starts no segment, so the loop never pushed it.
    const last = n[n.length - 1];
    out.push({ ...last, in: pendingIn });
  }
  return { ...sp, nodes: out };
}

/** Spec (M11) §5. The geometry is unchanged **exactly**, not within a tolerance: de Casteljau at
 *  one half halves every existing handle without turning it, so collinearity survives and each
 *  existing node keeps its declared type. This is the opposite of the warp's rule (M12 §4), which
 *  must recompute types because a non-affine map breaks collinearity. */
export function subdividePath(path: PathShape): PathShape {
  let changed = false;
  const subpaths = path.subpaths.map((sp) => {
    const next = subdivideSubpath(sp);
    if (next !== sp) changed = true;
    return next;
  });
  return withSubpaths(path, subpaths, changed);
}

/** Spec (M11) §4. Reverses every subpath. Under nonzero winding — which is all this app has, since
 *  `Style` carries no `fill-rule` — this is what turns a combined inner subpath into a hole. */
export function reversePath(path: PathShape): PathShape {
  let out = path;
  for (let i = 0; i < path.subpaths.length; i++) out = reverseSubpath(out, i);
  return out;
}
