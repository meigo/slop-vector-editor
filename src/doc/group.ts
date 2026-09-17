import { IDENTITY, multiply } from "../geom/mat";
import { idFor, type Doc, type Group, type Node } from "./document";
import { moveNodes } from "./layers";
import { findNode } from "./tree";

/** Spec (M3b) §4. Group and Ungroup. Both return the same document when nothing changes. */

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The selected ids in document order, with any node that sits inside another selected node
 *  dropped — grouping a group together with its own child means grouping the group. */
function outermost(doc: Doc, ids: readonly string[]): string[] {
  const set = new Set(ids);
  const kept: string[] = [];
  const walk = (children: readonly Node[], insideSelected: boolean) => {
    for (const n of children) {
      const selected = set.has(n.id);
      if (selected && !insideSelected) kept.push(n.id);
      if (n.kind === "group") walk(n.children, insideSelected || selected);
    }
  };
  for (const layer of doc.layers) walk(layer.children, false);
  return kept;
}

/** Puts one node into a layer or group at `index`; null when the parent is unknown. */
function insertInto(doc: Doc, parentId: string, index: number, node: Node): Doc | null {
  const layerIndex = doc.layers.findIndex((l) => l.id === parentId);
  if (layerIndex >= 0) {
    const layers = doc.layers.slice();
    const children = layers[layerIndex].children.slice();
    children.splice(index, 0, node);
    layers[layerIndex] = { ...layers[layerIndex], children };
    return { ...doc, layers };
  }
  let done = false;
  const put = (children: readonly Node[]): Node[] =>
    children.map((n) => {
      if (n.kind !== "group") return n;
      if (n.id === parentId) {
        done = true;
        const next = n.children.slice();
        next.splice(index, 0, node);
        return { ...n, children: next };
      }
      return { ...n, children: put(n.children) };
    });
  const layers = doc.layers.map((l) => ({ ...l, children: put(l.children) }));
  return done ? { ...doc, layers } : null;
}

export function groupNodes(doc: Doc, ids: readonly string[]): { doc: Doc; id: string | null } {
  const members = outermost(doc, ids);
  if (members.length === 0) return { doc, id: null };

  // The group takes the place of the frontmost member, in that member's own parent.
  const front = findNode(doc, members[members.length - 1]);
  if (!front) return { doc, id: null };
  const parentId = front.parentGroup ? front.parentGroup.id : front.layer.id;
  // The empty group goes in at the frontmost member's own index, before anything is moved; the
  // members are then taken out around it, so it ends up exactly where that member was.
  const index = front.index;

  const id = idFor(doc.nextId);
  const empty: Group = { kind: "group", id, transform: IDENTITY, opacity: 1, children: [] };
  const withGroup = insertInto(doc, parentId, index, empty);
  if (!withGroup) return { doc, id: null };

  const filled = moveNodes({ ...withGroup, nextId: doc.nextId + 1 }, members, id, 0);
  const group = findNode(filled, id);
  if (!group || group.node.kind !== "group" || group.node.children.length !== members.length) {
    return { doc, id: null };
  }
  return { doc: filled, id };
}

export function ungroupNodes(doc: Doc, ids: readonly string[]): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  if (set.size === 0) return { doc, ids: [] };
  const result: string[] = [];
  let changed = false;

  const fold = (child: Node, opacity: number): Node => {
    if (opacity === 1) return child;
    if (child.kind === "group") return { ...child, opacity: round6(child.opacity * opacity) };
    return { ...child, style: { ...child.style, opacity: round6(child.style.opacity * opacity) } };
  };

  const walk = (children: readonly Node[]): Node[] | null => {
    let hit = false;
    const out: Node[] = [];
    for (const n of children) {
      if (set.has(n.id) && n.kind === "group") {
        hit = true;
        for (const c of n.children) {
          const composed: Node = {
            ...fold(c, n.opacity),
            transform: multiply(n.transform, c.transform),
          };
          out.push(composed);
          result.push(composed.id);
        }
        continue;
      }
      if (set.has(n.id)) result.push(n.id);
      if (n.kind === "group") {
        const inner = walk(n.children);
        if (inner) {
          hit = true;
          out.push({ ...n, children: inner });
          continue;
        }
      }
      out.push(n);
    }
    return hit ? out : null;
  };

  const layers = doc.layers.map((l) => {
    const children = walk(l.children);
    if (!children) return l;
    changed = true;
    return { ...l, children };
  });
  return changed ? { doc: { ...doc, layers }, ids: result } : { doc, ids: result };
}
