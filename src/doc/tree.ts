import { IDENTITY, multiply, type Mat } from "../geom/mat";
import {
  isHidden,
  isLocked,
  type Doc,
  type Group,
  type Layer,
  type Node,
  type Shape,
} from "./document";

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
/** One node the user may reach right now, with the matrix its geometry sits in. */
export type Reachable = { node: Node; layer: Layer; parent: Mat };

/** True when this node, or anything containing it, is hidden or locked — its layer included. */
export function blocked(doc: Doc, id: string): boolean {
  const found = findNode(doc, id);
  if (!found) return true;
  if (!found.layer.visible || found.layer.locked) return true;
  if (isHidden(found.node) || isLocked(found.node)) return true;
  return ancestorIds(doc, id).some((a) => {
    const f = findNode(doc, a);
    return !f || isHidden(f.node) || isLocked(f.node);
  });
}

/** The entered group's children, or **null** when that group cannot be entered right now — it is
 *  gone, is not a group, or it (or something above it) is hidden or locked. Null is not the same as
 *  an empty list: callers fall back to the top level on null, which is what stops the canvas going
 *  dead the moment a group the user is inside gets hidden. */
export function enteredReach(doc: Doc, enteredGroupId: string | null): Reachable[] | null {
  if (enteredGroupId === null) return null;
  const found = findNode(doc, enteredGroupId);
  if (!found || found.node.kind !== "group" || blocked(doc, enteredGroupId)) return null;
  const parent = multiply(found.parent, found.node.transform);
  return found.node.children
    .filter((n) => !isHidden(n) && !isLocked(n))
    .map((node) => ({ node, layer: found.layer, parent }));
}

/** Every top-level node on a visible, unlocked layer that is not itself hidden or locked. */
export function topLevelReach(doc: Doc): Reachable[] {
  const out: Reachable[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const node of layer.children) {
      if (isHidden(node) || isLocked(node)) continue;
      out.push({ node, layer, parent: IDENTITY });
    }
  }
  return out;
}

/** What a *selection* command may reach: inside a valid entered group, that group's children alone;
 *  otherwise the top level. Document order; callers wanting z-order walk it backwards.
 *
 *  `hitTest` deliberately does NOT use this — see its own comment. The three rules share their
 *  ingredients (`enteredReach`, `topLevelReach`) rather than one verdict, so the hidden/locked
 *  clause is still written once (invariant 37, spec M9 §5). */
export function reachableNodes(doc: Doc, enteredGroupId: string | null = null): Reachable[] {
  return enteredReach(doc, enteredGroupId) ?? topLevelReach(doc);
}

export function selectableIds(doc: Doc, enteredGroupId: string | null = null): Set<string> {
  return new Set(reachableNodes(doc, enteredGroupId).map((r) => r.node.id));
}

/** Every id on a visible, unlocked layer, at any depth. Pruning must not depend on where the user
 *  is, or entering a group would drop the selection it just made. */
function existingIds(doc: Doc): Set<string> {
  const out = new Set<string>();
  const add = (n: Node) => {
    // A hidden or locked node, and everything inside it, is out of reach — so hiding or locking a
    // selected node deselects it through the ordinary prune rather than a special case (M9 §5).
    if (isHidden(n) || isLocked(n)) return;
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

/** Paint order: later children sit in front, so the greatest key is the frontmost. Shared by the
 *  booleans and by Combine, both of which build their result in the frontmost operand's place. */
export const paintKey = (layerIndex: number, path: readonly number[]): number[] => [
  layerIndex,
  ...path,
];

export const isAfter = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x > y;
  }
  return false;
};

/** Replaces one node with several, in its own parent and at its own index. Same reference when `id`
 *  is not found, or when `nodes` is empty — emptying a group that way would leave the shape the
 *  importer drops (invariant 27).
 *
 *  `mapNodes` is 1→1 and `insertNodes` appends to a layer, so neither can express Break apart's
 *  requirement that the fragments keep the original's place in the z-order (spec M11 §3). */
export function replaceNode(doc: Doc, id: string, nodes: readonly Node[]): Doc {
  if (nodes.length === 0) return doc;
  let hit = false;
  const walk = (children: readonly Node[]): Node[] | null => {
    const i = children.findIndex((n) => n.id === id);
    if (i >= 0) {
      hit = true;
      return [...children.slice(0, i), ...nodes, ...children.slice(i + 1)];
    }
    let changed = false;
    const out = children.map((n) => {
      if (n.kind !== "group") return n;
      const inner = walk(n.children);
      if (!inner) return n;
      changed = true;
      return { ...n, children: inner };
    });
    return changed ? out : null;
  };
  const layers = doc.layers.map((l) => {
    const c = walk(l.children);
    return c ? { ...l, children: c } : l;
  });
  return hit ? { ...doc, layers } : doc;
}
