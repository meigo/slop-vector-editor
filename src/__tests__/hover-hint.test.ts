import { describe, expect, it } from "vitest";
import { hintFrom, type HintTarget } from "../lib/hover-hint";

const within = (title: string | null): HintTarget => ({
  closest: (selector) => {
    expect(selector).toBe("[title]");
    return title === null ? null : { getAttribute: (name) => (name === "title" ? title : null) };
  },
});

describe("status-bar hover hints", () => {
  it("uses the nearest title under a mouse", () => {
    expect(hintFrom(within("Cut (⌘X)"), "mouse")).toBe("Cut (⌘X)");
  });

  it("uses the nearest title under a touch or a pen too (spec M5 §5)", () => {
    expect(hintFrom(within("Cut (⌘X)"), "touch")).toBe("Cut (⌘X)");
    expect(hintFrom(within("Cut (⌘X)"), "pen")).toBe("Cut (⌘X)");
  });

  it("ignores missing targets and empty titles", () => {
    expect(hintFrom(null, "mouse")).toBeNull();
    expect(hintFrom(within(null), "mouse")).toBeNull();
    expect(hintFrom(within(""), "mouse")).toBeNull();
  });
});
