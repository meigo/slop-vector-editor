import { describe, expect, it } from "vitest";
import {
  indexAt,
  remapIndex,
  remapOverrides,
  selectionRects,
  toCodePoint,
  toUtf16,
  verticalMove,
  wordAt,
  type CaretStop,
} from "../text/edit";
import { revealPan } from "../state/viewport";

const E = "a😀b"; // 😀 is two UTF-16 units

describe("index conversion", () => {
  it("round-trips across an astral character", () => {
    expect(toUtf16(E, 2)).toBe(3);
    expect(toCodePoint(E, 3)).toBe(2);
    expect(toCodePoint(E, 2)).toBe(1); // inside the pair rounds down
    expect(toUtf16(E, 3)).toBe(4);
  });
});

describe("remapOverrides", () => {
  const o = { 0: "A", 2: "C", 4: "E" };
  it("shifts overrides after an insertion before them", () => {
    expect(remapOverrides("abcde", "abXcde", o)).toEqual({ 0: "A", 3: "C", 5: "E" });
  });
  it("drops an override whose character was deleted, shifts the rest back", () => {
    expect(remapOverrides("abcde", "abde", o)).toEqual({ 0: "A", 3: "E" });
  });
  it("drops overrides inside a replaced span", () => {
    expect(remapOverrides("abcde", "aXYZe", o)).toEqual({ 0: "A", 4: "E" });
  });
  it("returns the same object when nothing changed", () => {
    expect(remapOverrides("abc", "abc", o)).toBe(o);
    expect(remapOverrides("abcde", "abcdeX", o)).toBe(o);
  });
  it("counts code points", () => {
    expect(remapOverrides("a😀b", "Xa😀b", { 2: "B" })).toEqual({ 3: "B" });
  });
  it("remapIndex matches", () => {
    expect(remapIndex("abcde", "abXcde", 2)).toBe(3);
    expect(remapIndex("abcde", "abde", 2)).toBeNull();
  });
});

// Text "ab\n\ncd", stops for indices 0..6 (line 1 is empty).
const L = (line: number, x: number): CaretStop => ({
  x,
  baseline: line * 20,
  top: line * 20 - 15,
  bottom: line * 20 + 5,
  line,
});
const stops = [L(0, 0), L(0, 10), L(0, 20), L(1, 0), L(2, 0), L(2, 10), L(2, 20)];

describe("indexAt / verticalMove", () => {
  it("finds the nearest stop on the nearest line, including an empty line", () => {
    expect(indexAt(stops, { x: 12, y: -3 })).toBe(1);
    expect(indexAt(stops, { x: 50, y: 18 })).toBe(3);
    expect(indexAt(stops, { x: 16, y: 38 })).toBe(6);
  });
  it("moves by goal x through an empty line, and clamps at the ends", () => {
    expect(verticalMove(stops, 2, 1, 20)).toBe(3);
    expect(verticalMove(stops, 3, 1, 20)).toBe(6);
    expect(verticalMove(stops, 1, -1, 10)).toBe(0);
    expect(verticalMove(stops, 5, 1, 10)).toBe(6);
  });
});

describe("wordAt", () => {
  it("selects a word, a whitespace run, or one character", () => {
    expect(wordAt("hello world", 2)).toEqual({ start: 0, end: 5 });
    expect(wordAt("hello  world", 6)).toEqual({ start: 5, end: 7 });
    expect(wordAt("a,b", 1)).toEqual({ start: 1, end: 2 });
  });
});

describe("selectionRects", () => {
  it("one rect per covered line, none for a caret", () => {
    expect(selectionRects(stops, 1, 1)).toEqual([]);
    expect(selectionRects(stops, 1, 5)).toEqual([
      { x0: 10, x1: 20, top: -15, bottom: 5 },
      { x0: 0, x1: 0, top: 5, bottom: 25 },
      { x0: 0, x1: 10, top: 25, bottom: 45 },
    ]);
  });
});

describe("revealPan", () => {
  const view = { x: 0, y: 0, zoom: 1 };
  const visible = { x: 0, y: 0, w: 800, h: 400 };
  it("keeps the same view when the rect is visible", () => {
    expect(revealPan(view, { x: 100, y: 100, w: 2, h: 20 }, visible, 16)).toBe(view);
  });
  it("pans up just enough to lift the rect above the bottom edge", () => {
    expect(revealPan(view, { x: 100, y: 500, w: 2, h: 20 }, visible, 16)).toEqual({
      x: 0,
      y: -136,
      zoom: 1,
    });
  });
});
