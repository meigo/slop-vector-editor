import type { Doc } from "../doc/document";
import { layerBlock, moveLayer, moveNodes } from "../doc/layers";
import { findNode } from "../doc/tree";

/** Spec (M3a) §5: where a row dragged in the layers panel would land. Rows are in display order
 *  (top first) with their on-screen top/bottom; `line` is where to draw the drop indicator. */
export type RowBox = { kind: "layer" | "node"; id: string; top: number; bottom: number };
export type Drag = { kind: "layer"; id: string } | { kind: "node"; ids: readonly string[] };
export type Drop =
  | { kind: "layer"; index: number; line: number }
  | { kind: "node"; layerId: string; index: number; line: number };

const mid = (r: RowBox) => (r.top + r.bottom) / 2;

export function dropTarget(doc: Doc, rows: readonly RowBox[], y: number, drag: Drag): Drop | null {
  if (rows.length === 0) return null;

  if (drag.kind === "layer") {
    const others = rows.filter((r) => r.kind === "layer" && r.id !== drag.id);
    const slot = others.filter((r) => mid(r) < y).length;
    const index = doc.layers.length - 1 - slot;
    if (moveLayer(doc, drag.id, index) === doc) return null;
    const line = slot < others.length ? others[slot].top : rows[rows.length - 1].bottom;
    return { kind: "layer", index, line };
  }

  const row =
    rows.find((r) => y >= r.top && y < r.bottom) ??
    (y < rows[0].top ? rows[0] : rows[rows.length - 1]);
  let layerId: string;
  let slotIndex: number;
  let line: number;
  if (row.kind === "layer") {
    const layer = doc.layers.find((l) => l.id === row.id);
    if (!layer) return null;
    layerId = layer.id;
    slotIndex = layer.children.length;
    line = row.bottom;
  } else {
    const found = findNode(doc, row.id);
    if (!found) return null;
    const upper = y < mid(row);
    layerId = found.layer.id;
    slotIndex = upper ? found.index + 1 : found.index;
    line = upper ? row.top : row.bottom;
  }
  if (layerBlock(doc, layerId)) return null;
  const target = doc.layers.find((l) => l.id === layerId)!;
  const moving = new Set(drag.ids);
  const index = target.children.slice(0, slotIndex).filter((n) => !moving.has(n.id)).length;
  if (moveNodes(doc, drag.ids, layerId, index) === doc) return null;
  return { kind: "node", layerId, index, line };
}
