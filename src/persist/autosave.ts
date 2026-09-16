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
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(rec, KEY));
}

let timer: ReturnType<typeof setTimeout> | null = null;
let reported = false;

/** Debounced write. `get` runs when the timer fires, so a burst of edits serializes once. */
export function scheduleAutosave(get: () => AutosaveRecord, onError: (err: unknown) => void): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    writeAutosave(get()).catch((err: unknown) => {
      if (reported) return; // one notice per session is enough
      reported = true;
      onError(err);
    });
  }, AUTOSAVE_DEBOUNCE_MS);
}
