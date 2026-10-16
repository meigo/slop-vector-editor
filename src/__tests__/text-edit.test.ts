import { describe, expect, it } from "vitest";
import {
  fileSafeText,
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
  /** Review M5 (2026-09-30): with a doubled letter the edit is ambiguous from the strings alone;
   *  the caret after the edit says which twin changed. */
  it("uses the caret to tell twins apart", () => {
    // "Tallinn": the first "l" (2) carries the override; Backspace after it leaves the caret at 2.
    expect(remapOverrides("Tallinn", "Talinn", { 2: "L" })).toEqual({ 2: "L" }); // strings alone
    expect(remapOverrides("Tallinn", "Talinn", { 2: "L" }, 2)).toEqual({});
    expect(remapOverrides("Tallinn", "Talinn", { 3: "l" }, 2)).toEqual({ 2: "l" });
    // Typing a second "l" before the first: the caret is at 3, after the new one.
    expect(remapOverrides("Talinn", "Tallinn", { 2: "L" }, 3)).toEqual({ 3: "L" });
    expect(remapIndex("Tallinn", "Talinn", 3, 2)).toBe(2);
  });
  it("ignores a caret the edit can't have ended at", () => {
    expect(remapOverrides("abcde", "abXcde", o, 99)).toEqual({ 0: "A", 3: "C", 5: "E" });
    expect(remapOverrides("abcde", "abXcde", o, -1)).toEqual({ 0: "A", 3: "C", 5: "E" });
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
  /** Review L3 (2026-09-30): ending at a line's first stop drew a sliver on that line. */
  it("draws nothing on the line a selection ends at the start of", () => {
    expect(selectionRects(stops, 1, 4)).toEqual([
      { x0: 10, x1: 20, top: -15, bottom: 5 },
      { x0: 0, x1: 0, top: 5, bottom: 25 },
    ]);
    expect(selectionRects(stops, 4, 1)).toHaveLength(2);
  });
});

describe("selectionRects overlap", () => {
  it("meets adjacent lines at the midpoint of their overlap", () => {
    const st: CaretStop[] = [
      { x: 0, baseline: 0, top: -20, bottom: 10, line: 0 },
      { x: 10, baseline: 0, top: -20, bottom: 10, line: 0 },
      { x: 0, baseline: 24, top: 4, bottom: 34, line: 1 },
      { x: 10, baseline: 24, top: 4, bottom: 34, line: 1 },
    ];
    const r = selectionRects(st, 0, 3);
    expect(r[0].bottom).toBe(7);
    expect(r[1].top).toBe(7);
    expect(r[0].top).toBe(-20);
    expect(r[1].bottom).toBe(34);
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

/** Review L14 (2026-10-17): the writer strips what XML forbids, so a title holding it reopened
 *  shorter, with its overrides on the wrong letters. */
describe("fileSafeText", () => {
  it("maps what the file can't hold one for one, so indices keep their letters", () => {
    const raw = "A\u000BB\u0001C￾\uD800D";
    const safe = fileSafeText(raw);
    expect(safe).toBe("A\nB C��D");
    expect([...safe]).toHaveLength([...raw].length);
  });
  it("leaves ordinary text, emoji and tabs alone", () => {
    const s = "Tallinn — šž\tõäöü 👍🏽\n";
    expect(fileSafeText(s)).toBe(s);
  });
});

/** Review L15 (2026-10-17): a combining mark has no advance, so the stops before and after it share
 *  an x, and a click there put the caret between a letter and its accent. */
describe("caret positions stay on grapheme boundaries", () => {
  // "e" + U+0301 + "x": stops at 0, 10, 10 (inside the cluster), 20.
  const text = "éx";
  const one = [L(0, 0), L(0, 10), L(0, 10), L(0, 20)];
  it("indexAt never lands inside a cluster when it knows the text", () => {
    expect(indexAt(one, { x: 10, y: 0 })).toBe(1); // without the text: the old answer
    expect(indexAt(one, { x: 10, y: 0 }, text)).toBe(2);
    expect(indexAt(one, { x: 3, y: 0 }, text)).toBe(0);
  });
  it("verticalMove lands on a boundary too", () => {
    const two = [...one.slice(0, 3), L(0, 20), L(1, 10)];
    // "éx\n" then line 1 at index 4; moving up from it towards x 10 finds the cluster end.
    expect(verticalMove(two, 4, -1, 10, "éx\n")).toBe(2);
  });
});
