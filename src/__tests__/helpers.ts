import type { Doc, Node } from "../doc/document";

/** Freeze recursively so a test fails loudly if code under test mutates its input. */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}

function stripNode(n: Node): Node {
  if (n.kind === "group") return { ...n, id: "", children: n.children.map(stripNode) };
  return { ...n, id: "" };
}

/** Ids are regenerated on import; compare documents without them. */
export function stripIds(doc: Doc): Doc {
  return {
    ...doc,
    nextId: 0,
    layers: doc.layers.map((l) => ({ ...l, id: "", children: l.children.map(stripNode) })),
  };
}
