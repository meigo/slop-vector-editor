import { createDoc } from "../doc/document";
import { app, askConfirm, markDocSaved, notify, replaceDocument } from "../state/appState.svelte";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";
import { loadAutosave, type AutosaveRecord } from "./autosave";
import { pickSvgFile, writeSvgFile } from "./file-io";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createNewDocument(w: number, h: number): void {
  replaceDocument(createDoc(w, h), "Untitled.svg", null, true);
}

export async function openDocument(): Promise<void> {
  if (
    app.dirty &&
    !(await askConfirm("Discard unsaved changes and open another file?", "Discard"))
  ) {
    return;
  }
  let picked;
  try {
    picked = await pickSvgFile();
  } catch (err) {
    notify("error", `Could not open the file: ${errorMessage(err)}`);
    return;
  }
  if (picked) openText(picked.text, picked.name, picked.handle);
}

/** Parses fully BEFORE touching the open document, so a bad file leaves it intact. */
export function openText(text: string, name: string, handle: FileSystemFileHandle | null): void {
  let result;
  try {
    result = parseSvg(text);
  } catch (err) {
    notify("error", `${name} could not be read: ${errorMessage(err)}`);
    return;
  }
  // Only our own export format is safe to overwrite in place: re-saving a foreign file would
  // replace an Inkscape/Figma/Illustrator original with our lossy re-export.
  const keepHandle = result.native && result.dropped.length === 0;
  const discardedHandle = handle !== null && !keepHandle;
  replaceDocument(result.doc, name, keepHandle ? handle : null, true);
  const notes: string[] = [];
  if (discardedHandle) notes.push("Opened as a copy — Save will ask where to write it.");
  if (result.dropped.length > 0) {
    notes.push(`Some content was not imported: ${result.dropped.join(", ")}`);
  }
  if (notes.length > 0) notify("info", notes.join(" "));
}

export async function saveDocument(asNew: boolean): Promise<void> {
  // Capture the doc being written: edits made while the write is in flight stay dirty.
  const doc = app.doc;
  try {
    const r = await writeSvgFile(serializeDoc(doc), app.fileName, app.fileHandle, asNew);
    if (r) markDocSaved(doc, r.name, r.handle);
  } catch (err) {
    notify("error", `Save failed: ${errorMessage(err)}`);
  }
}

export function autosaveRecord(): AutosaveRecord {
  return { svg: serializeDoc(app.doc), fileName: app.fileName, dirty: app.dirty };
}

/** Resolves false only when storage itself is unavailable, so the caller can skip scheduling
 *  autosaves in that case rather than trying (and failing) to write to it moments later. */
export async function restoreAutosave(): Promise<boolean> {
  let rec: AutosaveRecord | null;
  try {
    rec = await loadAutosave();
  } catch {
    notify("info", "Autosave is unavailable in this browser session — save your work manually.");
    return false;
  }
  if (!rec) return true;
  try {
    const { doc } = parseSvg(rec.svg);
    replaceDocument(doc, rec.fileName, null, !rec.dirty);
  } catch (err) {
    notify("error", `The autosaved document could not be restored: ${errorMessage(err)}`);
  }
  return true;
}
