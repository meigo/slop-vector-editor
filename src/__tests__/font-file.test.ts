import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { fontChoices, registerFontFile } from "../text/font";

/** Review L13 (2026-10-17): a font file's id was `file:<family>`, so a second file of the same
 *  family (Inter Regular, then Inter Bold) replaced the first — and a title set in it quietly
 *  re-outlined in the other on its next edit. */
const fileOf = (path: string, name: string, extra = 0): File => {
  const b = fs.readFileSync(path);
  const bytes = new Uint8Array(b.byteLength + extra);
  bytes.set(b);
  return new File([bytes], name);
};

describe("registerFontFile", () => {
  it("gives a different face of an already-added family its own id", async () => {
    const a = await registerFontFile(fileOf("fixtures/Lora[wght].ttf", "Lora-A.ttf"));
    // Same family name, different bytes: stands in for another face of it.
    const b = await registerFontFile(fileOf("fixtures/Lora[wght].ttf", "Lora-B.ttf", 4));
    expect(a).toBe("file:Lora");
    expect(b).not.toBe(a);
    const labels = fontChoices()
      .filter((c) => c.id === a || c.id === b)
      .map((c) => c.label);
    expect(new Set(labels).size).toBe(2);
  });

  it("re-adding the very same file keeps its id", async () => {
    const a = await registerFontFile(fileOf("fixtures/Anton-Regular.ttf", "Anton-Regular.ttf"));
    const again = await registerFontFile(fileOf("fixtures/Anton-Regular.ttf", "copy.ttf"));
    expect(again).toBe(a);
  });
});
