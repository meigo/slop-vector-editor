import { describe, expect, it } from "vitest";
import { revealScrollTop } from "../lib/reveal";

describe("revealScrollTop", () => {
  it("leaves a fully visible row alone", () => {
    expect(revealScrollTop(100, 300, 150, 182)).toBe(100);
  });

  it("leaves a row touching either edge alone", () => {
    expect(revealScrollTop(100, 300, 100, 132)).toBe(100);
    expect(revealScrollTop(100, 300, 368, 400)).toBe(100);
  });

  it("scrolls just far enough to show a row below the view", () => {
    expect(revealScrollTop(0, 300, 290, 322)).toBe(22);
    expect(revealScrollTop(0, 300, 500, 532)).toBe(232);
  });

  it("scrolls just far enough to show a row above the view", () => {
    expect(revealScrollTop(200, 300, 180, 212)).toBe(180);
    expect(revealScrollTop(200, 300, 0, 32)).toBe(0);
  });

  it("aligns the top of a row taller than the view", () => {
    expect(revealScrollTop(0, 20, 100, 132)).toBe(100);
  });

  it("does nothing before the list has a height", () => {
    expect(revealScrollTop(40, 0, 500, 532)).toBe(40);
    expect(revealScrollTop(40, -5, 500, 532)).toBe(40);
  });
});
