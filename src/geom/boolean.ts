import type { Subpath } from "../doc/document";
import { fromPaperItem, loadPaper, toPaperItem } from "./paper";

/** Spec (M7) §4. */
export type BoolOp = "unite" | "subtract" | "intersect" | "exclude";

/** The command names, used by every surface and by the notices, so they cannot drift apart. */
export const BOOL_LABEL: Readonly<Record<BoolOp, string>> = {
  unite: "Unite",
  subtract: "Subtract",
  intersect: "Intersect",
  exclude: "Exclude",
};

export const BOOL_OPS: readonly BoolOp[] = ["unite", "subtract", "intersect", "exclude"];

/** Tooltips read as actions, because every title is also the status-bar hint (invariant 24). */
export const BOOL_TITLE: Readonly<Record<BoolOp, string>> = {
  unite: "Combine the selected shapes into one",
  subtract: "Remove what is in front from what is behind",
  intersect: "Keep only where the selected shapes overlap",
  exclude: "Keep everything except where they overlap",
};

/** Spec (M7) §7. */
export const BOOL_REASON = {
  few: "select two or more shapes",
  group: "a group can't take part",
  open: "an open path can't take part",
} as const;

/** Spec (M7) §4. Every operand is in document space already. Returns [] when the result is empty —
 *  the caller must leave the document alone rather than write a path the importer would drop. */
export async function booleanOf(
  operands: readonly (readonly Subpath[])[],
  op: BoolOp,
): Promise<Subpath[]> {
  const P = await loadPaper();
  const items = operands.map((o) => toPaperItem(P, o));
  let acc = items[0];
  // The result is not inserted either, for the same reason.
  for (const next of items.slice(1)) acc = acc[op](next, { insert: false });
  return fromPaperItem(acc);
}
