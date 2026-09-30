import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({
  rec: null as null | { svg: string; fileName: string; dirty: boolean },
}));
vi.mock("../persist/autosave", () => ({ loadAutosave: async () => stored.rec }));

import { restoreAutosave } from "../persist/project-io";
import { app } from "../state/appState.svelte";

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
