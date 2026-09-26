/** Keeping the selected layer row in view (spec 2026-09-26 §4). Pure: no DOM, so it is testable. */

/** The scrollTop that shows [rowTop, rowBottom] — both in the list's content coordinates — inside
 *  a viewport of `viewHeight` currently scrolled to `scrollTop`, moving as little as possible.
 *  Returns `scrollTop` itself when the row is already fully visible, so a click on a visible row
 *  never scrolls. A row taller than the viewport aligns its top. */
export function revealScrollTop(
  scrollTop: number,
  viewHeight: number,
  rowTop: number,
  rowBottom: number,
): number {
  if (!(viewHeight > 0)) return scrollTop;
  if (rowTop < scrollTop || rowBottom - rowTop > viewHeight) return rowTop;
  if (rowBottom > scrollTop + viewHeight) return rowBottom - viewHeight;
  return scrollTop;
}
