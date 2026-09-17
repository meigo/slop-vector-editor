/** Shared by the layers panel and the select tool. Spec (M3a) §5: rename starts on a double tap.
 *  Decided on pointerup so it works on iPad, where Safari does not reliably fire dblclick. */
export type Tap = { id: string; time: number };

export const DOUBLE_TAP_MS = 350;

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev || prev.id !== next.id) return false;
  const gap = next.time - prev.time;
  return gap >= 0 && gap <= DOUBLE_TAP_MS;
}
