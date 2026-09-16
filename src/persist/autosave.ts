const DB_NAME = "slop-vector-editor";
const DB_VERSION = 1;
const STORE = "autosave";
const KEY = "current";
export const AUTOSAVE_DEBOUNCE_MS = 3000;

export type AutosaveRecord = { svg: string; fileName: string; dirty: boolean };

/** One shared connection, memoised as a promise; dropped on failure/close so it is retried. */
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  }).catch((err: unknown) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  const db = await open();
  const rec = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
  return (rec as AutosaveRecord | undefined) ?? null;
}

export async function writeAutosave(rec: AutosaveRecord): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(rec, KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

let timer: ReturnType<typeof setTimeout> | null = null;
let reported = false;
let pending: { get: () => AutosaveRecord; onError: (err: unknown) => void } | null = null;

function runWrite(get: () => AutosaveRecord, onError: (err: unknown) => void): void {
  writeAutosave(get()).catch((err: unknown) => {
    if (reported) return; // one notice per session is enough
    reported = true;
    onError(err);
  });
}

/** Debounced write. `get` runs when the timer fires, so a burst of edits serializes once. */
export function scheduleAutosave(get: () => AutosaveRecord, onError: (err: unknown) => void): void {
  if (timer) clearTimeout(timer);
  pending = { get, onError };
  timer = setTimeout(() => {
    timer = null;
    pending = null;
    runWrite(get, onError);
  }, AUTOSAVE_DEBOUNCE_MS);
}

/** Writes immediately if a debounced autosave is pending (e.g. the page is about to be hidden),
 *  using the same get/onError pair scheduleAutosave last saw. A no-op otherwise. */
export function flushAutosave(): void {
  if (!timer || !pending) return;
  clearTimeout(timer);
  timer = null;
  const { get, onError } = pending;
  pending = null;
  runWrite(get, onError);
}
