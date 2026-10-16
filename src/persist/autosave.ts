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

/** Runs `fn` on the shared connection, dropping the connection when it fails so the next call
 *  reopens it (review M4, 2026-10-17): Safari can lose one without `onclose`, after which every
 *  `transaction()` on it throws — and autosave stayed dead for the session. */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const p = open();
  const db = await p;
  try {
    return await fn(db);
  } catch (err) {
    if (dbPromise === p) {
      dbPromise = null;
      db.close();
    }
    throw err;
  }
}

export function loadAutosave(): Promise<AutosaveRecord | null> {
  return withDb(async (db) => {
    const rec = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
    return (rec as AutosaveRecord | undefined) ?? null;
  });
}

export function writeAutosave(rec: AutosaveRecord): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec, KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
  });
}

let timer: ReturnType<typeof setTimeout> | null = null;
let reported = false;
let pending: { get: () => AutosaveRecord; onError: (err: unknown) => void } | null = null;

function runWrite(get: () => AutosaveRecord, onError: (err: unknown) => void): void {
  writeAutosave(get()).then(
    () => {
      reported = false; // working again: the next outage gets its own notice
    },
    (err: unknown) => {
      if (reported) return; // one notice per outage is enough
      reported = true;
      onError(err);
    },
  );
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
