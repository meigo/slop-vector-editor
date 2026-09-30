/** Multi-finger taps: two fingers undo, three redo (iPad). Pure, so it is unit-tested; Canvas feeds
 *  it every touch pointer BEFORE routing, which can return early ("ignore", "menu") before the
 *  canvas tracks a pointer; a second or third finger is routed to "pinch" and joins the pinch.
 *
 *  Ported from slop-paint's `src/touch-gestures.ts` (the same rules, carry fixes both ways): a tap
 *  is reported only when the LAST finger lifts; no finger may have moved more than
 *  `TAP_MAX_DISTANCE` from where it landed; the last finger must lift within `TAP_MAX_DURATION` of
 *  its own touch-down; the count is the most fingers down at once; and a report within
 *  `DEBOUNCE_MS` of the previous one is dropped. A contact that moved resets the count, so a
 *  finished pinch cannot hand its "2" to the next stationary tap.
 *
 *  One rule of this app's own: `spoil()` — Canvas calls it when a Pencil or mouse is down during
 *  the contact. Routing ignores fingers under a running Pencil stroke (a resting palm, invariant
 *  16); without this, lifting that palm quickly would undo the stroke just drawn. */

type Pt = { x: number; y: number };

export const TAP_MAX_DURATION = 300; // ms
export const TAP_MAX_DISTANCE = 15; // px, on either axis
const DEBOUNCE_MS = 100;

export type FingerTap = {
  down(id: number, p: Pt, t: number): void;
  move(id: number, p: Pt): void;
  /** The finger count of a completed tap (2 or 3) on the last lift, else null. */
  up(id: number, t: number): 2 | 3 | null;
  /** A pointercancel: the contact can no longer be a tap. */
  cancel(id: number): void;
  /** A non-touch pointer is involved: the contact can no longer be a tap. */
  spoil(): void;
};

export function createFingerTap(): FingerTap {
  const fingers = new Map<number, { start: Pt; t: number }>();
  let max = 0;
  let spoiled = false;
  let lastReport = -Infinity;

  const end = (id: number) => {
    fingers.delete(id);
    if (fingers.size === 0) {
      max = 0;
      spoiled = false;
    }
  };

  return {
    down(id, p, t) {
      if (fingers.size === 0) {
        max = 0;
        spoiled = false;
      }
      fingers.set(id, { start: p, t });
      max = Math.max(max, fingers.size);
    },
    move(id, p) {
      const f = fingers.get(id);
      if (!f) return;
      if (
        Math.abs(p.x - f.start.x) > TAP_MAX_DISTANCE ||
        Math.abs(p.y - f.start.y) > TAP_MAX_DISTANCE
      ) {
        spoiled = true;
      }
    },
    up(id, t) {
      const f = fingers.get(id);
      if (!f) return null;
      const last = fingers.size === 1;
      const count = max;
      const ok = last && !spoiled && t - f.t < TAP_MAX_DURATION && (count === 2 || count === 3);
      end(id);
      if (!ok || t - lastReport < DEBOUNCE_MS) return null;
      lastReport = t;
      return count as 2 | 3;
    },
    cancel(id) {
      if (!fingers.has(id)) return;
      spoiled = true;
      end(id);
    },
    spoil() {
      if (fingers.size > 0) spoiled = true;
    },
  };
}
