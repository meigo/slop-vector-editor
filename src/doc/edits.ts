import {
  idFor,
  isValidArtboardSize,
  type Artboard,
  type Doc,
  type Node,
  type Paint,
  type Shape,
  type Style,
} from "./document";
import { IDENTITY, isIdentity, multiply, rotateAbout, translate } from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import type { Vec } from "../geom/vec";
import { mapShapes, mapTopLevel } from "./tree";

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

export function deleteNodes(doc: Doc, ids: readonly string[]): Doc {
  const set = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((l) => {
    const children = l.children.filter((n) => !set.has(n.id));
    if (children.length === l.children.length) return l;
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
  const next = () => idFor(nextId++);
  const created: string[] = [];
  const offset = translate(dx, dy);
  const layers = doc.layers.map((l) => {
    if (!l.children.some((n) => set.has(n.id))) return l;
    const children: Node[] = [];
    for (const n of l.children) {
      children.push(n);
      if (!set.has(n.id)) continue;
      const copy = withFreshIds(n, next);
      const moved: Node =
        dx === 0 && dy === 0 ? copy : { ...copy, transform: multiply(offset, copy.transform) };
      children.push(moved);
      created.push(moved.id);
    }
    return { ...l, children };
  });
  if (created.length === 0) return { doc, ids: [] };
  return { doc: { ...doc, layers, nextId }, ids: created };
}

export function translateNodes(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc;
  const t = translate(dx, dy);
  return mapTopLevel(doc, ids, (n) => ({ ...n, transform: multiply(t, n.transform) }));
}

export function rotateNodes(doc: Doc, ids: readonly string[], angle: number, centre: Vec): Doc {
  if (angle === 0) return doc;
  const r = rotateAbout(angle, centre);
  return mapTopLevel(doc, ids, (n) => ({ ...n, transform: multiply(r, n.transform) }));
}

function styleMatches(s: Style, patch: Partial<Style>): boolean {
  return (Object.keys(patch) as (keyof Style)[]).every((k) =>
    k === "fill" || k === "stroke"
      ? samePaint(s[k], (patch[k] ?? null) as Paint | null)
      : s[k] === patch[k],
  );
}

export function setStyle(doc: Doc, ids: readonly string[], patch: Partial<Style>): Doc {
  return mapTopLevel(doc, ids, (n) =>
    mapShapes(n, (s) =>
      styleMatches(s.style, patch) ? s : { ...s, style: { ...s.style, ...patch } },
    ),
  );
}

export function setRectRadius(doc: Doc, ids: readonly string[], rx: number): Doc {
  if (!Number.isFinite(rx)) return doc;
  return mapTopLevel(doc, ids, (n) => {
    if (n.kind !== "rect") return n;
    const r = Math.max(0, Math.min(rx, n.w / 2, n.h / 2));
    return r === n.rx ? n : { ...n, rx: r };
  });
}

export function convertToPath(doc: Doc, ids: readonly string[]): Doc {
  return mapTopLevel(doc, ids, (n) => (n.kind === "rect" || n.kind === "ellipse" ? toPath(n) : n));
}

export function flattenTransform(doc: Doc, ids: readonly string[]): Doc {
  return mapTopLevel(doc, ids, (n) =>
    n.kind === "path" && !isIdentity(n.transform)
      ? { ...n, subpaths: transformSubpaths(n.subpaths, n.transform), transform: IDENTITY }
      : n,
  );
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
