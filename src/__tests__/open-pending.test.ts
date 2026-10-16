import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../persist/file-io", () => ({
  pickSvgFile: async () => ({
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
    name: "Other.svg",
    handle: null,
  }),
  writeSvgFile: async () => undefined,
}));

import { createDoc } from "../doc/document";
import { openDocument } from "../persist/project-io";
import { app, replaceDocument } from "../state/appState.svelte";

/** Review L5 (2026-10-17): Open counted only `app.dirty`, so a brush stroke still landing — not in
 *  the document yet — was replaced without asking. */
describe("openDocument with a brush stroke still landing", () => {
  beforeEach(() => {
    replaceDocument(createDoc(50, 50), "Mine.svg", null, true);
  });

  it("asks before discarding it", async () => {
    app.brushPending = [{ outline: [], fill: { color: "#000000", opacity: 1 }, opacity: 1 }];
    const opening = openDocument();
    await vi.waitFor(() => expect(app.confirm).not.toBeNull());
    app.confirm!.resolve(false);
    await opening;
    expect(app.fileName).toBe("Mine.svg");
    app.brushPending = [];
  });

  it("opens straight away with nothing unsaved", async () => {
    await openDocument();
    expect(app.confirm).toBeNull();
    expect(app.fileName).toBe("Other.svg");
  });
});
