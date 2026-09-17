import { IDENTITY, multiply, type Mat } from "../geom/mat";
import type { Doc, Group, Layer, Node, Shape } from "./document";

export type Found = {
  layer: Layer;
  layerIndex: number;
  /** Child indices from the layer down; the last entry is the node's own index. */
  path: readonly number[];
  /** The node's index in its own parent — `path`'s last entry, kept for callers that only need it. */
  index: number;
  node: Node;
  /** The accumulated matrix of the node's ancestors, without the node's own transform. */
  parent: Mat;
  /** The group holding the node, or null when it sits directly in a layer. */
  parentGroup: Group | null;
};

type Inner = Omit<Found, "layer" | "layerIndex">;

function search(
  children: readonly Node[],
  id: string,
  parent: Mat,
  parentGroup: Group | null,
  prefix: readonly number[],
): Inner | null {
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const path = [...prefix, i];
    if (node.id === id) return { path, index: i, node, parent, parentGroup };
    if (node.kind === "group") {
      const inner = search(node.children, id, multiply(parent, node.transform), node, path);
      if (inner) return inner;
    }
  }
  return null;
}

/** Spec (M3b) §2.1: a node at any depth, with the matrix of everything above it. */
export function findNode(doc: Doc, id: string): Found | null {
  for (let layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
    const layer = doc.layers[layerIndex];
    const inner = search(layer.children, id, IDENTITY, null, []);
    if (inner) return { layer, layerIndex, ...inner };
  }
  return null;
}

/** The groups above `id`, outermost first; empty when it sits directly in a layer. */
export function ancestorIds(doc: Doc, id: string): string[] {
  const walk = (children: readonly Node[], chain: string[]): string[] | null => {
    for (const n of children) {
      if (n.id === id) return chain;
      if (n.kind === "group") {
        const found = walk(n.children, [...chain, n.id]);
        if (found) return found;
      }
    }
    return null;
  };
  for (const layer of doc.layers) {
    const found = walk(layer.children, []);
    if (found) return found;
  }
  return [];
}

/** Ids a canvas gesture may select: inside a group, its direct children; otherwise the top-level
 *  nodes of visible, unlocked layers. */
export function selectableIds(doc: Doc, enteredGroupId: string | null = null): Set<string> {
  const out = new Set<string>();
  if (enteredGroupId !== null) {
    const found = findNode(doc, enteredGroupId);
    if (found && found.node.kind === "group" && found.layer.visible && !found.layer.locked) {
      for (const c of found.node.children) out.add(c.id);
      return out;
    }
  }
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const n of layer.children) out.add(n.id);
  }
  return out;
}

/** Every id on a visible, unlocked layer, at any depth. Pruning must not depend on where the user
 *  is, or entering a group would drop the selection it just made. */
function existingIds(doc: Doc): Set<string> {
  const out = new Set<string>();
  const add = (n: Node) => {
    out.add(n.id);
    if (n.kind === "group") for (const c of n.children) add(c);
  };
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const n of layer.children) add(n);
  }
  return out;
}

export function pruneSelection(doc: Doc, ids: readonly string[]): readonly string[] {
  const ok = existingIds(doc);
  const seen = new Set<string>();
  const kept = ids.filter((id) => {
    if (!ok.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return kept.length === ids.length ? ids : kept;
}

/** Edits nodes by id at any depth. `fn` receives the node's parent matrix; a node that `fn`
 *  replaces is not descended into. Same reference when nothing changes. */
export function mapNodes(
  doc: Doc,
  ids: readonly string[],
  fn: (n: Node, parent: Mat) => Node,
): Doc {
  const set = new Set(ids);
  if (set.size === 0) return doc;
  const walk = (children: readonly Node[], parent: Mat): Node[] | null => {
    let hit = false;
    const out = children.map((n) => {
      if (set.has(n.id)) {
        const m = fn(n, parent);
        if (m !== n) hit = true;
        return m;
      }
      if (n.kind === "group") {
        const inner = walk(n.children, multiply(parent, n.transform));
        if (inner) {
          hit = true;
          return { ...n, children: inner };
        }
      }
      return n;
    });
    return hit ? out : null;
  };
  let changed = false;
  const layers = doc.layers.map((layer) => {
    const children = walk(layer.children, IDENTITY);
    if (!children) return layer;
    changed = true;
    return { ...layer, children };
  });
  return changed ? { ...doc, layers } : doc;
}

export function mapShapes(node: Node, fn: (s: Shape) => Shape): Node {
  if (node.kind !== "group") return fn(node);
  let changed = false;
  const children = node.children.map((c) => {
    const m = mapShapes(c, fn);
    if (m !== c) changed = true;
    return m;
  });
  return changed ? { ...node, children } : node;
}

export function shapesOf(node: Node): Shape[] {
  if (node.kind !== "group") return [node];
  return node.children.flatMap(shapesOf);
}
