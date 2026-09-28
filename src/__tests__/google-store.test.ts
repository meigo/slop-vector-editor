import * as fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type PathShape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { faceKey, memoryFontStore, type FontStore } from "../persist/font-cache";
import type { GoogleFamily } from "../text/google-catalogue";
import type { Fetcher } from "../text/google-fonts";
import {
  addGoogleFamily,
  app,
  newTitleFont,
  previewGoogleFamily,
  replaceDocument,
  restoreGoogleFonts,
  setGoogleFontIo,
  setSelection,
  setTitleFont,
  setTitleItalic,
  setTitleWeight,
  undo,
} from "../state/appState.svelte";
import { familyHasItalic, fontAvailable, fontChoices } from "../text/font";

/** The Google Fonts store actions (spec M20 §5, §6) against a memory cache and a fake network:
 *  the real opentype.js parses the committed Lora fixture, so outlining is genuine. */

const read = (path: string): ArrayBuffer => {
  const b = fs.readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const LORA = read("fixtures/Lora[wght].ttf");
const LORA_PB = fs.readFileSync("fixtures/metadata/lora.pb", "utf8");
/** Lora's metadata with its italic face removed: a family that has no italic. */
const LORA_UPRIGHT_PB = LORA_PB.replace(
  /fonts \{\n {2}name: "Lora"\n {2}style: "italic"[^}]*\}\n/,
  "",
);

/** Each test gets its own family id: the font registry is module state, shared by the file. */
const family = (id: string): GoogleFamily => ({
  id,
  family: "Lora",
  category: "serif",
  license: "OFL-1.1",
  weights: [400, 500, 600, 700],
  italic: true,
  variable: true,
});

/** Serves Lora's METADATA.pb for every family, and the upright fixture for both of its files
 *  (the italic file isn't committed; the bytes only need to parse). */
function fakeNet(opts: { offline?: boolean; upright?: boolean } = {}) {
  const urls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    urls.push(url);
    if (opts.offline) throw new TypeError("Failed to fetch");
    const isPb = url.endsWith("/METADATA.pb");
    return {
      ok: true,
      status: 200,
      text: async () => (isPb ? (opts.upright ? LORA_UPRIGHT_PB : LORA_PB) : ""),
      arrayBuffer: async () => LORA,
    };
  };
  return { fetcher, urls };
}

const title = (font: string): PathShape => ({
  kind: "path",
  id: "t",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  subpaths: [
    {
      closed: true,
      nodes: [
        { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 }, type: "corner" },
        { p: { x: 10, y: 0 }, in: { x: 10, y: 0 }, out: { x: 10, y: 0 }, type: "corner" },
        { p: { x: 10, y: 10 }, in: { x: 10, y: 10 }, out: { x: 10, y: 10 }, type: "corner" },
      ],
    },
  ],
  text: {
    text: "Tallinn šž",
    font,
    size: 50,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: "left",
    seed: 1,
    amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
    overrides: {},
  },
});

const docWith = (font: string): Doc => {
  const d = createDoc(400, 400);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children: [title(font)] }] };
};

const titleNode = (): PathShape => app.doc.layers[0].children[0] as PathShape;

let store: FontStore;

beforeEach(() => {
  store = memoryFontStore();
  replaceDocument(docWith("anton"), "Untitled.svg", null, true);
  app.notices = [];
});

describe("addGoogleFamily", () => {
  it("registers and caches the family, then switches the selected title to it in one step", async () => {
    const net = fakeNet();
    setGoogleFontIo({ store, fetcher: net.fetcher });
    setSelection(["t"]);
    const before = app.doc;

    expect(await addGoogleFamily(family("lora-a"))).toBe(true);

    expect(fontAvailable("gf:lora-a")).toBe(true);
    expect(familyHasItalic("gf:lora-a")).toBe(true);
    expect(fontChoices()).toContainEqual({ id: "gf:lora-a", label: "Lora" });
    expect(titleNode().text?.font).toBe("gf:lora-a");
    expect(titleNode().subpaths).not.toEqual(title("anton").subpaths);
    // Cached for good: the family record and the regular face.
    const cached = await store.getFamilies();
    expect(cached.map((c) => c.id)).toEqual(["gf:lora-a"]);
    expect(cached[0].faces.length).toBe(2);
    expect(await store.getFace(faceKey("gf:lora-a", "Lora[wght].ttf"))).toBe(LORA);
    expect(net.urls).toEqual([
      "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/loraa/METADATA.pb",
      "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/loraa/Lora%5Bwght%5D.ttf",
    ]);
    expect(app.notices.filter((n) => n.kind === "error")).toEqual([]);

    undo();
    expect(app.doc).toBe(before);
  });

  it("makes the family the default for new titles when no title is selected", async () => {
    setGoogleFontIo({ store, fetcher: fakeNet().fetcher });
    setSelection([]);
    const before = app.doc;
    expect(await addGoogleFamily(family("lora-b"))).toBe(true);
    expect(newTitleFont()).toBe("gf:lora-b");
    expect(app.doc).toBe(before);
  });

  it("reuses a preview's download instead of fetching again", async () => {
    const net = fakeNet();
    setGoogleFontIo({ store, fetcher: net.fetcher });
    const shown = await previewGoogleFamily(family("lora-c"));
    expect("font" in shown && shown.font.label).toBe("Lora");
    // A preview does not register.
    expect(fontAvailable("gf:lora-c")).toBe(false);
    const fetched = net.urls.length;
    expect(await addGoogleFamily(family("lora-c"))).toBe(true);
    expect(net.urls.length).toBe(fetched);
  });

  it("offline: an error notice naming the family, nothing registered, cached or committed", async () => {
    setGoogleFontIo({ store, fetcher: fakeNet({ offline: true }).fetcher });
    setSelection(["t"]);
    const before = app.doc;

    expect(await addGoogleFamily(family("lora-d"))).toBe(false);

    expect(app.doc).toBe(before);
    expect(app.canUndo).toBe(false);
    expect(fontAvailable("gf:lora-d")).toBe(false);
    expect(await store.getFamilies()).toEqual([]);
    expect(app.notices.map((n) => [n.kind, n.text])).toEqual([
      ["error", "Couldn't download Lora — check your connection"],
    ]);
  });

  it("a preview that fails reports the reason instead of throwing", async () => {
    setGoogleFontIo({ store, fetcher: fakeNet({ offline: true }).fetcher });
    expect(await previewGoogleFamily(family("lora-e"))).toEqual({
      error: "Couldn't download Lora — check your connection",
    });
    expect(app.notices).toEqual([]);
  });
});

describe("setTitleWeight / setTitleItalic", () => {
  it("each is one undo step, and the default deletes the key", async () => {
    setGoogleFontIo({ store, fetcher: fakeNet().fetcher });
    setSelection(["t"]);
    await addGoogleFamily(family("lora-f"));
    const regular = app.doc;
    const regularOutlines = titleNode().subpaths;

    await setTitleWeight(700);
    expect(titleNode().text?.weight).toBe(700);
    expect(titleNode().subpaths).not.toEqual(regularOutlines);
    const bold = app.doc;

    await setTitleItalic(true);
    expect(titleNode().text?.italic).toBe(true);
    expect(titleNode().text?.weight).toBe(700);

    undo();
    expect(app.doc).toBe(bold);
    undo();
    expect(app.doc).toBe(regular);

    await setTitleWeight(700);
    await setTitleWeight(400);
    expect("weight" in (titleNode().text ?? {})).toBe(false);
    await setTitleItalic(true);
    await setTitleItalic(false);
    expect("italic" in (titleNode().text ?? {})).toBe(false);
  });

  it("a weight that changes nothing commits nothing", async () => {
    setGoogleFontIo({ store, fetcher: fakeNet().fetcher });
    setSelection(["t"]);
    await addGoogleFamily(family("lora-g"));
    const now = app.doc;
    await setTitleWeight(400);
    await setTitleItalic(false);
    expect(app.doc).toBe(now);
  });
});

describe("an uncached face while offline", () => {
  it("raises the download notice and leaves the document alone", async () => {
    // The family is in the cache from an earlier session; its face never was.
    await store.putFamily({
      id: "gf:lora-h",
      family: family("lora-h"),
      faces: [{ style: "normal", weight: 400, filename: "Lora[wght].ttf" }],
    });
    setGoogleFontIo({ store, fetcher: fakeNet({ offline: true }).fetcher });
    await restoreGoogleFonts();
    expect(fontAvailable("gf:lora-h")).toBe(true);
    setSelection(["t"]);
    const before = app.doc;

    await setTitleFont("gf:lora-h");

    expect(app.doc).toBe(before);
    expect(app.notices.map((n) => [n.kind, n.text])).toEqual([
      ["error", "Couldn't download Lora — check your connection"],
    ]);
  });
});

describe("restoreGoogleFonts", () => {
  it("brings cached families back after a reload and draws from the cache offline", async () => {
    setGoogleFontIo({ store, fetcher: fakeNet().fetcher });
    await addGoogleFamily(family("lora-i"));

    // A reload: a fresh registry and a fresh store module, over the same persistent cache.
    vi.resetModules();
    const font = await import("../text/font");
    const fresh = await import("../state/appState.svelte");
    expect(font.fontAvailable("gf:lora-i")).toBe(false);
    const net = fakeNet({ offline: true });
    fresh.setGoogleFontIo({ store, fetcher: net.fetcher });

    await fresh.restoreGoogleFonts();

    expect(font.fontAvailable("gf:lora-i")).toBe(true);
    expect(font.fontChoices()).toContainEqual({ id: "gf:lora-i", label: "Lora" });
    const f = await font.loadFace({ font: "gf:lora-i", weight: 700 });
    expect(f.wght).toEqual({ min: 400, max: 700 });
    expect(net.urls).toEqual([]);
  });

  it("is silent when the cache can't be read", async () => {
    const broken: FontStore = {
      ...memoryFontStore(),
      getFamilies: () => Promise.reject(new Error("IndexedDB unavailable")),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(restoreGoogleFonts(broken)).resolves.toBeUndefined();
    expect(app.notices).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("addGoogleFamily after a failure", () => {
  it("succeeds on a retry once the network is back — the failed download isn't replayed", async () => {
    // One fetcher throughout, so nothing but the failure itself clears the session's caches.
    const net = { offline: true };
    const fetcher: Fetcher = (url) =>
      net.offline ? Promise.reject(new TypeError("Failed to fetch")) : fakeNet().fetcher(url);
    setGoogleFontIo({ store, fetcher });
    setSelection(["t"]);

    expect(await addGoogleFamily(family("lora-m"))).toBe(false);
    net.offline = false;
    expect(await addGoogleFamily(family("lora-m"))).toBe(true);

    expect(fontAvailable("gf:lora-m")).toBe(true);
    expect(titleNode().text?.font).toBe("gf:lora-m");
  });
});

describe("a font switch snaps the face to what the new family has", () => {
  it("snaps to the nearest weight (ties go heavier), keeping italic the family has — one step", async () => {
    setGoogleFontIo({ store, fetcher: fakeNet().fetcher });
    setSelection(["t"]);
    await addGoogleFamily(family("lora-n"));
    await setTitleWeight(600);
    await setTitleItalic(true);
    const before = app.doc;

    // 600 sits exactly between 500 and 700.
    expect(await addGoogleFamily({ ...family("lora-o"), weights: [500, 700] })).toBe(true);

    expect(titleNode().text?.font).toBe("gf:lora-o");
    expect(titleNode().text?.weight).toBe(700);
    expect(titleNode().text?.italic).toBe(true);
    undo();
    expect(app.doc).toBe(before);
  });

  it("a family with only Regular and no italic drops both keys, in one step", async () => {
    // The same rule serves a bundled or file-added font: `familyWeights` gives them [400] and
    // `familyHasItalic` false. A Google family is used here because bundled fonts load by URL.
    const net = { upright: false };
    const fetcher: Fetcher = (url) => fakeNet(net).fetcher(url);
    setGoogleFontIo({ store, fetcher });
    setSelection(["t"]);
    await addGoogleFamily(family("lora-p"));
    await setTitleWeight(700);
    await setTitleItalic(true);
    const before = app.doc;

    net.upright = true;
    expect(await addGoogleFamily({ ...family("lora-q"), weights: [400], italic: false })).toBe(
      true,
    );

    expect(familyHasItalic("gf:lora-q")).toBe(false);
    const meta = titleNode().text ?? {};
    expect(titleNode().text?.font).toBe("gf:lora-q");
    expect("weight" in meta).toBe(false);
    expect("italic" in meta).toBe(false);
    undo();
    expect(app.doc).toBe(before);
  });
});

describe("addGoogleFamily targets the title selected when it started (final review I-2)", () => {
  /** A fetcher that holds every request until `release()`. */
  function slowNet() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = fakeNet().fetcher;
    const fetcher: Fetcher = async (url) => {
      await gate;
      return inner(url);
    };
    return { fetcher, release };
  }

  const twoTitles = (): Doc => {
    const d = docWith("anton");
    const a = title("anton");
    const b = { ...title("anton"), id: "t2" };
    return { ...d, layers: [{ ...d.layers[0], children: [a, b] }] };
  };
  const fontOf = (id: string) =>
    (app.doc.layers[0].children.find((n) => n.id === id) as PathShape).text?.font;

  it("a selection change mid-download switches neither title — the family is still registered", async () => {
    replaceDocument(twoTitles(), "Untitled.svg", null, true);
    const net = slowNet();
    setGoogleFontIo({ store, fetcher: net.fetcher });
    setSelection(["t"]);
    const defaultBefore = newTitleFont();

    const adding = addGoogleFamily(family("lora-r"));
    setSelection(["t2"]);
    net.release();
    expect(await adding).toBe(true);

    expect(fontAvailable("gf:lora-r")).toBe(true);
    expect(fontOf("t")).toBe("anton");
    expect(fontOf("t2")).toBe("anton");
    expect(newTitleFont()).toBe(defaultBefore);
    expect(app.canUndo).toBe(false);
  });

  it("still switches the title when it is still the one selected", async () => {
    replaceDocument(twoTitles(), "Untitled.svg", null, true);
    const net = slowNet();
    setGoogleFontIo({ store, fetcher: net.fetcher });
    setSelection(["t2"]);
    const adding = addGoogleFamily(family("lora-s"));
    net.release();
    expect(await adding).toBe(true);
    expect(fontOf("t2")).toBe("gf:lora-s");
    expect(fontOf("t")).toBe("anton");
  });

  it("with no title selected at the start, selecting one mid-download leaves it and the default alone", async () => {
    replaceDocument(twoTitles(), "Untitled.svg", null, true);
    const net = slowNet();
    setGoogleFontIo({ store, fetcher: net.fetcher });
    setSelection([]);
    const defaultBefore = newTitleFont();
    const adding = addGoogleFamily(family("lora-t"));
    setSelection(["t"]);
    net.release();
    expect(await adding).toBe(true);
    expect(fontOf("t")).toBe("anton");
    expect(newTitleFont()).toBe(defaultBefore);
  });

  it("an abandoned add (the dialog cancelled) switches nothing", async () => {
    const net = slowNet();
    setGoogleFontIo({ store, fetcher: net.fetcher });
    setSelection(["t"]);
    const defaultBefore = newTitleFont();
    let open = true;
    const adding = addGoogleFamily(family("lora-u"), { live: () => open });
    open = false;
    net.release();
    expect(await adding).toBe(true);
    expect(fontAvailable("gf:lora-u")).toBe(true);
    expect(titleNode().text?.font).toBe("anton");
    expect(newTitleFont()).toBe(defaultBefore);
    expect(app.canUndo).toBe(false);
  });
});
