import { describe, expect, it } from "vitest";
import { readClipboardText, writeClipboardText } from "../persist/system-clipboard";

describe("system clipboard adapter", () => {
  it("writes, and reports failure instead of throwing", async () => {
    const written: string[] = [];
    const ok = {
      writeText: async (t: string) => {
        written.push(t);
      },
    };
    expect(await writeClipboardText("<svg/>", ok)).toBe(true);
    expect(written).toEqual(["<svg/>"]);
    expect(await writeClipboardText("x", {})).toBe(false);
    expect(
      await writeClipboardText("x", { writeText: () => Promise.reject(new Error("denied")) }),
    ).toBe(false);
    const throwsNow = {
      writeText: (): Promise<void> => {
        throw new Error("sync");
      },
    };
    expect(await writeClipboardText("x", throwsNow)).toBe(false);
  });

  it("reads, and returns null for missing, empty or refused text", async () => {
    expect(await readClipboardText({ readText: async () => "<svg/>" })).toBe("<svg/>");
    expect(await readClipboardText({ readText: async () => "" })).toBeNull();
    expect(await readClipboardText({})).toBeNull();
    expect(
      await readClipboardText({ readText: () => Promise.reject(new Error("denied")) }),
    ).toBeNull();
    const throwsNow = {
      readText: (): Promise<string> => {
        throw new Error("sync");
      },
    };
    expect(await readClipboardText(throwsNow)).toBeNull();
  });
});
