import { describe, expect, it } from "vitest";
import {
  autoScrollStep,
  DRAG_THRESHOLD_PX,
  ghostTop,
  pastThreshold,
  ROW_PX,
  SCROLL_MAX_PX,
  shiftedRowIds,
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

  it("slides every row at or below the drop line, and none without a drop", () => {
    expect([...shiftedRowIds(rows, 64)]).toEqual(["b1", "A"]);
    expect([...shiftedRowIds(rows, 0)]).toEqual(["B", "b2", "b1", "A"]);
    expect([...shiftedRowIds(rows, 128)]).toEqual([]);
    expect(shiftedRowIds(rows, null).size).toBe(0);
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
