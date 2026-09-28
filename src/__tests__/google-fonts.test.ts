import { describe, expect, it } from "vitest";
import {
  GOOGLE_FONTS_BASE,
  chooseFace,
  fetchFaceFile,
  fetchMetadata,
  hasItalic,
  isVariableFile,
  parseMetadata,
  type FaceEntry,
  type Fetcher,
} from "../text/google-fonts";
import lora from "../../fixtures/metadata/lora.pb?raw";
import ubuntu from "../../fixtures/metadata/ubuntu.pb?raw";

describe("parseMetadata", () => {
  it("parses Lora into a variable upright and a variable italic face", () => {
    const faces = parseMetadata(lora);
    expect(faces).toEqual([
      { style: "normal", weight: 400, filename: "Lora[wght].ttf" },
      { style: "italic", weight: 400, filename: "Lora-Italic[wght].ttf" },
    ]);
  });

  it("parses Ubuntu into 8 static faces", () => {
    const faces = parseMetadata(ubuntu);
    expect(faces).toHaveLength(8);
    expect(faces).toEqual(
      expect.arrayContaining([
        { style: "normal", weight: 300, filename: "Ubuntu-Light.ttf" },
        { style: "italic", weight: 300, filename: "Ubuntu-LightItalic.ttf" },
        { style: "normal", weight: 400, filename: "Ubuntu-Regular.ttf" },
        { style: "italic", weight: 400, filename: "Ubuntu-Italic.ttf" },
        { style: "normal", weight: 500, filename: "Ubuntu-Medium.ttf" },
        { style: "italic", weight: 500, filename: "Ubuntu-MediumItalic.ttf" },
        { style: "normal", weight: 700, filename: "Ubuntu-Bold.ttf" },
        { style: "italic", weight: 700, filename: "Ubuntu-BoldItalic.ttf" },
      ]),
    );
  });

  it("de-duplicates by filename, keeping the first occurrence", () => {
    const pb = `
      fonts { style: "normal" weight: 400 filename: "Foo.ttf" }
      fonts { style: "normal" weight: 999 filename: "Foo.ttf" }
    `;
    expect(parseMetadata(pb)).toEqual([{ style: "normal", weight: 400, filename: "Foo.ttf" }]);
  });

  it("survives an escaped quote inside another field of the block", () => {
    const pb = `fonts {
      style: "normal"
      weight: 400
      filename: "Foo.ttf"
      copyright: "with Reserved Font Name \\"Foo\\", and a comma, here"
    }`;
    expect(parseMetadata(pb)).toEqual([{ style: "normal", weight: 400, filename: "Foo.ttf" }]);
  });

  it("ignores blocks with an unrecognised style, or missing weight/filename", () => {
    const pb = `
      fonts { style: "bold" weight: 400 filename: "A.ttf" }
      fonts { style: "normal" filename: "B.ttf" }
      fonts { style: "normal" weight: 400 }
    `;
    expect(parseMetadata(pb)).toEqual([]);
  });
});

describe("isVariableFile", () => {
  it("is true only for a filename naming an axis in brackets", () => {
    expect(isVariableFile("Lora[wght].ttf")).toBe(true);
    expect(isVariableFile("Lora-Italic[wght].ttf")).toBe(true);
    expect(isVariableFile("Ubuntu-Bold.ttf")).toBe(false);
  });
});

describe("hasItalic", () => {
  it("is true when any face is italic", () => {
    expect(hasItalic(parseMetadata(lora))).toBe(true);
    expect(hasItalic([{ style: "normal", weight: 400, filename: "A.ttf" }])).toBe(false);
  });
});

describe("chooseFace", () => {
  const loraFaces = parseMetadata(lora);
  const ubuntuFaces = parseMetadata(ubuntu);

  it("returns null for an empty face list", () => {
    expect(chooseFace([], 400, false)).toBeNull();
  });

  it("picks the variable face at any weight (upright)", () => {
    expect(chooseFace(loraFaces, 250, false)).toEqual({
      style: "normal",
      weight: 400,
      filename: "Lora[wght].ttf",
    });
    expect(chooseFace(loraFaces, 900, false)).toEqual({
      style: "normal",
      weight: 400,
      filename: "Lora[wght].ttf",
    });
  });

  it("picks the variable italic face when italic is requested", () => {
    expect(chooseFace(loraFaces, 400, true)).toEqual({
      style: "italic",
      weight: 400,
      filename: "Lora-Italic[wght].ttf",
    });
  });

  it("static: picks the exact weight", () => {
    expect(chooseFace(ubuntuFaces, 700, false)).toEqual({
      style: "normal",
      weight: 700,
      filename: "Ubuntu-Bold.ttf",
    });
  });

  it("static: picks the nearest weight, ties going to the heavier", () => {
    // 600 is equidistant from 500 and 700 - the heavier (700) wins.
    expect(chooseFace(ubuntuFaces, 600, false)).toEqual({
      style: "normal",
      weight: 700,
      filename: "Ubuntu-Bold.ttf",
    });
    // 550 is closer to 500 than 700.
    expect(chooseFace(ubuntuFaces, 550, false)).toEqual({
      style: "normal",
      weight: 500,
      filename: "Ubuntu-Medium.ttf",
    });
  });

  it("falls back to upright when italic is requested on a family with no italic", () => {
    const upOnly: FaceEntry[] = [
      { style: "normal", weight: 400, filename: "A-Regular.ttf" },
      { style: "normal", weight: 700, filename: "A-Bold.ttf" },
    ];
    expect(chooseFace(upOnly, 700, true)).toEqual({
      style: "normal",
      weight: 700,
      filename: "A-Bold.ttf",
    });
  });
});

function fakeFetcher(
  handler: (
    url: string,
  ) => { ok: boolean; status: number; text?: string; buf?: ArrayBuffer } | "throw",
): Fetcher {
  return async (url: string) => {
    const r = handler(url);
    if (r === "throw") throw new Error("network down");
    return {
      ok: r.ok,
      status: r.status,
      text: async () => r.text ?? "",
      arrayBuffer: async () => r.buf ?? new ArrayBuffer(0),
    };
  };
}

describe("fetchMetadata", () => {
  it("builds the METADATA.pb URL from the directory and parses the response", async () => {
    let seenUrl = "";
    const fetcher = fakeFetcher((url) => {
      seenUrl = url;
      return { ok: true, status: 200, text: lora };
    });
    const faces = await fetchMetadata("ofl/lora", fetcher);
    expect(seenUrl).toBe(`${GOOGLE_FONTS_BASE}ofl/lora/METADATA.pb`);
    expect(faces).toEqual(parseMetadata(lora));
  });

  it("throws a user-readable error on a 404", async () => {
    const fetcher = fakeFetcher(() => ({ ok: false, status: 404 }));
    await expect(fetchMetadata("ofl/lora", fetcher)).rejects.toThrow(
      "Couldn't download Lora — check your connection",
    );
  });

  it("throws a user-readable error when the fetch itself throws", async () => {
    const fetcher = fakeFetcher(() => "throw");
    await expect(fetchMetadata("ofl/lora", fetcher)).rejects.toThrow(
      "Couldn't download Lora — check your connection",
    );
  });
});

describe("fetchFaceFile", () => {
  it("URL-encodes the filename, including brackets and commas", async () => {
    let seenUrl = "";
    const fetcher = fakeFetcher((url) => {
      seenUrl = url;
      return { ok: true, status: 200, buf: new ArrayBuffer(4) };
    });
    await fetchFaceFile("ofl/lora", "Lora[wght].ttf", fetcher);
    expect(seenUrl).toBe(`${GOOGLE_FONTS_BASE}ofl/lora/Lora%5Bwght%5D.ttf`);

    await fetchFaceFile("ofl/foo", "Foo[wght,opsz].ttf", fetcher);
    expect(seenUrl).toBe(`${GOOGLE_FONTS_BASE}ofl/foo/Foo%5Bwght%2Copsz%5D.ttf`);
  });

  it("returns the response bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetcher = fakeFetcher(() => ({ ok: true, status: 200, buf: bytes }));
    const buf = await fetchFaceFile("ofl/lora", "Lora[wght].ttf", fetcher);
    expect(buf).toBe(bytes);
  });

  it("throws a user-readable error on a failed download", async () => {
    const fetcher = fakeFetcher(() => ({ ok: false, status: 500 }));
    await expect(fetchFaceFile("ofl/lora", "Lora[wght].ttf", fetcher)).rejects.toThrow(
      "Couldn't download Lora — check your connection",
    );
  });
});
