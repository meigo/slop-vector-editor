/** Long press: a still finger or Pencil held for `LONG_PRESS_MS` opens the context menu on touch
 *  (2026-09-30). The right-click route stays mouse-only (invariant 16) — iPadOS can raise its own
 *  `contextmenu` at awkward moments — so touch and Pencil get this detector of their own. It only
 *  times and measures; `Canvas.svelte` decides when to start it and what firing does. Timers are
 *  the global ones, so tests drive it with fake timers. */

type Pt = { x: number; y: number };

export const LONG_PRESS_MS = 500;
/** How far a held finger may drift and still be "still" (screen px, either axis): the touch reach
 *  of a handle, so a press on a handle that trembles is still a long press. */
export const LONG_PRESS_SLOP = 10;

export type LongPress = {
  start(id: number, at: Pt): void;
  move(id: number, at: Pt): void;
  end(id: number): void;
  cancel(): void;
};

export function createLongPress(onFire: (at: Pt) => void): LongPress {
  let pending: { id: number; at: Pt; timer: ReturnType<typeof setTimeout> } | null = null;

  const cancel = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };

  return {
    start(id, at) {
      cancel();
      const timer = setTimeout(() => {
        pending = null;
        onFire(at);
      }, LONG_PRESS_MS);
      pending = { id, at, timer };
    },
    move(id, at) {
      if (!pending || pending.id !== id) return;
      if (
        Math.abs(at.x - pending.at.x) > LONG_PRESS_SLOP ||
        Math.abs(at.y - pending.at.y) > LONG_PRESS_SLOP
      ) {
        cancel();
      }
    },
    end(id) {
      if (pending?.id === id) cancel();
    },
    cancel,
  };
}
