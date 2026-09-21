# M13 Save to Files on iPad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On iPad, let Save, Save As and Export PNG put a file where the user chooses, via the share sheet's Save to Files, instead of piling renumbered copies into Downloads.

**Architecture:** `navigator.share({ files })` is the only mechanism iPad offers. A pure detection module decides whether the device gets it; a pure delivery module decides share-vs-download and returns an outcome; the store maps that outcome onto notices, the dirty marker and a fallback dialog that supplies a **fresh tap** when Safari's activation has expired. Ported from slop-animator, which solved the same problem.

**Tech Stack:** Svelte 5 (runes), TypeScript strict, Vite, Vitest (node env, no DOM). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-21-m13-save-to-files-design.md`

## Global Constraints

- **`isAppleTouch` takes `ua`, `platform` and `maxTouchPoints` as arguments** rather than reading `navigator` — that is what makes it testable in Vitest's DOM-less environment.
- **iPadOS Safari reports a Mac user agent and `MacIntel`.** A Mac platform *with* touch points is an iPad; no real Mac has a touch screen. A UA test alone misses every modern iPad.
- **The feature is gated to Apple touch devices.** Desktop share sheets have no Save to Files, so offering it there would be worse than the save picker those browsers already have.
- **Safari opens the share sheet only during a recent tap.** Save passes `tryDirect: true` (serializing is synchronous); Export PNG passes `tryDirect: false` (a render always outlasts the tap).
- **`AbortError` means dismissed, not failed** — the user's choice, never reported as an error. `NotAllowedError` means the activation expired.
- **A completed share clears the dirty marker, and the wording never says "Saved"** — it says "Sent … to the share sheet", because AirDrop and Copy complete the sheet too.
- **`src/state/appState.svelte.ts` must NOT import `src/persist/project-io.ts`.** `project-io` imports the store; the reverse direction was a cycle removed in M12 (commit `9736f04`) and must not come back.
- **The document is immutable** (invariant 1); the store is `$state.raw` — replace, never mutate (invariant 2).
- **Invariant 10 is not involved**: it governs when a File System Access handle may be kept, and on iPad there has never been a handle.
- TypeScript strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Build bar: **0 errors, 0 warnings**, `paper-core` and `opentype` still in their own chunks.
- Doc comments and user-facing strings use typographic characters (`—`, `→`, `×`, `▸`, `§`). Commit *message bodies* are plain ASCII.
- **`File` and `Blob` exist in this Vitest environment, and so does `navigator`** — verified on
  Node 25 before this plan was written, so `new File([...], name, { type })` works in a test and
  needs no polyfill. Note the consequence for the real code: `navigator` being defined in node means
  `saveToFilesAvailable()` reaches its `typeof navigator.canShare !== "function"` check and returns
  false there, *before* it ever touches the deprecated `navigator.platform`. That is why the guard
  is ordered the way it is.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `src/persist/share.ts` | **New.** Detection and the share call: `isAppleTouch`, `classifyShareError`, `saveToFilesAvailable`, `canShareFile`, `shareFile`. |
| `src/persist/file-io.ts` | **Modified.** Extracts the twice-duplicated anchor-download into `downloadBlob`, with the revoke delay raised to 60 s. |
| `src/persist/deliver.ts` | **New.** `deliverFile(file, { tryDirect }, deps?)` — the share-vs-download decision, with dependencies injected for tests. Touches no store. |
| `src/state/appState.svelte.ts` | **Modified.** `ShareReadyRequest`, `app.shareReady`, `reportDelivery`, the dialog's three actions, and `exportPng`'s share path. |
| `src/persist/project-io.ts` | **Modified.** `saveDocument` takes the share path when the device offers it. |
| `src/lib/ShareReadyDialog.svelte` | **New.** The fresh-tap dialog, following `ConfirmDialog`'s payload pattern. |
| `src/App.svelte` | **Modified.** Renders it. |

---

### Task 1: `src/persist/share.ts`

**Files:**
- Create: `src/persist/share.ts`
- Test: `src/__tests__/share.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ShareFailure`, `ShareOutcome`, `isAppleTouch(ua, platform, maxTouchPoints): boolean`, `classifyShareError(e: unknown): ShareFailure`, `saveToFilesAvailable(): boolean`, `canShareFile(file: File, nav?): boolean`, `shareFile(file: File): Promise<{ outcome: ShareOutcome; error?: unknown }>`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/share.test.ts`.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/share.test.ts`
Expected: FAIL — cannot resolve `../persist/share`.

- [ ] **Step 3: Implement `src/persist/share.ts`**

```ts
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

/** The slice of `navigator` this module asks about, so a test can pass its own (spec M13 §9). */
type ShareCapable = { canShare?: (data: unknown) => boolean };

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
```

`navigator.platform` is deprecated, and ESLint or `svelte-check` may say so. **Do not replace it** — `navigator.userAgentData` does not exist in Safari, which is the only browser this code path runs in. If a warning breaks the 0-warnings build bar, silence that single line with a comment explaining why, and say so in your report.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/share.test.ts`
Expected: PASS, all fourteen.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: PASS; 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/persist/share.ts src/__tests__/share.test.ts
git commit -m "$(cat <<'EOF'
feat: detect Apple touch devices and wrap the share sheet

isAppleTouch takes ua/platform/maxTouchPoints as arguments rather than
reading navigator, so it is testable without a DOM -- and the rule it
encodes is the one everybody gets wrong: iPadOS Safari reports a Mac
user agent and MacIntel, so a UA test alone misses every modern iPad. A
Mac platform WITH touch points is an iPad; no real Mac has a touch
screen.

AbortError is classified as 'dismissed', not a failure: closing the
share sheet is a choice and must never be reported as an error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `downloadBlob`, and a 60-second revoke

**Files:**
- Modify: `src/persist/file-io.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `downloadBlob(blob: Blob, name: string): void`.

No new tests: this is a DOM-only helper extracted from two existing call sites, and Vitest has no DOM. Its proof is that the suite stays green and the build is clean.

- [ ] **Step 1: Add the helper near the top of `src/persist/file-io.ts`**

```ts
/** How long the object URL outlives the click. Revoking it in the same tick is what MDN's example
 *  does, but the browser only has to have **started** the fetch by then — and on iPad a short
 *  revoke can kill a download it has only just begun. slop-animator found this with multi-hundred-
 *  MB project zips; our files are smaller, but the reasoning holds and the cost is nil
 *  (spec M13 §8). */
const REVOKE_DELAY_MS = 60_000;

/** Trigger a browser download of `blob` as `name`. The fallback for every browser without a save
 *  picker — and on iPad, the thing Save to Files exists to replace. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
```

- [ ] **Step 2: Use it in both existing fallbacks**

In `writeSvgFile`, replace the five-line download block with:

```ts
  downloadBlob(new Blob([text], { type: "image/svg+xml" }), name);
  return { name, handle: null };
```

In `writePngFile`, replace its block with:

```ts
  downloadBlob(blob, name);
  return name;
```

Both previously used a 10 000 ms revoke; both now get 60 000 through the shared constant. **Change nothing else in either function** — in particular `writeSvgFile` keeps its handle logic untouched, because that is what invariant 10 protects.

- [ ] **Step 3: Run the suite and the build**

Run: `npm test && npm run build`
Expected: PASS with the same test count as before; 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/persist/file-io.ts
git commit -m "$(cat <<'EOF'
refactor: one downloadBlob, and a 60s revoke instead of 10s

The anchor-download fallback was duplicated verbatim between
writeSvgFile and writePngFile, and a third caller is about to arrive.

The revoke delay goes up because the browser only has to have STARTED
the fetch when the URL is revoked, and on iPad a short revoke can kill a
download it has only just begun.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `src/persist/deliver.ts`

**Files:**
- Create: `src/persist/deliver.ts`
- Test: `src/__tests__/deliver.test.ts`

**Interfaces:**
- Consumes: `canShareFile`, `shareFile`, `ShareOutcome` from `./share` (Task 1); `downloadBlob` from `./file-io` (Task 2).
- Produces: `DeliverResult`, `DeliverDeps`, `deliverFile(file, opts, deps?): Promise<DeliverResult>`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/deliver.test.ts`.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/deliver.test.ts`
Expected: FAIL — cannot resolve `../persist/deliver`.

- [ ] **Step 3: Implement `src/persist/deliver.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/deliver.test.ts`
Expected: PASS, all seven.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/persist/deliver.ts src/__tests__/deliver.test.ts
git commit -m "$(cat <<'EOF'
feat: deliverFile decides between the share sheet and a download

It touches no store: mapping the outcome onto notices and the dirty
marker is the caller's job, which keeps the decision table testable with
injected dependencies and keeps persist/ free of store imports.

tryDirect rides the tap that started the build. Export passes false
because a render always outlasts the tap, so attempting a direct share
would buy a guaranteed NotAllowedError and nothing else.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: store state, `reportDelivery`, and the dialog

**Files:**
- Modify: `src/state/appState.svelte.ts`
- Create: `src/lib/ShareReadyDialog.svelte`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `deliverFile`, `DeliverResult` (Task 3); `shareFile` (Task 1); `downloadBlob` (Task 2).
- Produces: `ShareReadyRequest`, `app.shareReady`, `reportDelivery(result, opts)`, `shareReadyRetry()`, `shareReadyDownload()`, `shareReadyCancel()`.

- [ ] **Step 1: Add the request type and the store field**

Beside `ConfirmRequest` in `src/state/appState.svelte.ts`:

```ts
/** A built file waiting for a fresh tap to open the share sheet (spec M13 §5). Carries a payload,
 *  so it follows `ConfirmRequest`'s shape rather than the `DialogKind` enum. */
export type ShareReadyRequest = {
  file: File;
  /** A document save rather than an export: only a document retires the dirty marker. */
  isDoc: boolean;
  /** Extra context for the notice, e.g. a PNG's pixel size. */
  note: string;
  /** The browser's own message when a direct share failed outright; empty for an expired tap. */
  error: string;
  /** The document the file was built from, so a later share marks exactly it saved. */
  doc: Doc | null;
};
```

…and in the `AppState` class, beside `confirm`:

```ts
  shareReady = $state.raw<ShareReadyRequest | null>(null);
```

- [ ] **Step 2: Add `reportDelivery` and the dialog's three actions**

```ts
/** Map a `deliverFile` result onto notices, the dirty marker and the fresh-tap dialog.
 *
 *  **A completed sheet clears the dirty marker, and the wording never says "Saved"** (spec M13 §6).
 *  The sheet completing does not prove the file reached Files — AirDrop, Messages and Copy complete
 *  it too, and iPadOS reports nothing about which. Treating it as saved is the lesser evil: the
 *  alternative is a dirty dot that no action on iPad can ever clear, which teaches people to ignore
 *  it and never retires the autosave warning either. The honest wording is the price of that, and
 *  it is not optional. */
export function reportDelivery(
  result: DeliverResult,
  { file, isDoc, note, doc }: { file: File; isDoc: boolean; note: string; doc: Doc | null },
): void {
  const tail = note ? ` — ${note}` : "";
  switch (result.kind) {
    case "shared":
      if (isDoc && doc) markDocSaved(doc, file.name, null);
      notify("info", `Sent ${file.name} to the share sheet${tail}`);
      return;
    case "downloaded":
      if (isDoc && doc) markDocSaved(doc, file.name, null);
      notify("info", `Downloaded ${file.name}${tail}`);
      return;
    case "dismissed":
      // Closing the sheet is a choice, not a failure, and nothing was saved.
      notify("info", `${file.name} was not saved — the share sheet was closed.`);
      return;
    case "ready":
      app.shareReady = { file, isDoc, note, error: result.error, doc };
      return;
  }
}

/** The dialog's Save to Files… button. THIS tap is the fresh activation the direct attempt
 *  lacked, so `shareFile` must be called before anything awaits (spec M13 §4). */
export async function shareReadyRetry(): Promise<void> {
  const r = app.shareReady;
  if (!r) return;
  const out = await shareFile(r.file);
  if (out.outcome === "shared") {
    app.shareReady = null;
    reportDelivery({ kind: "shared" }, r);
    return;
  }
  app.shareReady = {
    ...r,
    error:
      out.outcome === "dismissed"
        ? ""
        : out.outcome === "needs-tap"
          ? "The browser refused to open the share sheet."
          : errorMessage(out.error),
  };
}

export function shareReadyDownload(): void {
  const r = app.shareReady;
  if (!r) return;
  app.shareReady = null;
  downloadBlob(r.file, r.file.name);
  reportDelivery({ kind: "downloaded" }, r);
}

export function shareReadyCancel(): void {
  app.shareReady = null;
}
```

Add the imports: `deliverFile` and `type DeliverResult` from `../persist/deliver`, `shareFile` from `../persist/share`, `downloadBlob` from `../persist/file-io`. `errorMessage` is already imported from `../persist/errors`. **Do not import `../persist/project-io`** — that direction is the cycle removed in M12.

- [ ] **Step 3: Create `src/lib/ShareReadyDialog.svelte`**

Presentational: it renders the request and calls the store's actions, exactly as `ConfirmDialog` does.

```svelte
<script lang="ts">
  import {
    shareReadyCancel,
    shareReadyDownload,
    shareReadyRetry,
    type ShareReadyRequest,
  } from "../state/appState.svelte";
  import Modal from "./Modal.svelte";

  let { request }: { request: ShareReadyRequest } = $props();

  // Held while the sheet is up: a second tap throws InvalidStateError ("already open").
  let sharing = $state(false);

  async function share() {
    if (sharing) return;
    sharing = true;
    try {
      await shareReadyRetry();
    } finally {
      sharing = false;
    }
  }
</script>

<Modal title="{request.file.name} is ready" onclose={shareReadyCancel}>
  <p class="text-xs text-muted">
    In the share sheet, choose “Save to Files” and pick a folder.
  </p>
  {#if request.note}<p class="mt-1 text-xs text-muted">{request.note}</p>{/if}
  {#if request.error}
    <p class="mt-2 text-xs text-danger">Couldn't share: {request.error}</p>
  {/if}
  {#snippet actions()}
    <button class="btn" disabled={sharing} onclick={shareReadyCancel}>Cancel</button>
    <button
      class="btn"
      disabled={sharing}
      title="Download to the browser's Downloads, as before"
      onclick={shareReadyDownload}
    >
      Download instead
    </button>
    <button class="btn btn-primary" disabled={sharing} onclick={share}>Save to Files…</button>
  {/snippet}
</Modal>
```

- [ ] **Step 4: Render it from `src/App.svelte`**

Import it beside the other dialogs and add, next to the existing `app.confirm` block:

```svelte
{#if app.shareReady}
  <ShareReadyDialog request={app.shareReady} />
{/if}
```

- [ ] **Step 5: Build**

Run: `npm test && npm run build`
Expected: PASS with the same count as Task 3; 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/ShareReadyDialog.svelte src/App.svelte
git commit -m "$(cat <<'EOF'
feat: the share-ready dialog and its store state

A completed sheet clears the dirty marker and the wording never says
'Saved' -- it says 'Sent ... to the share sheet', because AirDrop and
Copy complete the sheet too and iPadOS reports nothing about which.
Treating it as saved is the lesser evil: the alternative is a dirty dot
no action on iPad could ever clear.

The dialog's Save to Files button IS the fresh activation the direct
attempt lacked, so shareFile is called before anything awaits.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: wire Save, Save As and Export PNG

**Files:**
- Modify: `src/persist/project-io.ts`
- Modify: `src/state/appState.svelte.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: the user-facing behaviour.

- [ ] **Step 1: Take the share path in `saveDocument`**

In `src/persist/project-io.ts`, replace the body of `saveDocument`:

```ts
export async function saveDocument(asNew: boolean): Promise<void> {
  // Capture the doc being written: edits made while the write is in flight stay dirty.
  const doc = app.doc;
  try {
    if (saveToFilesAvailable()) {
      // `asNew` is deliberately ignored here: with no file handle there is no "in place" to save
      // to, so Save and Save As are the same action on iPad (spec M13 §7).
      const file = new File([serializeDoc(doc)], app.fileName, { type: "image/svg+xml" });
      // Serializing is synchronous, so the sheet can still ride the tap that started the save.
      const r = await deliverFile(file, { tryDirect: true });
      reportDelivery(r, { file, isDoc: true, note: "", doc });
      return;
    }
    const r = await writeSvgFile(serializeDoc(doc), app.fileName, app.fileHandle, asNew);
    if (r) markDocSaved(doc, r.name, r.handle);
  } catch (err) {
    notify("error", `Save failed: ${errorMessage(err)}`);
  }
}
```

Add `deliverFile` from `./deliver`, `saveToFilesAvailable` from `./share`, and `reportDelivery` to the existing import from `../state/appState.svelte`.

- [ ] **Step 2: Take the share path in `exportPng`**

In `src/state/appState.svelte.ts`:

```ts
export async function exportPng(
  region: ExportRegion,
  scale: number,
  transparent: boolean,
): Promise<void> {
  try {
    const out = await pngFor(region, scale, transparent);
    if (typeof out === "string") return notify("info", `Export PNG — ${out}`);
    const name = pngFileName(app.fileName);
    if (saveToFilesAvailable()) {
      const file = new File([out.blob], name, { type: "image/png" });
      // `tryDirect: false`: rasterising awaited `img.decode()`, so the tap that opened the dialog
      // is long gone and a direct share would only earn a NotAllowedError (spec M13 §4).
      const r = await deliverFile(file, { tryDirect: false });
      reportDelivery(r, { file, isDoc: false, note: `${out.w} × ${out.h}`, doc: null });
      return;
    }
    const saved = await writePngFile(out.blob, name);
    // A null name is the user cancelling the picker, which is not a failure and says nothing.
    if (saved) notify("info", `Exported ${saved} — ${out.w} × ${out.h}.`);
  } catch (err) {
    notify("error", `Export PNG — ${errorMessage(err)}`);
  }
}
```

Add `saveToFilesAvailable` to the imports from `../persist/share`.

- [ ] **Step 3: Build and test**

Run: `npm test && npm run build`
Expected: PASS; 0 errors, 0 warnings, chunks unchanged.

- [ ] **Step 4: Verify on desktop that nothing changed**

Start a dev server on a port that is **not** 5173 — the user keeps their own there with a real document in autosave: `npx vite --port 5198 --strictPort`. **Stop it when done.**

Desktop Chrome is not an Apple touch device, so `saveToFilesAvailable()` is false and every path below must behave exactly as it did before this milestone:

1. Draw a shape → **File ▸ Save** → the save picker appears (or a download, in a browser without File System Access). The dirty dot clears.
2. **File ▸ Export PNG…** → export → the PNG saves as before.
3. No share dialog appears at any point.
4. Console clean.

Then confirm the gate itself, from the console:
```js
(await import("/src/persist/share.ts")).saveToFilesAvailable()
```
Expected: `false` on desktop. Record the actual value.

**You cannot verify the iPad path here.** Do not claim you did. Report what you ran and what you could not.

- [ ] **Step 5: Commit**

```bash
git add src/persist/project-io.ts src/state/appState.svelte.ts
git commit -m "$(cat <<'EOF'
feat: Save, Save As and Export PNG use Save to Files on iPad

Save rides the tap that started it, because serializing is synchronous.
Export does not even try, because rasterising awaits img.decode() and a
render always outlasts the tap.

asNew is deliberately ignored on the share path: with no file handle
there is no 'in place' to save to, so Save and Save As are the same
action on iPad.

Desktop is untouched -- saveToFilesAvailable() is false without an Apple
touch device, so Chromium keeps File System Access and save-in-place.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/superpowers/CHANGELOG.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Append a CHANGELOG entry**

Read the last two or three entries first and match their voice and density. It must carry:

- **The defect**: iPad Safari has no save picker, so every Save and Export landed in Downloads and the second became `Logo (1).svg`.
- **The mechanism**: `navigator.share({ files })` is the only way a web page on iPad can put a file where the user chooses — **and it still does not literally overwrite**. Each share is a new file; whether Files offers Replace is iPadOS's call. Say this plainly, because "you can overwrite on iPad now" is the summary everyone will reach for and it is not true.
- **The detection rule everybody gets wrong**: iPadOS Safari reports a Mac user agent and `MacIntel`, so a UA test alone misses every modern iPad; a Mac platform *with* touch points is an iPad.
- **The gesture rule**: Safari opens the sheet only during a recent tap. Save rides the original tap; Export does not even try. Note that **this project has now hit the same rule twice** — here and in M12's `Copy as PNG` — and that a third occurrence should earn a shared helper.
- **The dirty-marker decision** and its honest wording, including the accepted cost (AirDrop then close gives no unsaved-changes warning).
- **Owed**, most pressing first: every line of this needs an iPad and none of it is verified; `image/svg+xml` may not be shareable, in which case Save falls back to a download and the defect persists for SVGs while PNG export is fixed.
- The desktop verification from Task 5 Step 4 — **only what was actually observed**.

- [ ] **Step 2: Update README.md**

Describe Save to Files where saving is described: what it does on iPad, that Save and Save As are the same action there, and that it does not overwrite in place. Update the test count to what `npm test` reports.

- [ ] **Step 3: Update CLAUDE.md**

Add `share.ts` and `deliver.ts` to the `src/persist/` list, and `ShareReadyDialog` to `src/lib/`. Update the `npm test` count. In **Current state / Roadmap**, mark M13 complete and name **M14 — envelope warp** (`docs/superpowers/specs/2026-09-20-m14-envelope-warp-design.md`) as next.

Add an invariant for the gesture rule, since it has now bitten twice:

```
45. **Safari opens a share sheet or writes the clipboard only during a recent tap.** `navigator.share`
    and `navigator.clipboard.write` must be **called** inside the activation — not merely handed a
    promise that settles later. `copyPng` (M12) and `deliverFile`'s `tryDirect` (M13) both encode
    this: build nothing before the call that you can build after it, and where a build is
    unavoidable — a PNG render — do not attempt the direct path at all, but go straight to a dialog
    whose button supplies a fresh tap.
```

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run build`
Expected: PASS; 0 errors, 0 warnings.

```bash
git add docs/superpowers/CHANGELOG.md README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: M13 Save to Files on iPad

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```
