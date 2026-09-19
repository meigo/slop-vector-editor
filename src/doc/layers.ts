import { IDENTITY, multiply, reparent, sameMat, type Mat } from "../geom/mat";
import { idFor, type Doc, type Layer, type Node } from "./document";
import { ancestorIds, findNode, mapNodes } from "./tree";

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

/** Spec (M3b) §5. Moves top-level or nested nodes into `parentId` (a layer or a group) at `index`,
 *  counted among the target's children after the moved nodes are taken out, clamped. Document
 *  order is kept, each node keeps its place on screen, and a group left empty is removed. */
export function moveNodes(doc: Doc, ids: readonly string[], parentId: string, index: number): Doc {
  if (!Number.isFinite(index)) return doc;
  const set = new Set(ids);
  if (set.size === 0 || set.has(parentId)) return doc;

  const layerTarget = doc.layers.some((l) => l.id === parentId);
  const found = layerTarget ? null : findNode(doc, parentId);
  if (!layerTarget && (!found || found.node.kind !== "group")) return doc;
  // A group cannot be moved into itself.
  if (found && ancestorIds(doc, parentId).some((a) => set.has(a))) return doc;
  const targetMat = found ? multiply(found.parent, found.node.transform) : IDENTITY;

  // 1. Take the moved nodes out, in document order, re-expressing each in the target's space.
  let failed = false;
  const moving: Node[] = [];
  const strip = (children: readonly Node[], parent: Mat): Node[] | null => {
    let hit = false;
    const out: Node[] = [];
    for (const n of children) {
      if (set.has(n.id)) {
        hit = true;
        if (sameMat(parent, targetMat)) {
          moving.push(n);
        } else {
          const t = reparent(parent, targetMat, n.transform);
          if (!t) {
            failed = true;
            return null;
          }
          moving.push({ ...n, transform: t });
        }
        continue;
      }
      if (n.kind === "group") {
        const inner = strip(n.children, multiply(parent, n.transform));
        if (failed) return null;
        if (inner) {
          hit = true;
          // An emptied group goes, unless it is the target we are about to fill.
          if (inner.length > 0 || n.id === parentId) out.push({ ...n, children: inner });
          continue;
        }
      }
      out.push(n);
    }
    return hit ? out : null;
  };

  const strippedLayers = doc.layers.map((l) => {
    if (failed) return l;
    const children = strip(l.children, IDENTITY);
    return children ? { ...l, children } : l;
  });
  if (failed || moving.length === 0) return doc;

  // 2. Put them into the target.
  const insert = (children: readonly Node[]): Node[] => {
    const at = Math.max(0, Math.min(children.length, Math.round(index)));
    return [...children.slice(0, at), ...moving, ...children.slice(at)];
  };
  let layers: Layer[];
  if (layerTarget) {
    layers = strippedLayers.map((l) =>
      l.id === parentId ? { ...l, children: insert(l.children) } : l,
    );
  } else {
    const fill = (children: readonly Node[]): Node[] | null => {
      let hit = false;
      const out = children.map((n) => {
        if (n.kind !== "group") return n;
        if (n.id === parentId) {
          hit = true;
          return { ...n, children: insert(n.children) };
        }
        const inner = fill(n.children);
        if (inner) {
          hit = true;
          return { ...n, children: inner };
        }
        return n;
      });
      return hit ? out : null;
    };
    layers = strippedLayers.map((l) => {
      const children = fill(l.children);
      return children ? { ...l, children } : l;
    });
  }

  const next: Doc = { ...doc, layers };
  return sameTree(doc, next) ? doc : next;
}

/** Reference-identity comparison of two documents' node trees. */
function sameTree(a: Doc, b: Doc): boolean {
  const same = (x: readonly Node[], y: readonly Node[]): boolean =>
    x.length === y.length &&
    x.every((n, i) => {
      const m = y[i];
      if (n === m) return true;
      if (n.kind !== "group" || m.kind !== "group") return false;
      return n.id === m.id && n.transform === m.transform && same(n.children, m.children);
    });
  return a.layers.every((l, i) => same(l.children, b.layers[i].children));
}

/** An empty name removes it, so the row falls back to its default label. */
export function renameNode(doc: Doc, id: string, name: string): Doc {
  const clean = cleanName(name);
  return mapNodes(doc, [id], (n) => {
    if ((n.name ?? null) === clean) return n;
    if (clean !== null) return { ...n, name: clean };
    const copy: Node = { ...n };
    delete copy.name;
    return copy;
  });
}

/** The longest title text a row shows before it is cut. `rowLabel` feeds tooltips, `aria-label`s
 *  and the node tool's refusal notice as well as the row itself — the row truncates in CSS, but
 *  those do not, and a title can be a paragraph. */
const LABEL_MAX = 24;

/** A title's own text is its label, the way every other editor does it (spec M10e §6). One line
 *  only, whitespace collapsed: a multi-line title would otherwise put a newline through a row, a
 *  tooltip and an aria-label. A title that is nothing but whitespace still needs a name, and
 *  "Title" is better there than a row that looks empty. */
function titleLabel(text: string): string {
  const line = text.split("\n", 1)[0].replace(/\s+/g, " ").trim();
  if (line === "") return "Title";
  return [...line].length > LABEL_MAX ? `${[...line].slice(0, LABEL_MAX).join("")}…` : line;
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
      return node.text ? titleLabel(node.text.text) : "Path";
    case "group":
      return "Group";
  }
}

/** Reorders every parent that holds a selected child, at any depth. */
function reorder(
  doc: Doc,
  ids: readonly string[],
  fn: (children: Node[], selected: (n: Node) => boolean) => Node[],
): Doc {
  const set = new Set(ids);
  if (set.size === 0) return doc;
  const selected = (n: Node) => set.has(n.id);
  const walk = (children: readonly Node[]): Node[] | null => {
    let next: Node[] | null = null;
    if (children.some(selected)) {
      const out = fn(children.slice(), selected);
      if (!out.every((n, i) => n === children[i])) next = out;
    }
    const base = next ?? children;
    let withGroups: Node[] | null = null;
    base.forEach((n, i) => {
      if (n.kind !== "group") return;
      const inner = walk(n.children);
      if (!inner) return;
      withGroups ??= base.slice();
      withGroups[i] = { ...n, children: inner };
    });
    return withGroups ?? next;
  };
  let changed = false;
  const layers = doc.layers.map((l) => {
    const children = walk(l.children);
    if (!children) return l;
    changed = true;
    return { ...l, children };
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
