import { errorMessage } from "./errors";
import { downloadBlob } from "./file-io";
import { canShareFile, shareFile, type ShareOutcome } from "./share";

/** What happened to a finished file. `ready` means the caller should raise the fresh-tap dialog. */
export type DeliverResult =
  | { kind: "shared" }
  | { kind: "dismissed" }
  | { kind: "downloaded" }
  | { kind: "ready"; error: string };

/** Injected for tests, exactly as `system-clipboard.ts` injects its `ClipboardLike`; the app passes
 *  nothing and gets the real ones. This is what makes the decision table below testable without a
 *  DOM or a device (spec M13 §9). */
export type DeliverDeps = {
  canShare?: (file: File) => boolean;
  share?: (file: File) => Promise<{ outcome: ShareOutcome; error?: unknown }>;
  download?: (blob: Blob, name: string) => void;
};

/** Send a finished file toward Save to Files. The caller has already checked
 *  `saveToFilesAvailable()`; this decides only what to do with the file it is given.
 *
 *  `tryDirect` opens the sheet immediately, riding the tap that started the build. That works only
 *  while Safari still counts the tap, so anything else falls through to the dialog, where a fresh
 *  tap opens the sheet. **Export passes false**: a render always outlasts the tap, so attempting it
 *  would buy a guaranteed `NotAllowedError` and nothing else (spec M13 §4).
 *
 *  This module touches no store. Mapping the result onto notices and the dirty marker is the
 *  caller's job, which is what keeps it testable and keeps `persist/` free of store imports. */
export async function deliverFile(
  file: File,
  { tryDirect }: { tryDirect: boolean },
  deps: DeliverDeps = {},
): Promise<DeliverResult> {
  const canShare = deps.canShare ?? canShareFile;
  const share = deps.share ?? shareFile;
  const download = deps.download ?? downloadBlob;

  if (!canShare(file)) {
    download(file, file.name);
    return { kind: "downloaded" };
  }
  if (tryDirect) {
    const r = await share(file);
    if (r.outcome === "shared") return { kind: "shared" };
    if (r.outcome === "dismissed") return { kind: "dismissed" };
    // An expired tap is expected and needs no message; a real failure carries the browser's own.
    return { kind: "ready", error: r.outcome === "failed" ? errorMessage(r.error) : "" };
  }
  return { kind: "ready", error: "" };
}
