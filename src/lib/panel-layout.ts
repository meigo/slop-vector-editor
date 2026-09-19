/** The sidebar's width (spec M10e §3). Pure: no store, no DOM, no Svelte — the clamp and the drag
 *  maths live here and are unit-tested, exactly as `split.ts` does for the vertical divider.
 *
 *  Deliberately the same shape as the sibling slop apps' `panel-layout.ts` (slop-animator,
 *  slop-paint, slop-spine, slop-audio-editor all ship a near-identical copy): a `MIN`, a `DEFAULT`,
 *  a clamp of `[MIN, half the viewport]` where MIN always wins, and a `resized…` helper that
 *  recomputes from the pointer-down snapshot rather than accumulating deltas. */

/** The narrowest useful sidebar. A properties row is label + field + unit, and the field needs
 *  ~108px before it starts clipping its own digits (invariant 40); with the 12px padding either
 *  side, an 8px gap and a label column of ~60px, 200px is where the field hits that floor. Below
 *  it the panel still *works* — `minmax(0, 1fr)` shrinks the field rather than overflowing — but
 *  it stops being readable. */
export const MIN_SIDEBAR_PX = 200;

/** What a fresh install gets: the fixed `w-60` this panel had before it could be resized, so
 *  nothing moves for anyone who never drags the grip. */
export const DEFAULT_SIDEBAR_PX = 240;

/** The grip's hit strip. 8px, matching every sibling app; it is positioned over the panel's left
 *  border rather than taking a column of its own, so widening it costs the panel no content. */
export const GRIP_PX = 8;

/** Keep `px` inside `[MIN_SIDEBAR_PX, half the viewport]`. The minimum wins over the ceiling, so a
 *  window narrower than 400px gets a 200px sidebar rather than an unusable sliver — the canvas is
 *  the thing that should lose there, since it can be panned and zoomed and the panel cannot. */
export function clampSidebarWidth(px: number, viewportPx: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_PX;
  const max = Number.isFinite(viewportPx)
    ? Math.max(MIN_SIDEBAR_PX, Math.round(viewportPx * 0.5))
    : MIN_SIDEBAR_PX;
  return Math.min(max, Math.max(MIN_SIDEBAR_PX, Math.round(px)));
}

/** The width a drag lands on. The sidebar is docked right, so travel **left** widens it — hence
 *  `startX - clientX` rather than the other way round. Recomputed from the pointer-down snapshot
 *  every move, never accumulated, so a dropped move event cannot make the width drift. */
export function resizedSidebarWidth(
  startPx: number,
  startX: number,
  clientX: number,
  viewportPx: number,
): number {
  return clampSidebarWidth(startPx + (startX - clientX), viewportPx);
}
