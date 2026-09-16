import { describe, expect, it } from "vitest";
import { createDoc, isValidArtboardSize, MAX_ARTBOARD } from "../doc/document";
import { setArtboard } from "../doc/edits";
import { deepFreeze } from "./helpers";

describe("createDoc", () => {
  it("creates one empty layer and a white artboard", () => {
    const doc = createDoc(800, 600);
    expect(doc).toEqual({
      version: 1,
      artboard: { w: 800, h: 600, background: { color: "#ffffff", opacity: 1 } },
      layers: [{ id: "n1", name: "Layer 1", visible: true, locked: false, children: [] }],
      nextId: 2,
    });
  });
});

describe("isValidArtboardSize", () => {
  it("accepts positive finite numbers up to the limit", () => {
    expect(isValidArtboardSize(1)).toBe(true);
    expect(isValidArtboardSize(MAX_ARTBOARD)).toBe(true);
    expect(isValidArtboardSize(0)).toBe(false);
    expect(isValidArtboardSize(MAX_ARTBOARD + 1)).toBe(false);
    expect(isValidArtboardSize(Number.NaN)).toBe(false);
    expect(isValidArtboardSize(null)).toBe(false);
  });
});

describe("setArtboard", () => {
  it("returns a new doc without mutating the input", () => {
    const doc = deepFreeze(createDoc(800, 600));
    const next = setArtboard(doc, { w: 100, h: 50, background: null });
    expect(next).not.toBe(doc);
    expect(next.artboard).toEqual({ w: 100, h: 50, background: null });
    expect(next.layers).toBe(doc.layers);
  });

  it("returns the same reference when nothing changes", () => {
    const doc = createDoc(800, 600);
    expect(setArtboard(doc, { w: 800, h: 600, background: { color: "#ffffff", opacity: 1 } })).toBe(
      doc,
    );
  });

  it("rejects invalid sizes", () => {
    expect(() => setArtboard(createDoc(10, 10), { w: 0, h: 10, background: null })).toThrow(
      RangeError,
    );
  });
});
