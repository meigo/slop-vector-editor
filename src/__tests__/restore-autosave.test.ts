import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({
  rec: null as null | { svg: string; fileName: string; dirty: boolean },
}));
vi.mock("../persist/autosave", () => ({ loadAutosave: async () => stored.rec }));

import { restoreAutosave } from "../persist/project-io";
import { createDoc } from "../doc/document";
import { app, commitDoc, replaceDocument } from "../state/appState.svelte";

/** Review M10 (2026-09-30): a stored autosave that failed to parse was reported, then overwritten
 *  3 s later by the blank startup document — the only copy of the work, gone. */
describe("restoreAutosave", () => {
  beforeEach(() => {
    app.notices = [];
  });

  it("restores a readable record and keeps autosaving", async () => {
    stored.rec = {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
      fileName: "Kept.svg",
      dirty: true,
    };
    expect(await restoreAutosave()).toBe(true);
    expect(app.fileName).toBe("Kept.svg");
  });

  it("an unreadable record turns autosave off, so it is never overwritten", async () => {
    stored.rec = { svg: "<svg", fileName: "Lost.svg", dirty: true };
    expect(await restoreAutosave()).toBe(false);
    expect(app.notices).toHaveLength(1);
    expect(app.notices[0].text).toMatch(/Autosave is off for this session/);
  });

  it("no record at all keeps autosaving", async () => {
    stored.rec = null;
    expect(await restoreAutosave()).toBe(true);
  });
});

/** Review L4 (2026-10-17): the app is live while IndexedDB is read; an edit made meanwhile was
 *  replaced by the stored copy without asking. */
describe("restoreAutosave after an early edit", () => {
  const rec = {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
    fileName: "Stored.svg",
    dirty: true,
  };
  const early = async (answer: boolean) => {
    stored.rec = rec;
    replaceDocument(createDoc(50, 50), "Untitled.svg", null, true);
    const pending = restoreAutosave();
    commitDoc({ ...app.doc, artboard: { ...app.doc.artboard, w: 60 } });
    const edited = app.doc;
    await vi.waitFor(() => expect(app.confirm).not.toBeNull());
    app.confirm!.resolve(answer);
    expect(await pending).toBe(true);
    return edited;
  };

  it("asks, and keeps the early work when declined", async () => {
    const edited = await early(false);
    expect(app.doc).toBe(edited);
  });

  it("asks, and restores when confirmed", async () => {
    await early(true);
    expect(app.fileName).toBe("Stored.svg");
  });

  it("doesn't ask when nothing changed", async () => {
    stored.rec = rec;
    expect(await restoreAutosave()).toBe(true);
    expect(app.confirm).toBeNull();
  });
});
