import { describe, expect, it } from "vitest";
import { canShareFile, classifyShareError, isAppleTouch } from "../persist/share";

const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
// iPadOS Safari's desktop-mode UA: indistinguishable from a Mac except for the touch points.
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

describe("isAppleTouch", () => {
  it("is true for an iPad or iPhone user agent", () => {
    expect(isAppleTouch(IPAD, "iPad", 5)).toBe(true);
    expect(isAppleTouch(IPHONE, "iPhone", 5)).toBe(true);
  });

  it("is true for MacIntel WITH touch points — the iPadOS case a UA test alone misses", () => {
    expect(isAppleTouch(IPAD_DESKTOP_UA, "MacIntel", 5)).toBe(true);
  });

  it("is false for MacIntel with no touch points, which is a real Mac", () => {
    expect(isAppleTouch(IPAD_DESKTOP_UA, "MacIntel", 0)).toBe(false);
  });

  it("is false for a Mac reporting exactly one touch point", () => {
    // The rule is `> 1`: a lone touch point is not a touch screen.
    expect(isAppleTouch(IPAD_DESKTOP_UA, "MacIntel", 1)).toBe(false);
  });

  it("is false for Windows, whatever its touch points say", () => {
    expect(isAppleTouch(WINDOWS, "Win32", 10)).toBe(false);
  });
});

describe("classifyShareError", () => {
  it("reads AbortError as the user dismissing the sheet, not a failure", () => {
    expect(classifyShareError({ name: "AbortError" })).toBe("dismissed");
  });

  it("reads NotAllowedError as an expired tap", () => {
    expect(classifyShareError({ name: "NotAllowedError" })).toBe("needs-tap");
  });

  it("reads anything else as a failure, without throwing on odd input", () => {
    expect(classifyShareError(new Error("boom"))).toBe("failed");
    expect(classifyShareError("boom")).toBe("failed");
    expect(classifyShareError(null)).toBe("failed");
    expect(classifyShareError(undefined)).toBe("failed");
    expect(classifyShareError(42)).toBe("failed");
  });
});

describe("canShareFile", () => {
  const file = new File(["<svg/>"], "Logo.svg", { type: "image/svg+xml" });

  it("is false when the browser has no canShare at all", () => {
    expect(canShareFile(file, {})).toBe(false);
  });

  it("is false when there is no navigator to ask", () => {
    expect(canShareFile(file, undefined)).toBe(false);
  });

  it("passes the file to canShare and returns its answer", () => {
    let seen: unknown = null;
    const yes = canShareFile(file, {
      canShare: (d) => {
        seen = d;
        return true;
      },
    });
    expect(yes).toBe(true);
    expect(seen).toEqual({ files: [file] });
    expect(canShareFile(file, { canShare: () => false })).toBe(false);
  });

  it("returns false rather than throwing when canShare itself raises", () => {
    expect(
      canShareFile(file, {
        canShare: () => {
          throw new TypeError("illegal invocation");
        },
      }),
    ).toBe(false);
  });
});
