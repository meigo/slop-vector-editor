import { describe, expect, it } from "vitest";
import {
  autoScrollStep,
  DRAG_THRESHOLD_PX,
  ghostTop,
  pastThreshold,
  ROW_PX,
  SCROLL_MAX_PX,
  slideOffsets,
} from "../lib/layer-drag-visual";
import type { RowBox } from "../lib/layer-drop";

const rows: RowBox[] = [
  { kind: "layer", id: "B", top: 0, bottom: 32 },
  { kind: "node", id: "b2", top: 32, bottom: 64 },
  { kind: "node", id: "b1", top: 64, bottom: 96 },
  { kind: "layer", id: "A", top: 96, bottom: 128 },
];

describe("layer drag visuals", () => {
  it("starts a drag only past the threshold", () => {
    expect(DRAG_THRESHOLD_PX).toBe(3);
    expect(pastThreshold(0, 0)).toBe(false);
    expect(pastThreshold(2, 2)).toBe(false);
    expect(pastThreshold(0, 3)).toBe(true);
    expect(pastThreshold(-3, 0)).toBe(true);
  });

  it("moves the dragged rows' place to the line and closes up the rows they pass", () => {
    // b1 up above b2: b1 moves one row up, b2 one row down; nothing else moves.
    expect([...slideOffsets(rows, new Set(["b1"]), 32)]).toEqual([
      ["b1", -32],
      ["b2", 32],
    ]);
    // b2 down to the end: the rows it passes move up one row each.
    expect([...slideOffsets(rows, new Set(["b2"]), 128)]).toEqual([
      ["b1", -32],
      ["A", -32],
      ["b2", 64],
    ]);
    // Its own place, or a refused position, slides nothing.
    expect(slideOffsets(rows, new Set(["b2"]), 32).size).toBe(0);
    expect(slideOffsets(rows, new Set(["b2"]), null).size).toBe(0);
  });

  it("moves a block — a layer with its objects, or rows from apart — as one, keeping its order", () => {
    // Layer B with its two objects below layer A: A moves up three rows, B's block down one.
    expect([...slideOffsets(rows, new Set(["B", "b2", "b1"]), 128)]).toEqual([
      ["A", -96],
      ["B", 32],
      ["b2", 32],
      ["b1", 32],
    ]);
    // B and b1 (not adjacent) to the end: they gather there in their own order.
    expect([...slideOffsets(rows, new Set(["B", "b1"]), 128)]).toEqual([
      ["b2", -32],
      ["A", -64],
      ["B", 64],
      ["b1", 32],
    ]);
  });

  it("slides by each row's own height", () => {
    const mixed: RowBox[] = [
      { kind: "node", id: "x", top: 0, bottom: 40 },
      { kind: "node", id: "y", top: 40, bottom: 60 },
    ];
    expect([...slideOffsets(mixed, new Set(["x"]), 60)]).toEqual([
      ["y", -40],
      ["x", 20],
    ]);
  });

  it("keeps the floating row inside the content", () => {
    expect(ghostTop(100, 10, 400)).toBe(90);
    expect(ghostTop(5, 10, 400)).toBe(0);
    expect(ghostTop(500, 10, 400)).toBe(400 - ROW_PX);
    expect(ghostTop(20, 10, 10)).toBe(0);
  });

  it("scrolls near an edge, faster deeper in, and not in the middle", () => {
    // A 200px list from 100 to 300: 32px bands.
    expect(autoScrollStep(200, 100, 300)).toBe(0);
    expect(autoScrollStep(132, 100, 300)).toBe(0);
    expect(autoScrollStep(268, 100, 300)).toBe(0);
    expect(autoScrollStep(116, 100, 300)).toBe(-SCROLL_MAX_PX / 2);
    expect(autoScrollStep(100, 100, 300)).toBe(-SCROLL_MAX_PX);
    expect(autoScrollStep(40, 100, 300)).toBe(-SCROLL_MAX_PX);
    expect(autoScrollStep(284, 100, 300)).toBe(SCROLL_MAX_PX / 2);
    expect(autoScrollStep(400, 100, 300)).toBe(SCROLL_MAX_PX);
    // A short list narrows the bands so its middle still holds still.
    expect(autoScrollStep(150, 100, 200)).toBe(0);
    expect(autoScrollStep(110, 100, 100)).toBe(0);
  });
});
