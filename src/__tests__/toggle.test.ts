import { describe, expect, it } from "vitest";
import { nextToggle, toggleView } from "../lib/toggle";

describe("toggle buttons", () => {
  it("describes the three states", () => {
    expect(toggleView(true)).toEqual({ pressed: "true", on: true, mixed: false });
    expect(toggleView(false)).toEqual({ pressed: "false", on: false, mixed: false });
    expect(toggleView("mixed")).toEqual({ pressed: "mixed", on: false, mixed: true });
  });

  it("turns a mixed or off toggle on, and an on toggle off", () => {
    expect(nextToggle(false)).toBe(true);
    expect(nextToggle("mixed")).toBe(true);
    expect(nextToggle(true)).toBe(false);
  });
});
