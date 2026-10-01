/** What a row drag in the layers panel looks like (2026-10-01): the dragged row follows the pointer
 *  and its place in the list moves to the drop point, the rows it passes closing up behind it, as
 *  SortableJS did in the sibling apps (ported back from slop-spine) — but drawn over
 *  `layer-drop.ts`'s `dropTarget`, which still alone decides where a drop lands.
 *  Pure: no DOM, so it is testable. Every position is in the list's CONTENT coordinates (client y −
 *  list top + scrollTop), measured once when the drag starts, so rows sliding aside never move
 *  the targets they are measured against. */
import type { RowBox } from "./layer-drop";

/** How far the pointer travels before a press on a grip becomes a drag, so a tap lifts nothing. */
export const DRAG_THRESHOLD_PX = 3;
/** A row's height: the floating row's, and the bottom limit `ghostTop` keeps it above. */
export const ROW_PX = 32;
/** The band at the list's top and bottom edge that scrolls it, and the fastest step per frame. */
export const SCROLL_EDGE_PX = 32;
export const SCROLL_MAX_PX = 12;

export function pastThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/** How far each row slides while the `moving` rows hover over the drop `line`: they leave their
 *  places and stand together at the line — a layer with its objects, a group with its children,
 *  several selected objects from anywhere — and every other row closes up or makes room, so the
 *  list keeps its height and shows the order the drop will make. Only rows that move are listed;
 *  `line` null (a refused position) slides nothing. Rows may differ in height. The moving rows keep
 *  their own indent until the drop gives them their new one. */
export function slideOffsets(
  rows: readonly RowBox[],
  moving: ReadonlySet<string>,
  line: number | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (line === null || rows.length === 0) return out;
  const block = rows.filter((r) => moving.has(r.id));
  if (block.length === 0) return out;
  const stay = rows.filter((r) => !moving.has(r.id));
  let at = stay.findIndex((r) => r.top >= line - 0.5);
  if (at < 0) at = stay.length;
  let top = rows[0].top;
  for (const r of [...stay.slice(0, at), ...block, ...stay.slice(at)]) {
    if (Math.abs(top - r.top) > 0.5) out.set(r.id, top - r.top);
    top += r.bottom - r.top;
  }
  return out;
}

/** The floating row's top: the pointer less where on its row it was grabbed, kept inside the
 *  content so it cannot stretch the list (and so feed the auto-scroll) past its end. */
export function ghostTop(y: number, grab: number, contentHeight: number): number {
  return Math.min(Math.max(y - grab, 0), Math.max(contentHeight - ROW_PX, 0));
}

/** Pixels to scroll this frame for a pointer at client `y` over a list spanning `top`…`bottom`:
 *  negative near the top edge, positive near the bottom, faster the deeper into the band (or past
 *  it), zero elsewhere. */
export function autoScrollStep(y: number, top: number, bottom: number): number {
  const band = Math.min(SCROLL_EDGE_PX, (bottom - top) / 4);
  if (!(band > 0)) return 0;
  const depth = (d: number) => Math.min(d / band, 1) * SCROLL_MAX_PX;
  if (y < top + band) return -Math.ceil(depth(top + band - y));
  if (y > bottom - band) return Math.ceil(depth(y - (bottom - band)));
  return 0;
}
