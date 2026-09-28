/**
 * Drag-to-change arithmetic for `NumberField` (2026-09-28). Pure: no DOM, no store.
 *
 * Ported from slop-animator's `src/core/scrub.ts`, which mirrors slop-video-compositor's — same
 * threshold, same Shift-for-finer rule, same grid snap. One difference: many fields here have no
 * minimum (X, Y, spacing), so the grid is anchored at 0 when `min` is not finite.
 */

/** Travel before a press becomes a drag. Below this it is still a tap that focuses the field for
 *  typing, which is how one control serves both gestures. */
export const SCRUB_THRESHOLD_PX = 3;

/** Shift costs this many times more travel per step — finer control on the SAME grid. */
export const FINE_FACTOR = 4;

/** Digits after the point implied by `step`, for float cleanup. */
export function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

export interface ScrubArgs {
  /** Value at pointerdown. The drag is always measured from here, never accumulated, so returning
   *  the pointer to where it was pressed restores the value exactly. */
  startValue: number;
  dx: number; // clientX − startX
  step: number;
  pxPerStep: number;
  fine: boolean; // Shift held
  min: number;
  max: number;
}

export function scrubbedValue({
  startValue,
  dx,
  step,
  pxPerStep,
  fine,
  min,
  max,
}: ScrubArgs): number {
  if (!Number.isFinite(dx)) return startValue;
  const steps = Math.round(dx / (pxPerStep * (fine ? FINE_FACTOR : 1)));
  const anchor = Number.isFinite(min) ? min : 0;
  const raw = startValue + steps * step;
  const snapped = anchor + Math.round((raw - anchor) / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  return Number(clamped.toFixed(stepDecimals(step)));
}
