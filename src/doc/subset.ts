import type { Doc, Layer, Node } from "./document";

/** Spec (M12) §4. The document reduced to the selection, for exporting a region that contains only
 *  the selected objects.
 *
 *  A selected node is kept **whole**, with its children. A node that merely *contains* a selected
 *  descendant is kept **pruned** to that descendant — which is what preserves its transform, since
 *  a node's geometry is expressed in its parent's space (invariant 26). Dropping the group and
 *  keeping the child would move the child.
 *
 *  A group or layer left with no children is dropped (invariant 27). This is not an edit: the
 *  result is handed straight to the serializer and never enters the session, so it does not owe
 *  invariant 1's same-reference guarantee. */
export function filterToSelection(doc: Doc, ids: readonly string[]): Doc {
  const set = new Set(ids);
  const keep = (n: Node): Node | null => {
    if (set.has(n.id)) return n;
    if (n.kind !== "group") return null;
    const children = n.children.flatMap((c) => keep(c) ?? []);
    return children.length > 0 ? { ...n, children } : null;
  };
  const layers: Layer[] = doc.layers.flatMap((l) => {
    const children = l.children.flatMap((c) => keep(c) ?? []);
    return children.length > 0 ? [{ ...l, children }] : [];
  });
  return { ...doc, layers };
}
