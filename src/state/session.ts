import type { Doc } from "../doc/document";
import { createHistory, record, redo, undo, type History } from "./history";

/** Everything undo needs, as one immutable value. The store holds it in `$state.raw` and
 *  replaces it wholesale, so reference equality (dirty check, no-op detection) stays reliable. */
export type Session = {
  doc: Doc;
  history: History<Doc>;
  /** The doc when the current drag/gesture began; null outside a gesture. */
  gestureBase: Doc | null;
  /** The doc last written to a file; null when the document was never saved as-is. */
  savedDoc: Doc | null;
};

export function newSession(doc: Doc, saved: boolean): Session {
  return { doc, history: createHistory(), gestureBase: null, savedDoc: saved ? doc : null };
}

export function commit(s: Session, next: Doc): Session {
  if (next === s.doc) return s;
  if (s.gestureBase) return { ...s, doc: next };
  return { ...s, doc: next, history: record(s.history, s.doc) };
}

export function beginGesture(s: Session): Session {
  return s.gestureBase ? s : { ...s, gestureBase: s.doc };
}

export function endGesture(s: Session): Session {
  const base = s.gestureBase;
  if (!base) return s;
  if (base === s.doc) return { ...s, gestureBase: null };
  return { ...s, gestureBase: null, history: record(s.history, base) };
}

export function undoSession(s: Session): Session {
  const closed = endGesture(s);
  const r = undo(closed.history, closed.doc);
  return r ? { ...closed, doc: r.state, history: r.history } : closed;
}

export function redoSession(s: Session): Session {
  const closed = endGesture(s);
  const r = redo(closed.history, closed.doc);
  return r ? { ...closed, doc: r.state, history: r.history } : closed;
}

export function markSaved(s: Session, doc: Doc): Session {
  return { ...s, savedDoc: doc };
}

export function isDirty(s: Session): boolean {
  return s.doc !== s.savedDoc;
}
