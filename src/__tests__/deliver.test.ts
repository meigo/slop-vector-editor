import { describe, expect, it } from "vitest";
import { deliverFile, type DeliverDeps } from "../persist/deliver";
import type { ShareOutcome } from "../persist/share";

const file = new File(["<svg/>"], "Logo.svg", { type: "image/svg+xml" });

/** Dependencies that always share successfully and record what was downloaded. */
function deps(
  over: Partial<DeliverDeps> = {},
): DeliverDeps & { downloaded: { blob: Blob; name: string }[] } {
  const downloaded: { blob: Blob; name: string }[] = [];
  return {
    canShare: () => true,
    share: async () => ({ outcome: "shared" as ShareOutcome }),
    download: (blob, name) => void downloaded.push({ blob, name }),
    downloaded,
    ...over,
  };
}

describe("deliverFile", () => {
  it("downloads, and does not share, when the browser refuses the file type", async () => {
    let shared = false;
    const d = deps({
      canShare: () => false,
      share: async () => {
        shared = true;
        return { outcome: "shared" as ShareOutcome };
      },
    });
    const r = await deliverFile(file, { tryDirect: true }, d);
    expect(r).toEqual({ kind: "downloaded" });
    expect(shared).toBe(false);
    expect(d.downloaded).toEqual([{ blob: file, name: "Logo.svg" }]);
  });

  it("shares directly when asked to and the sheet completes", async () => {
    const r = await deliverFile(file, { tryDirect: true }, deps());
    expect(r).toEqual({ kind: "shared" });
  });

  it("reports a closed sheet as dismissed, not as a failure", async () => {
    const d = deps({ share: async () => ({ outcome: "dismissed" as ShareOutcome }) });
    const r = await deliverFile(file, { tryDirect: true }, d);
    expect(r).toEqual({ kind: "dismissed" });
  });

  it("falls back to the ready dialog with no error text when the tap expired", async () => {
    const d = deps({ share: async () => ({ outcome: "needs-tap" as ShareOutcome }) });
    // An expired tap is expected, not exceptional: the dialog exists to supply a fresh one, so
    // there is nothing to tell the user beyond offering the button.
    expect(await deliverFile(file, { tryDirect: true }, d)).toEqual({ kind: "ready", error: "" });
  });

  it("falls back to the ready dialog carrying the browser's message when the share failed", async () => {
    const d = deps({
      share: async () => ({ outcome: "failed" as ShareOutcome, error: new Error("no sheet") }),
    });
    expect(await deliverFile(file, { tryDirect: true }, d)).toEqual({
      kind: "ready",
      error: "no sheet",
    });
  });

  it("goes straight to the ready dialog without attempting a share when tryDirect is false", async () => {
    let attempted = false;
    const d = deps({
      share: async () => {
        attempted = true;
        return { outcome: "shared" as ShareOutcome };
      },
    });
    const r = await deliverFile(file, { tryDirect: false }, d);
    expect(r).toEqual({ kind: "ready", error: "" });
    expect(attempted).toBe(false);
  });

  it("still downloads rather than opening a dialog when the type is refused and tryDirect is false", async () => {
    const d = deps({ canShare: () => false });
    expect(await deliverFile(file, { tryDirect: false }, d)).toEqual({ kind: "downloaded" });
    expect(d.downloaded).toHaveLength(1);
  });
});
