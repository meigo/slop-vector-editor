/** Snapshot undo, generic over the snapshot type. Documents are immutable, so a snapshot is just
 *  a reference — no cloning, no command objects. */

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: T[];
  future: T[];
}

export function createHistory<T>(): History<T> {
  return { past: [], future: [] };
}

export function canUndo(h: History<unknown>): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History<unknown>): boolean {
  return h.future.length > 0;
}

/** Call with the state as it was BEFORE the edit. A new edit invalidates the redo stack. */
export function record<T>(h: History<T>, previous: T): History<T> {
  const past = [...h.past, previous];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.past.length === 0) return null;
  const past = h.past.slice();
  const state = past.pop()!;
  return { history: { past, future: [...h.future, current] }, state };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.future.length === 0) return null;
  const future = h.future.slice();
  const state = future.pop()!;
  return { history: { past: [...h.past, current], future }, state };
}
