import { idFor, type Doc, type Layer, type Node } from "./document";
import { mapTopLevel } from "./tree";

/** Spec (M3a) §2–§3: pure layer, naming and z-order edits. Every edit returns the same document
 *  when nothing changes, and none leaves the document without a layer. */

const MAX_NAME = 100;

/** A user-typed name, trimmed and capped; null when nothing is left. Capped by code points, not
 *  UTF-16 units, so the cap never splits a surrogate pair. */
function cleanName(name: string): string | null {
  const trimmed = name.trim();
  const capped = Array.from(trimmed).slice(0, MAX_NAME).join("");
  return capped === "" ? null : capped;
}

export function resolveLayerId(doc: Doc, id: string | null): string {
  if (id !== null && doc.layers.some((l) => l.id === id)) return id;
  return doc.layers[doc.layers.length - 1].id;
}

export type LayerBlock = { name: string; reason: "hidden" | "locked" };

/** Why new objects can't go into a layer (hidden wins over locked); null when they can. */
export function layerBlock(doc: Doc, id: string): LayerBlock | null {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return null;
  if (!l.visible) return { name: l.name, reason: "hidden" };
  if (l.locked) return { name: l.name, reason: "locked" };
  return null;
}

export function blockMessage(block: LayerBlock, verb: "draw" | "paste"): string {
  const fix = block.reason === "hidden" ? "show it" : "unlock it";
  return `“${block.name}” is ${block.reason} — ${fix} to ${verb}.`;
}

function replaceLayer(doc: Doc, id: string, fn: (l: Layer) => Layer): Doc {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return doc;
  const next = fn(doc.layers[i]);
  if (next === doc.layers[i]) return doc;
  const layers = doc.layers.slice();
  layers[i] = next;
  return { ...doc, layers };
}

export function addLayer(doc: Doc, aboveId: string | null): { doc: Doc; id: string } {
  let highest = 0;
  for (const l of doc.layers) {
    const m = /^Layer (\d+)$/.exec(l.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  const id = idFor(doc.nextId);
  const layer: Layer = {
    id,
    name: `Layer ${highest + 1}`,
    visible: true,
    locked: false,
    children: [],
  };
  const at = aboveId === null ? -1 : doc.layers.findIndex((l) => l.id === aboveId);
  const layers = doc.layers.slice();
  layers.splice(at < 0 ? layers.length : at + 1, 0, layer);
  return { doc: { ...doc, layers, nextId: doc.nextId + 1 }, id };
}

export function deleteLayer(doc: Doc, id: string): Doc {
  if (doc.layers.length <= 1 || !doc.layers.some((l) => l.id === id)) return doc;
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id) };
}

export function renameLayer(doc: Doc, id: string, name: string): Doc {
  const clean = cleanName(name);
  if (clean === null) return doc;
  return replaceLayer(doc, id, (l) => (l.name === clean ? l : { ...l, name: clean }));
}

export function setLayerVisible(doc: Doc, id: string, visible: boolean): Doc {
  return replaceLayer(doc, id, (l) => (l.visible === visible ? l : { ...l, visible }));
}

export function setLayerLocked(doc: Doc, id: string, locked: boolean): Doc {
  return replaceLayer(doc, id, (l) => (l.locked === locked ? l : { ...l, locked }));
}

/** `toIndex` is the layer's index in the result (0 = bottom), clamped. */
export function moveLayer(doc: Doc, id: string, toIndex: number): Doc {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0 || !Number.isFinite(toIndex)) return doc;
  const to = Math.max(0, Math.min(doc.layers.length - 1, Math.round(toIndex)));
  if (to === from) return doc;
  const layers = doc.layers.slice();
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  return { ...doc, layers };
}

/** Moves top-level nodes (kept in document order) into `layerId` at `index`, counted among the
 *  target's children after the moved nodes are taken out (0 = bottom), clamped. */
export function moveNodes(doc: Doc, ids: readonly string[], layerId: string, index: number): Doc {
  const target = doc.layers.findIndex((l) => l.id === layerId);
  if (target < 0 || !Number.isFinite(index)) return doc;
  const set = new Set(ids);
  const moving: Node[] = [];
  const stripped = doc.layers.map((l) => {
    if (!l.children.some((n) => set.has(n.id))) return l;
    const kept: Node[] = [];
    for (const n of l.children) (set.has(n.id) ? moving : kept).push(n);
    return { ...l, children: kept };
  });
  if (moving.length === 0) return doc;
  const t = stripped[target];
  const at = Math.max(0, Math.min(t.children.length, Math.round(index)));
  const layers = stripped.slice();
  layers[target] = {
    ...t,
    children: [...t.children.slice(0, at), ...moving, ...t.children.slice(at)],
  };
  const unchanged = layers.every(
    (l, i) =>
      l.children.length === doc.layers[i].children.length &&
      l.children.every((n, j) => n === doc.layers[i].children[j]),
  );
  return unchanged ? doc : { ...doc, layers };
}

/** An empty name removes it, so the row falls back to its default label. */
export function renameNode(doc: Doc, id: string, name: string): Doc {
  const clean = cleanName(name);
  return mapTopLevel(doc, [id], (n) => {
    if ((n.name ?? null) === clean) return n;
    if (clean !== null) return { ...n, name: clean };
    const copy: Node = { ...n };
    delete copy.name;
    return copy;
  });
}

export function rowLabel(node: Node): string {
  if (node.name) return node.name;
  switch (node.kind) {
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "polygon":
      return node.star ? "Star" : "Polygon";
    case "path":
      return "Path";
    case "group":
      return "Group";
  }
}

/** Reorders each layer holding a selected node; layers without one are untouched. */
function reorder(
  doc: Doc,
  ids: readonly string[],
  fn: (children: Node[], selected: (n: Node) => boolean) => Node[],
): Doc {
  const set = new Set(ids);
  const selected = (n: Node) => set.has(n.id);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (!l.children.some(selected)) return l;
    const next = fn(l.children, selected);
    if (next.every((n, i) => n === l.children[i])) return l;
    changed = true;
    return { ...l, children: next };
  });
  return changed ? { ...doc, layers } : doc;
}

function swap(list: Node[], i: number, j: number): void {
  [list[i], list[j]] = [list[j], list[i]];
}

/** Each selected node moves one step up, past the next unselected sibling; working top-down
 *  moves a contiguous block together. */
export function bringForward(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => {
    const out = children.slice();
    for (let i = out.length - 2; i >= 0; i--) {
      if (selected(out[i]) && !selected(out[i + 1])) swap(out, i, i + 1);
    }
    return out;
  });
}

export function sendBackward(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => {
    const out = children.slice();
    for (let i = 1; i < out.length; i++) {
      if (selected(out[i]) && !selected(out[i - 1])) swap(out, i, i - 1);
    }
    return out;
  });
}

export function bringToFront(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => [
    ...children.filter((n) => !selected(n)),
    ...children.filter(selected),
  ]);
}

export function sendToBack(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => [
    ...children.filter(selected),
    ...children.filter((n) => !selected(n)),
  ]);
}
