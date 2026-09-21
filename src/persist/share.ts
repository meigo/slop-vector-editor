/** Save to Files, via the share sheet (`navigator.share` with files). **The only way a web page on
 *  iPad can put a file somewhere the user picks** — Safari has no save picker, and a download
 *  always lands in Downloads as a new, possibly renumbered copy (spec M13 §1).
 *
 *  It is still a NEW file each time: whether Files offers to replace a same-named one is up to
 *  iPadOS, not this code. What this buys is the user choosing the destination. */

/** Why a share did not complete. `needs-tap`: Safari only opens the sheet during a recent tap, and
 *  building the file took long enough for the tap to expire, so a fresh one is needed. */
export type ShareFailure = "dismissed" | "needs-tap" | "failed";
export type ShareOutcome = "shared" | ShareFailure;

/** The slice of `navigator` this module asks about, so a test can pass its own (spec M13 §9).
 *  Method shorthand is deliberate — it gets bivariant parameter checking. Property syntax
 *  (`canShare?: (data: unknown) => boolean`) fails: `Navigator.canShare(data?: ShareData)` won't
 *  assign into a `(data: unknown) => boolean`, since that direction is checked contravariantly. */
type ShareCapable = { canShare?(data: unknown): boolean };

/** iPhone / iPad.
 *
 *  **iPadOS Safari reports a Mac user agent and `MacIntel`**, so a UA test alone misses every
 *  modern iPad. A Mac platform *with* touch points is an iPad, because no real Mac has a touch
 *  screen. Takes its three inputs as arguments rather than reading `navigator`, which is what makes
 *  it testable where there is no DOM. */
export function isAppleTouch(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function classifyShareError(e: unknown): ShareFailure {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === "AbortError") return "dismissed";
  if (name === "NotAllowedError") return "needs-tap";
  return "failed";
}

/** Whether this device gets the Save to Files option at all. **Desktop share sheets have no Save
 *  to Files**, which is why the feature is limited to Apple touch devices — offering it on a
 *  browser that has a real save picker would be a downgrade (spec M13 §3). */
export function saveToFilesAvailable(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  return isAppleTouch(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

/** Whether the share sheet accepts this particular file: type support varies by browser, and
 *  `image/svg+xml` in particular is not guaranteed (spec M13 §11). */
export function canShareFile(
  file: File,
  nav: ShareCapable | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  try {
    return nav?.canShare?.({ files: [file] }) ?? false;
  } catch {
    return false;
  }
}

export async function shareFile(file: File): Promise<{ outcome: ShareOutcome; error?: unknown }> {
  try {
    await navigator.share({ files: [file] });
    return { outcome: "shared" };
  } catch (error) {
    return { outcome: classifyShareError(error), error };
  }
}
