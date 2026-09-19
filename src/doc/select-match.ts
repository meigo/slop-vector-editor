import type { Doc, Node, Paint, Style } from "./document";
import { findNode, selectableIds } from "./tree";

/** What "the same" means for `sameIds` (spec M6 §3). */
export type MatchField = "fill" | "stroke" | "style" | "kind";

/** Colours compare exactly: the document stores what the user picked, and a nearly-equal orange is
 *  a different colour. `null` (no paint) matches only `null`. */
const samePaint = (a: Paint | null, b: Paint | null): boolean =>
  a === null || b === null ? a === b : a.color === b.color && a.opacity === b.opacity;

const sameStyle = (a: Style, b: Style): boolean =>
  samePaint(a.fill, b.fill) &&
  samePaint(a.stroke, b.stroke) &&
  a.strokeWidth === b.strokeWidth &&
  a.cap === b.cap &&
  a.join === b.join &&
  a.opacity === b.opacity;

/** A group has no `Style`, so it is neither a seed nor a candidate for the paint fields. */
const styleOf = (n: Node): Style | null => (n.kind === "group" ? null : n.style);

function matches(field: MatchField, a: Node, b: Node): boolean {
  if (field === "kind") return a.kind === b.kind;
  const x = styleOf(a);
  const y = styleOf(b);
  if (x === null || y === null) return false;
  if (field === "fill") return samePaint(x.fill, y.fill);
  if (field === "stroke") return samePaint(x.stroke, y.stroke);
  return sameStyle(x, y);
}

/** Reach, for every command here: the entered group's children, or every top-level node on a
 *  visible, unlocked layer (spec M6 §4). In document order. */
export function allIds(doc: Doc, entered: string | null): string[] {
  return [...selectableIds(doc, entered)];
}

export function invertIds(doc: Doc, ids: readonly string[], entered: string | null): string[] {
  const selected = new Set(ids);
  return allIds(doc, entered).filter((id) => !selected.has(id));
}

/** Every id in reach matching any selected node on `field`. The seeds match themselves, so the
 *  selection never shrinks (spec M6 §3). */
export function sameIds(
  doc: Doc,
  ids: readonly string[],
  entered: string | null,
  field: MatchField,
): string[] {
  const seeds = ids.flatMap((id) => findNode(doc, id)?.node ?? []);
  if (seeds.length === 0) return [];
  return allIds(doc, entered).filter((id) => {
    const node = findNode(doc, id)?.node;
    return node !== undefined && seeds.some((seed) => matches(field, node, seed));
  });
}
