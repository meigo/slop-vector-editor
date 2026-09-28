import { describe, expect, it } from "vitest";
import { faceKey, memoryFontStore, type CachedFamily } from "../persist/font-cache";
import type { GoogleFamily } from "../text/google-catalogue";

const lora: GoogleFamily = {
  id: "lora",
  family: "Lora",
  category: "serif",
  license: "OFL-1.1",
  weights: [400, 700],
  italic: true,
  variable: true,
};

const cachedLora: CachedFamily = {
  id: "gf:lora",
  family: lora,
  faces: [
    { style: "normal", weight: 400, filename: "Lora[wght].ttf" },
    { style: "italic", weight: 400, filename: "Lora-Italic[wght].ttf" },
  ],
};

describe("faceKey", () => {
  it("joins the font id and filename with a slash", () => {
    expect(faceKey("gf:lora", "Lora[wght].ttf")).toBe("gf:lora/Lora[wght].ttf");
  });
});

describe("memoryFontStore", () => {
  it("starts empty", async () => {
    const store = memoryFontStore();
    expect(await store.getFamilies()).toEqual([]);
    expect(await store.getFace("gf:lora/Lora[wght].ttf")).toBeNull();
  });

  it("round-trips a family", async () => {
    const store = memoryFontStore();
    await store.putFamily(cachedLora);
    expect(await store.getFamilies()).toEqual([cachedLora]);
  });

  it("round-trips a face's bytes", async () => {
    const store = memoryFontStore();
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const key = faceKey("gf:lora", "Lora[wght].ttf");
    await store.putFace(key, buf);
    expect(await store.getFace(key)).toBe(buf);
  });

  it("putFamily overwrites the record for the same id", async () => {
    const store = memoryFontStore();
    await store.putFamily(cachedLora);
    const updated: CachedFamily = { ...cachedLora, faces: [] };
    await store.putFamily(updated);
    const all = await store.getFamilies();
    expect(all).toEqual([updated]);
  });
});
