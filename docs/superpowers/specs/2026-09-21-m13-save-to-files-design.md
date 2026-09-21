# slop-vector-editor — milestone 13 design: Save to Files on iPad

Date: 2026-09-21. Status: approved in brainstorming. Follows M12 (PNG export). Not on the project
design's post-v1 list at all — it is a defect report from the device the project treats as
first-class, and it takes priority over envelope warp, now renumbered to M14
(`2026-09-20-m14-envelope-warp-design.md`).

Ported from **slop-animator**, which solved the same problem: `src/export/share.ts`,
`src/export/download.ts`, `src/lib/deliver-file.ts` and `src/lib/ShareReadyDialog.svelte` there.

## 1. The defect

On iPad, **Save, Save As and Export PNG cannot overwrite anything.** `window.showSaveFilePicker`
does not exist in Safari, so `writeSvgFile` and `writePngFile` both fall through to their
`<a download>` fallback, every save lands in Downloads, and the second one becomes `Logo (1).svg`,
then `Logo (2).svg`. There is no route to the file you saved ten minutes ago.

Desktop Chromium is unaffected: it has File System Access, keeps a handle, and saves in place.

## 2. The mechanism, and what it does not do

**`navigator.share({ files })` is the only way a web page on iPad can put a file where the user
chooses.** Safari has no save picker; a download always lands in Downloads. The share sheet's
**Save to Files** lets the user pick a folder.

**It is still a new file each time.** Whether Files offers to replace a same-named one is iPadOS's
decision, not this code's. What this milestone fixes is the part that actually hurts — the user
picks the destination, and gets the system's Replace prompt instead of an accumulating pile of
numbered copies in Downloads.

This is worth stating twice because the obvious summary of this work — "you can overwrite on iPad
now" — is not true, and a later reader deserves to know that before they file the next bug.

## 3. Detection

```ts
export function isAppleTouch(ua: string, platform: string, maxTouchPoints: number): boolean;
export function saveToFilesAvailable(): boolean;
export function canShareFile(file: File): boolean;
```

**`isAppleTouch` takes its three inputs as arguments rather than reading `navigator`**, which is
what makes it unit-testable in Vitest's DOM-less environment. The rule:

```
/iPad|iPhone|iPod/.test(ua)  ||  (platform === "MacIntel" && maxTouchPoints > 1)
```

**The second clause is the one everybody gets wrong.** iPadOS Safari reports a *Mac* user agent and
`MacIntel`, so a UA test alone misses every modern iPad. A Mac platform **with touch points** is an
iPad, because no real Mac has a touch screen.

`saveToFilesAvailable()` also requires `navigator.canShare` to exist. The feature is gated to Apple
touch devices deliberately: **desktop share sheets have no Save to Files**, so offering it there
would be a worse experience than the save picker those browsers already have.

`canShareFile` asks the browser about this specific file, since type support varies, and returns
false rather than throwing.

## 4. The gesture problem

**Safari opens the share sheet only during a recent tap.** If building the file outlasts that tap,
`navigator.share` rejects with `NotAllowedError`. This is the same class of bug M12 fixed in
`Copy as PNG`, where an `await` before `clipboard.write` consumed the activation — and it is worth
noting that this project has now hit it twice, because it will hit it again.

```ts
export type ShareFailure = "dismissed" | "needs-tap" | "failed";
export type ShareOutcome = "shared" | ShareFailure;
export function classifyShareError(e: unknown): ShareFailure;
```

`AbortError` → **dismissed**: the user closed the sheet. That is a choice, not a failure, and must
not be reported as an error.
`NotAllowedError` → **needs-tap**: the activation expired.
Anything else → **failed**, with the browser's own message surfaced.

**So the caller decides whether to try the sheet directly**, and the two callers differ:

| Caller | `tryDirect` | Why |
|---|---|---|
| Save / Save As | **true** | `serializeDoc` is synchronous. The sheet opens on the original tap. |
| Export PNG | **false** | Rasterising awaits `img.decode()`. A render always outlasts the tap, so attempting it would only produce a guaranteed `NotAllowedError` before falling back anyway. |

## 5. Delivery and the ready dialog

```ts
export async function deliverFile(
  file: File,
  opts: { isDoc: boolean; tryDirect: boolean; note?: string },
  // Injected for tests, exactly as `system-clipboard.ts` injects its `ClipboardLike`; the app
  // always passes neither and gets the real ones.
  deps?: { share?: typeof shareFile; canShare?: typeof canShareFile },
): Promise<"shared" | "dismissed" | "ready" | "downloaded">;
```

**The injection is why the decision table is testable at all.** `src/persist/system-clipboard.ts`
already takes a `ClipboardLike` parameter whose docstring says "the parameter exists for tests; the
app always uses the browser's clipboard", so this is the repo's established shape rather than a new
one — and it means the branching is covered by real assertions on real code, not by mocking a
module out from under it.

- The browser refuses this file type → it **downloads**, exactly as today.
- `tryDirect` and the sheet completes → **shared**.
- `tryDirect` and the user closed it → **dismissed**; nothing is saved and the document stays dirty.
- Otherwise → **ready**: `app.shareReady` is set and a dialog offers a **fresh tap**.

`ShareReadyDialog` follows the **`app.confirm` → `ConfirmDialog`** pattern already in this repo
rather than the `app.dialog` enum, because it carries a payload (the built `File`). Three actions:
**Save to Files…**, **Download instead** — the current behaviour, still one tap away — and
**Cancel**. It stays open on anything but success, so a dismissed sheet can be retried without
rebuilding the file.

A second tap while the sheet is up throws `InvalidStateError`, so the dialog holds a `sharing` flag
and disables its buttons for the duration.

## 6. What a completed share means

**A completed sheet clears the dirty marker, and the wording never says "Saved".**

The sheet completing does **not** prove the file reached Files: AirDrop, Messages and Copy complete
it too, and iPadOS reports nothing about which. Two readings were weighed:

- Treat it as saved. The bytes left the app by a route the user chose, and the alternative is a
  dirty dot that **no action on iPad can ever clear**, which makes the marker meaningless and
  teaches people to ignore it — along with the autosave warning it retires.
- Keep the marker strictly truthful and never clear it. Rejected for exactly that reason.

So: `markDocSaved` runs, and the notice reads **"Sent Logo.svg to the share sheet"** — never
"Saved". The honest wording is the price of the convenient behaviour, and it is not optional.

**The known cost:** a user who AirDrops the file and then closes the tab gets no unsaved-changes
warning. Accepted, and recorded in §11.

A **dismissed** sheet leaves the document dirty, which needs no new code: `saveDocument` already
treats a falsy result from the writer as "not saved" and only calls `markDocSaved` on a truthy one.

## 7. Where it applies

**Save, Save As and Export PNG.** `Copy as PNG` produces no file and is unaffected.

Save and Save As behave **identically** on iPad: with no file handle there is no "in place" to save
to, so the distinction the two commands draw on desktop simply does not exist there. Neither
command is hidden or disabled — hiding a control by platform would break invariant 24's rule that
a command's availability must not move under the user.

## 8. What does not change

**Desktop is untouched.** `saveToFilesAvailable()` is false without `isAppleTouch`, so Chromium
keeps File System Access and save-in-place, and macOS Safari keeps downloading exactly as it does
today.

**Invariant 10 is not involved.** It governs when a File System Access handle may be *kept* as the
save-in-place target; on iPad there has never been a handle, so no share path can endanger it.

**One adjacent fix.** `file-io.ts` revokes its download object URL after 10 s. slop-animator uses
**60 s**, having found that on iPad a short revoke can kill a download the browser has only just
begun — the browser need only have *started* the fetch, and "started" is not the same as "finished"
on a slow device. Our files are smaller than its project zips, but the reasoning holds and the cost
is nil.

## 9. Testing

**Pure, unit-tested**

- `isAppleTouch`: true for an iPad UA; true for `MacIntel` with touch points — **the iPadOS case a
  UA test alone misses**; false for `MacIntel` with zero touch points, which is a real Mac; false
  for a Windows or Linux UA.
- `classifyShareError`: `AbortError` → `dismissed`; `NotAllowedError` → `needs-tap`; a plain
  `Error`, a string, `null` and `undefined` → `failed` without throwing.
- `canShareFile`: false when `navigator.canShare` is absent, and false rather than a throw when it
  raises.
- The delivery decision table — which outcome each combination of `canShareFile`, `tryDirect` and
  share result produces — with `shareFile` injected, so no DOM is needed.

**Not unit-testable, and this is the milestone's whole point:** the share sheet itself. It needs an
iPad. The spec's correctness rests on slop-animator having shipped the same code against the same
device, not on anything verifiable here.

## 10. Out

- **Real overwrite-in-place on iPad.** No web API offers it. If one arrives, this is where it goes.
- **Remembering the last folder.** The share sheet does not expose one.
- **Sharing to anything but a file** — no link sharing, no text.
- **Desktop Safari.** It has neither a save picker nor a useful Save to Files, so it keeps
  downloading. Worth revisiting only if Safari ships File System Access.
- **Copy as PNG** (§7).

## 11. Owed

- **Every line of this needs an iPad, and none of it can be verified here.** The share sheet, the
  `needs-tap` path, whether `canShareFile` accepts `image/svg+xml` on iPadOS — all of it. It goes
  onto the same device pass that M11 and M12 are already waiting on, and it should go **first**,
  because it is the only one of the three fixing something that is actively broken rather than
  merely unverified.
- **`image/svg+xml` may not be shareable.** If `canShareFile` refuses it, Save falls back to a
  download and the defect persists for SVGs while PNG export is fixed. The fallback is correct
  either way, but the outcome would be half a milestone and we would not know until a device says.
- **The AirDrop-then-close case gives no unsaved-changes warning** (§6).
- **This project has now hit the Safari gesture rule twice** — here and in M12's `Copy as PNG`.
  A third occurrence should prompt a shared helper rather than a third careful hand-written
  ordering.
