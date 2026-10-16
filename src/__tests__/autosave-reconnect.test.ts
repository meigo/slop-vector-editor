import { afterEach, describe, expect, it, vi } from "vitest";

/** Review M4 (2026-10-17): Safari can lose an IndexedDB connection without `onclose`; every later
 *  `transaction()` on it throws. The cached connection must be dropped on such a failure, or
 *  autosave (and the font cache) stays dead for the session. */

type FakeDb = { dead: boolean; closed: boolean };

function fakeIndexedDB() {
  const opened: FakeDb[] = [];
  const data = new Map<string, unknown>();
  const store = () => ({
    put(v: unknown, k: string) {
      data.set(k, v);
    },
    get(k: string) {
      const req: { result?: unknown; onsuccess?: () => void } = {};
      queueMicrotask(() => {
        req.result = data.get(k);
        req.onsuccess?.();
      });
      return req;
    },
  });
  const makeDb = (state: FakeDb) => ({
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close() {
      state.closed = true;
    },
    transaction() {
      if (state.dead) throw new DOMException("Connection lost", "InvalidStateError");
      const tx: { oncomplete?: () => void; objectStore: () => ReturnType<typeof store> } = {
        objectStore: store,
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  });
  const idb = {
    open() {
      const state: FakeDb = { dead: false, closed: false };
      opened.push(state);
      const req: { result?: unknown; onsuccess?: () => void } = {};
      queueMicrotask(() => {
        req.result = makeDb(state);
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { idb, opened, data };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a lost IndexedDB connection", () => {
  it("autosave reopens after a write fails on a dead connection", async () => {
    const fake = fakeIndexedDB();
    vi.stubGlobal("indexedDB", fake.idb);
    const { writeAutosave } = await import("../persist/autosave");
    const rec = { svg: "<svg/>", fileName: "a.svg", dirty: true };
    await writeAutosave(rec);
    fake.opened[0].dead = true;
    await expect(writeAutosave(rec)).rejects.toThrow();
    expect(fake.opened[0].closed).toBe(true);
    await writeAutosave({ ...rec, fileName: "b.svg" });
    expect(fake.opened).toHaveLength(2);
    expect((fake.data.get("current") as typeof rec).fileName).toBe("b.svg");
  });

  it("the font cache reopens too", async () => {
    const fake = fakeIndexedDB();
    vi.stubGlobal("indexedDB", fake.idb);
    const { idbFontStore } = await import("../persist/font-cache");
    const store = idbFontStore();
    await store.putFace("f/a.ttf", new ArrayBuffer(1));
    fake.opened[0].dead = true;
    await expect(store.getFace("f/a.ttf")).rejects.toThrow();
    expect(await store.getFace("f/a.ttf")).not.toBeNull();
    expect(fake.opened).toHaveLength(2);
  });
});
