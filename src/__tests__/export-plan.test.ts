import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type RectShape } from "../doc/document";
import {
  exportBox,
  exportRefusal,
  exportSize,
  pngFileName,
  sizeLabel,
  MAX_SIDE,
} from "../state/export-plan";

const I: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
const rect = (id: string, x: number, y: number, w: number, h: number): RectShape => ({
  kind: "rect",
  id,
  transform: I,
  style: { ...DEFAULT_STYLE, stroke: null },
  x,
  y,
  w,
  h,
  rx: 0,
});
const docWith = (children: Node[]): Doc => {
  const base = createDoc(400, 300);
  return { ...base, layers: [{ ...base.layers[0], children }] };
};

describe("exportBox", () => {
  it("is the artboard's own box for the artboard region", () => {
    expect(exportBox(docWith([]), "artboard", [])).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it("is the selection's bounds for the selection region", () => {
    const doc = docWith([rect("a", 50, 20, 100, 60), rect("b", 300, 200, 10, 10)]);
    expect(exportBox(doc, "selection", ["a"])).toEqual({ x: 50, y: 20, w: 100, h: 60 });
  });

  it("unions a multi-object selection", () => {
    const doc = docWith([rect("a", 0, 0, 10, 10), rect("b", 90, 40, 10, 10)]);
    expect(exportBox(doc, "selection", ["a", "b"])).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it("is null when nothing is selected", () => {
    expect(exportBox(docWith([rect("a", 0, 0, 10, 10)]), "selection", [])).toBeNull();
  });
});

describe("exportSize", () => {
  it("multiplies and rounds", () => {
    expect(exportSize({ x: 0, y: 0, w: 400, h: 300 }, 2)).toEqual({ w: 800, h: 600 });
    expect(exportSize({ x: 0, y: 0, w: 100, h: 50 }, 1.5)).toEqual({ w: 150, h: 75 });
    expect(exportSize({ x: 0, y: 0, w: 101, h: 51 }, 1.5)).toEqual({ w: 152, h: 77 });
  });
});

describe("exportRefusal", () => {
  const box = { x: 0, y: 0, w: 400, h: 300 };

  it("allows a sane export", () => {
    expect(exportRefusal(box, 2)).toBeNull();
  });

  it("refuses when there is nothing to export", () => {
    expect(exportRefusal(null, 2)).toBe("nothing to export");
  });

  it("refuses a non-positive or non-finite scale", () => {
    expect(exportRefusal(box, 0)).toBe("scale must be a positive number");
    expect(exportRefusal(box, -1)).toBe("scale must be a positive number");
    expect(exportRefusal(box, Number.NaN)).toBe("scale must be a positive number");
    expect(exportRefusal(box, Number.POSITIVE_INFINITY)).toBe("scale must be a positive number");
  });

  it("refuses a scale that rounds away to nothing", () => {
    expect(exportRefusal({ x: 0, y: 0, w: 4, h: 4 }, 0.0001)).toBe("that scale rounds to nothing");
  });

  it("refuses when a side passes MAX_SIDE, naming the computed size", () => {
    const wide = { x: 0, y: 0, w: MAX_SIDE + 100, h: 10 };
    expect(exportRefusal(wide, 1)).toBe(`${MAX_SIDE + 100} × 10 is too large; reduce the scale`);
  });

  it("refuses when the total passes MAX_PIXELS even with both sides legal", () => {
    // 8192 x 8192 = 67M pixels: each side is exactly at MAX_SIDE, the area is four times over.
    expect(exportRefusal({ x: 0, y: 0, w: 8192, h: 8192 }, 1)).toBe(
      "8192 × 8192 is too large; reduce the scale",
    );
  });

  it("allows the largest legal shape: MAX_SIDE wide, within the pixel budget", () => {
    expect(exportRefusal({ x: 0, y: 0, w: 8192, h: 2048 }, 1)).toBeNull();
  });
});

describe("sizeLabel", () => {
  it("reads as the pixels you will get", () => {
    expect(sizeLabel({ x: 0, y: 0, w: 400, h: 300 }, 2)).toBe("800 × 600 px");
  });

  it("is a dash when there is nothing to measure", () => {
    expect(sizeLabel(null, 2)).toBe("—");
    expect(sizeLabel({ x: 0, y: 0, w: 400, h: 300 }, Number.NaN)).toBe("—");
  });
});

describe("pngFileName", () => {
  it("swaps an .svg extension for .png", () => {
    expect(pngFileName("Logo.svg")).toBe("Logo.png");
    expect(pngFileName("My.Icon.svg")).toBe("My.Icon.png");
  });

  it("appends .png when there is no .svg to swap", () => {
    expect(pngFileName("Untitled")).toBe("Untitled.png");
  });

  it("falls back to a name rather than producing a bare extension", () => {
    expect(pngFileName("")).toBe("Untitled.png");
  });
});
