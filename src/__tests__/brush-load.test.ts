import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDoc, type Doc, type PathShape } from "../doc/document";
import { app, commitBrushStroke, replaceDocument } from "../state/appState.svelte";
import type { Vec } from "../geom/vec";

/** Paper is fetched on first use; here that import fails, as in `boolean-load.test.ts`. A stroke
 *  must still land (spec M21 §4.2 step 3), unsimplified, with one warning per session. */
vi.mock("paper/dist/paper-core", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

/** A wavy stroke's outline: 200 points around a 100×10 band. */
const wavy = (x0 = 20, y0 = 50): Vec[] => {
  const top = Array.from({ length: 100 }, (_, i) => ({
    x: x0 + i,
    y: y0 - 5 + Math.sin(i / 8) * 3,
  }));
  const bottom = top.map((p) => ({ x: p.x, y: p.y + 10 })).reverse();
  return [...top, ...bottom];
};
const twoLayers = (): Doc => {
  const d = createDoc(200, 200);
  return {
    ...d,
    layers: [
      { ...d.layers[0], id: "L0", name: "Back", children: [] },
      { ...d.layers[0], id: "L1", name: "Front", children: [] },
    ],
  };
};
const paths = (): PathShape[] =>
  app.doc.layers.flatMap((l) => l.children).filter((n): n is PathShape => n.kind === "path");

beforeEach(() => {
  replaceDocument(twoLayers(), "Untitled.svg", null, true);
  app.notices = [];
});

describe("commitBrushStroke when paper cannot be loaded", () => {
  it("keeps the ink unsimplified and warns once", async () => {
    await commitBrushStroke(wavy());
    await commitBrushStroke(wavy(20, 120));
    expect(paths()).toHaveLength(2);
    expect(paths()[0].subpaths[0].nodes.length).toBeGreaterThan(100);
    expect(app.notices.filter((n) => n.kind === "error")).toHaveLength(1);
  });
});
