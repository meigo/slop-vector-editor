import type { Doc, Layer, Node, Shape } from "./document";

export type Found = { layer: Layer; layerIndex: number; index: number; node: Node };

export function findTopLevel(doc: Doc, id: string): Found | null {
  for (let layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
    const layer = doc.layers[layerIndex];
    const index = layer.children.findIndex((n) => n.id === id);
    if (index >= 0) return { layer, layerIndex, index, node: layer.children[index] };
  }
  return null;
}

/** Top-level ids on visible, unlocked layers — the only nodes a user can select. */
export function selectableIds(doc: Doc): Set<string> {
  const out = new Set<string>();
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const n of layer.children) out.add(n.id);
  }
  return out;
}

export function pruneSelection(doc: Doc, ids: readonly string[]): readonly string[] {
  const ok = selectableIds(doc);
  const seen = new Set<string>();
  const kept = ids.filter((id) => {
    if (!ok.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return kept.length === ids.length ? ids : kept;
}

export function mapTopLevel(doc: Doc, ids: readonly string[], fn: (n: Node) => Node): Doc {
  const set = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((layer) => {
    let layerChanged = false;
    const children = layer.children.map((n) => {
      if (!set.has(n.id)) return n;
      const m = fn(n);
      if (m !== n) layerChanged = true;
      return m;
    });
    if (!layerChanged) return layer;
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
