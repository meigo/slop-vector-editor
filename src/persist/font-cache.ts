/** The Google Fonts cache (spec M20 §5): its OWN IndexedDB database, so autosave's is never
 *  upgraded (Global Constraints). A family record holds the catalogue entry plus its parsed
 *  METADATA.pb faces; a face record holds one face file's bytes, keyed `faceKey`. Behind the
 *  `FontStore` interface so the registry logic that uses it is unit-testable in node —
 *  `memoryFontStore` is what tests use; `idbFontStore` is a thin wrapper over real IndexedDB,
 *  modelled on `src/persist/autosave.ts`'s open/request helpers. Never imports opentype.js
 *  (invariant 40): callers hand `src/text/font.ts` the raw bytes. */

import type { GoogleFamily } from "../text/google-catalogue";
import type { FaceEntry } from "../text/google-fonts";

export type CachedFamily = { id: string; family: GoogleFamily; faces: FaceEntry[] };

export interface FontStore {
  getFamilies(): Promise<CachedFamily[]>;
  putFamily(f: CachedFamily): Promise<void>;
  getFace(key: string): Promise<ArrayBuffer | null>;
  putFace(key: string, buf: ArrayBuffer): Promise<void>;
}

/** A face's cache key: one filename can be shared by no two families, since a family's own id is
 *  part of it. */
export function faceKey(fontId: string, filename: string): string {
  return `${fontId}/${filename}`;
}

const DB_NAME = "slop-vector-editor-fonts";
const DB_VERSION = 1;
const FAMILIES_STORE = "families";
const FACES_STORE = "faces";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export function idbFontStore(): FontStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FAMILIES_STORE)) db.createObjectStore(FAMILIES_STORE);
        if (!db.objectStoreNames.contains(FACES_STORE)) db.createObjectStore(FACES_STORE);
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

  return {
    async getFamilies() {
      const db = await open();
      const all = await request(
        db.transaction(FAMILIES_STORE, "readonly").objectStore(FAMILIES_STORE).getAll(),
      );
      return all as CachedFamily[];
    },
    async putFamily(f) {
      const db = await open();
      const tx = db.transaction(FAMILIES_STORE, "readwrite");
      tx.objectStore(FAMILIES_STORE).put(f, f.id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      });
    },
    async getFace(key) {
      const db = await open();
      const rec = await request(
        db.transaction(FACES_STORE, "readonly").objectStore(FACES_STORE).get(key),
      );
      return (rec as ArrayBuffer | undefined) ?? null;
    },
    async putFace(key, buf) {
      const db = await open();
      const tx = db.transaction(FACES_STORE, "readwrite");
      tx.objectStore(FACES_STORE).put(buf, key);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      });
    },
  };
}

export function memoryFontStore(): FontStore {
  const families = new Map<string, CachedFamily>();
  const faces = new Map<string, ArrayBuffer>();
  return {
    async getFamilies() {
      return Array.from(families.values());
    },
    async putFamily(f) {
      families.set(f.id, f);
    },
    async getFace(key) {
      return faces.get(key) ?? null;
    },
    async putFace(key, buf) {
      faces.set(key, buf);
    },
  };
}
