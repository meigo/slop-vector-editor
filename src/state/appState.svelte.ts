import { createDoc, type Doc } from "../doc/document";
import { canRedo, canUndo } from "./history";
import {
  beginGesture,
  commit,
  endGesture,
  isDirty,
  markSaved,
  newSession,
  redoSession,
  undoSession,
  type Session,
} from "./session";
import { fitRect, zoomAt, type View } from "./viewport";

export type Notice = { id: number; kind: "info" | "error"; text: string };
export type DialogKind = "new" | "settings" | null;
export type ConfirmRequest = {
  text: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};

/** The single app store. Exported as `app`, never `state`, so components that use the `$state`
 *  rune can import it without the `store_rune_conflict` error the sibling apps hit.
 *  Immutable values (session, view, notices) are `$state.raw`: they are replaced, never mutated,
 *  and raw keeps reference equality intact for the dirty check. */
class AppState {
  session = $state.raw<Session>(newSession(createDoc(1920, 1080), true));
  fileName = $state("Untitled.svg");
  view = $state.raw<View>({ x: 0, y: 0, zoom: 1 });
  viewportSize = $state.raw({ w: 0, h: 0 });
  /** Bumped to ask the canvas to fit the artboard (on load and on document replace). */
  fitNonce = $state(0);
  notices = $state.raw<Notice[]>([]);
  dialog = $state<DialogKind>(null);
  confirm = $state.raw<ConfirmRequest | null>(null);
  /** Where Save writes without asking. Not reactive: nothing renders from it. */
  fileHandle: FileSystemFileHandle | null = null;

  get doc(): Doc {
    return this.session.doc;
  }
  get dirty(): boolean {
    return isDirty(this.session);
  }
  get canUndo(): boolean {
    return canUndo(this.session.history);
  }
  get canRedo(): boolean {
    return canRedo(this.session.history);
  }
}

export const app = new AppState();

export function commitDoc(next: Doc): void {
  app.session = commit(app.session, next);
}

export function beginDocGesture(): void {
  app.session = beginGesture(app.session);
}

export function endDocGesture(): void {
  app.session = endGesture(app.session);
}

export function undo(): void {
  app.session = undoSession(app.session);
}

export function redo(): void {
  app.session = redoSession(app.session);
}

export function replaceDocument(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
  saved: boolean,
): void {
  app.session = newSession(doc, saved);
  app.fileName = fileName;
  app.fileHandle = handle;
  app.fitNonce++;
}

export function markDocSaved(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
): void {
  app.session = markSaved(app.session, doc);
  app.fileName = fileName;
  app.fileHandle = handle;
}

export function setView(v: View): void {
  app.view = v;
}

export function setViewportSize(w: number, h: number): void {
  if (app.viewportSize.w !== w || app.viewportSize.h !== h) app.viewportSize = { w, h };
}

export function fitArtboard(): void {
  const { w, h } = app.viewportSize;
  if (w <= 0 || h <= 0) return;
  const ab = app.doc.artboard;
  app.view = fitRect({ x: 0, y: 0, w: ab.w, h: ab.h }, w, h);
}

export function zoomBy(factor: number): void {
  const { w, h } = app.viewportSize;
  app.view = zoomAt(app.view, { x: w / 2, y: h / 2 }, factor);
}

export function zoomTo(zoom: number): void {
  zoomBy(zoom / app.view.zoom);
}

let noticeSeq = 0;

export function notify(kind: Notice["kind"], text: string): void {
  const id = ++noticeSeq;
  app.notices = [...app.notices, { id, kind, text }];
  // Errors stay until dismissed; info fades on its own.
  if (kind === "info") setTimeout(() => dismissNotice(id), 6000);
}

export function dismissNotice(id: number): void {
  app.notices = app.notices.filter((n) => n.id !== id);
}

/** In-app replacement for window.confirm (native dialogs block the page and browser automation). */
export function askConfirm(text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    app.confirm = {
      text,
      confirmLabel,
      resolve: (ok) => {
        app.confirm = null;
        resolve(ok);
      },
    };
  });
}
