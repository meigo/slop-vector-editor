import {
  idFor,
  isValidArtboardSize,
  MAX_INNER,
  MAX_SIDES,
  MIN_INNER,
  MIN_SIDES,
  type Artboard,
  type Doc,
  type Node,
  type Paint,
  type PolygonShape,
  type Shape,
  type Style,
} from "./document";
import {
  IDENTITY,
  inParent,
  isIdentity,
  multiply,
  rotateAbout,
  translate,
  type Mat,
} from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import type { Vec } from "../geom/vec";
import { mapShapes, mapNodes } from "./tree";

/** Pure document edits: `(doc, args) => doc`. An edit that changes nothing returns the SAME
 *  reference, which is how the undo session knows not to record a step. */

function samePaint(a: Paint | null, b: Paint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.color === b.color && a.opacity === b.opacity;
}

export function setArtboard(doc: Doc, artboard: Artboard): Doc {
  if (!isValidArtboardSize(artboard.w) || !isValidArtboardSize(artboard.h)) {
    throw new RangeError(`Invalid artboard size ${artboard.w} × ${artboard.h}`);
  }
  const cur = doc.artboard;
  if (
    cur.w === artboard.w &&
    cur.h === artboard.h &&
    samePaint(cur.background, artboard.background)
  ) {
    return doc;
  }
  return { ...doc, artboard: { ...artboard } };
}

export function addShape(doc: Doc, layerId: string, shape: Shape): { doc: Doc; id: string } {
  const li = doc.layers.findIndex((l) => l.id === layerId);
  if (li < 0) throw new Error(`No layer ${layerId}`);
  const id = idFor(doc.nextId);
  const layers = doc.layers.slice();
  layers[li] = { ...layers[li], children: [...layers[li].children, { ...shape, id }] };
  return { doc: { ...doc, layers, nextId: doc.nextId + 1 }, id };
}

/** Removes nodes at any depth. A group left with no children goes too, up the chain: the importer
 *  drops empty groups, so writing one would not survive a reload (spec M3b §4.3). */
export function deleteNodes(doc: Doc, ids: readonly string[]): Doc {
  const set = new Set(ids);
  if (set.size === 0) return doc;
  const prune = (children: readonly Node[]): Node[] | null => {
    let hit = false;
    const out: Node[] = [];
    for (const n of children) {
      if (set.has(n.id)) {
        hit = true;
        continue;
      }
      if (n.kind === "group") {
        const inner = prune(n.children);
        if (inner) {
          hit = true;
          if (inner.length > 0) out.push({ ...n, children: inner });
          continue;
        }
      }
      out.push(n);
    }
    return hit ? out : null;
  };
  let changed = false;
  const layers = doc.layers.map((l) => {
    const children = prune(l.children);
    if (!children) return l;
    changed = true;
    return { ...l, children };
  });
  return changed ? { ...doc, layers } : doc;
}

function withFreshIds(node: Node, next: () => string): Node {
  if (node.kind === "group") {
    const id = next();
    return { ...node, id, children: node.children.map((c) => withFreshIds(c, next)) };
  }
  return { ...node, id: next() };
}

export function duplicateNodes(
  doc: Doc,
  ids: readonly string[],
  dx: number,
  dy: number,
): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  let nextId = doc.nextId;
  const freshId = () => idFor(nextId++);
  const created: string[] = [];
  const offset = translate(dx, dy);
  const dup = (children: readonly Node[], parent: Mat): Node[] | null => {
    let hit = false;
    const out: Node[] = [];
    for (const n of children) {
      if (set.has(n.id)) {
        out.push(n);
        const copy = withFreshIds(n, freshId);
        const local = dx === 0 && dy === 0 ? null : inParent(parent, offset);
        const moved: Node = local ? { ...copy, transform: multiply(local, copy.transform) } : copy;
        out.push(moved);
        created.push(moved.id);
        hit = true;
        continue;
      }
      if (n.kind === "group") {
        const inner = dup(n.children, multiply(parent, n.transform));
        if (inner) {
          out.push({ ...n, children: inner });
          hit = true;
          continue;
        }
      }
      out.push(n);
    }
    return hit ? out : null;
  };
  const layers = doc.layers
    .map((l) => dup(l.children, IDENTITY) ?? null)
    .map((children, i) => (children ? { ...doc.layers[i], children } : doc.layers[i]));
  if (created.length === 0) return { doc, ids: [] };
  return { doc: { ...doc, layers, nextId }, ids: created };
}

export function translateNodes(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc;
  const t = translate(dx, dy);
  return mapNodes(doc, ids, (n, parent) => {
    const local = inParent(parent, t);
    return local ? { ...n, transform: multiply(local, n.transform) } : n;
  });
}

export function rotateNodes(doc: Doc, ids: readonly string[], angle: number, centre: Vec): Doc {
  if (angle === 0) return doc;
  const r = rotateAbout(angle, centre);
  return mapNodes(doc, ids, (n, parent) => {
    const local = inParent(parent, r);
    return local ? { ...n, transform: multiply(local, n.transform) } : n;
  });
}

function styleMatches(s: Style, patch: Partial<Style>): boolean {
  return (Object.keys(patch) as (keyof Style)[]).every((k) =>
    k === "fill" || k === "stroke"
      ? samePaint(s[k], (patch[k] ?? null) as Paint | null)
      : s[k] === patch[k],
  );
}

export function setStyle(doc: Doc, ids: readonly string[], patch: Partial<Style>): Doc {
  return mapNodes(doc, ids, (n) =>
    mapShapes(n, (s) =>
      styleMatches(s.style, patch) ? s : { ...s, style: { ...s.style, ...patch } },
    ),
  );
}

export function setRectRadius(doc: Doc, ids: readonly string[], rx: number): Doc {
  if (!Number.isFinite(rx)) return doc;
  return mapNodes(doc, ids, (n) => {
    if (n.kind !== "rect") return n;
    const r = Math.max(0, Math.min(rx, n.w / 2, n.h / 2));
    return r === n.rx ? n : { ...n, rx: r };
  });
}

export type PolygonPatch = Partial<Pick<PolygonShape, "sides" | "star" | "innerRatio">>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Spec (M2c) §5: only selected top-level polygons change; values are rounded/clamped. */
export function setPolygon(doc: Doc, ids: readonly string[], patch: PolygonPatch): Doc {
  const sides =
    patch.sides !== undefined && Number.isFinite(patch.sides)
      ? clamp(Math.round(patch.sides), MIN_SIDES, MAX_SIDES)
      : undefined;
  const innerRatio =
    patch.innerRatio !== undefined && Number.isFinite(patch.innerRatio)
      ? clamp(patch.innerRatio, MIN_INNER, MAX_INNER)
      : undefined;
  const star = patch.star;
  return mapNodes(doc, ids, (n) => {
    if (n.kind !== "polygon") return n;
    const next = {
      sides: sides ?? n.sides,
      star: star ?? n.star,
      innerRatio: innerRatio ?? n.innerRatio,
    };
    return next.sides === n.sides && next.star === n.star && next.innerRatio === n.innerRatio
      ? n
      : { ...n, ...next };
  });
}

export function convertToPath(doc: Doc, ids: readonly string[]): Doc {
  return mapNodes(doc, ids, (n) =>
    n.kind === "rect" || n.kind === "ellipse" || n.kind === "polygon" ? toPath(n) : n,
  );
}

export function flattenTransform(doc: Doc, ids: readonly string[]): Doc {
  return mapNodes(doc, ids, (n) =>
    n.kind === "path" && !isIdentity(n.transform)
      ? { ...n, subpaths: transformSubpaths(n.subpaths, n.transform), transform: IDENTITY }
      : n,
  );
}

/** Spec (M3b) §7. Opacity of the selected nodes themselves: a group's own opacity, or a shape's
 *  style opacity. A group's children are left alone, so its opacity keeps its meaning. */
export function setNodeOpacity(doc: Doc, ids: readonly string[], value: number): Doc {
  return mapNodes(doc, ids, (n) => {
    if (n.kind === "group") return n.opacity === value ? n : { ...n, opacity: value };
    return n.style.opacity === value ? n : { ...n, style: { ...n.style, opacity: value } };
  });
}

/** Adds copies of `nodes` (fresh ids) on top of a layer, moved by (dx, dy). */
export function insertNodes(
  doc: Doc,
  layerId: string,
  nodes: readonly Node[],
  dx: number,
  dy: number,
): { doc: Doc; ids: string[] } {
  const li = doc.layers.findIndex((l) => l.id === layerId);
  if (li < 0) throw new Error(`No layer ${layerId}`);
  if (nodes.length === 0) return { doc, ids: [] };
  let nextId = doc.nextId;
  const next = () => idFor(nextId++);
  const offset = translate(dx, dy);
  const added = nodes.map((n) => {
    const copy = withFreshIds(n, next);
    return dx === 0 && dy === 0 ? copy : { ...copy, transform: multiply(offset, copy.transform) };
  });
  const layers = doc.layers.slice();
  layers[li] = { ...layers[li], children: [...layers[li].children, ...added] };
  return { doc: { ...doc, layers, nextId }, ids: added.map((n) => n.id) };
}

/** Spec M9 §3. Turning a flag off deletes the key, so a node hidden and shown again is structurally
 *  identical to one that never was, and still saves byte-identically. */
function setFlag(doc: Doc, ids: readonly string[], key: "hidden" | "locked", on: boolean): Doc {
  return mapNodes(doc, ids, (n) => {
    if (on) return n[key] === true ? n : { ...n, [key]: true };
    if (n[key] === undefined) return n;
    const next = { ...n };
    delete next[key];
    return next;
  });
}

export const setNodeHidden = (doc: Doc, ids: readonly string[], hidden: boolean): Doc =>
  setFlag(doc, ids, "hidden", hidden);
export const setNodeLocked = (doc: Doc, ids: readonly string[], locked: boolean): Doc =>
  setFlag(doc, ids, "locked", locked);
