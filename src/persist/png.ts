/** Spec (M12) §3 and §8. The impure half of PNG export: everything here needs a DOM, so none of it
 *  is unit-tested — the spike recorded in the spec and the browser pass are its evidence. */

/** Rasterise SVG text at an exact pixel size.
 *
 *  The spike (spec M12 §2) established two things this relies on. The canvas is **not tainted**,
 *  because a serialized document contains no `<text>` and no external reference — so `toBlob`
 *  works. And `drawImage` **re-rasterises the vector at the destination size**: an 8× draw came
 *  back with no blur ramp at all, identical to rewriting the SVG root first, so scale needs no
 *  rewriting here. */
export async function rasterise(svgText: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser gave no 2D canvas");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    // Past the canvas ceiling the browser throws nothing and lands here with null. The caller
    // refuses oversized exports before reaching this point (`exportRefusal`); this is the backstop
    // for a limit lower than the one we cap at — iOS, most likely.
    if (!blob) throw new Error("the image was too large for this browser to encode");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Spec (M12) §8. Never throws, like `system-clipboard.ts`'s text wrapper: false means the caller
 *  should tell the user to use Export PNG… instead.
 *
 *  Takes a **pending** `Promise<Blob>` rather than a settled one — this is the whole point of the
 *  promise form of `ClipboardItem`. Safari requires `navigator.clipboard.write` to be *called*
 *  synchronously inside the click's user activation; it does not merely accept a promise, it
 *  requires one, because that is what lets the call happen before the blob exists. A caller that
 *  awaits the blob first and only then calls `write` with an already-resolved `Promise.resolve`
 *  satisfies the type and defeats the purpose — the activation is gone by the time `write` runs. */
export async function writeClipboardPng(pending: Promise<Blob>): Promise<boolean> {
  // Attach a handler immediately, so a rejection can never be reported as unhandled — regardless
  // of whether `write` below ever gets called, or ever reads this same promise itself.
  pending.catch(() => {});
  try {
    const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!Item || typeof navigator === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new Item({ "image/png": pending })]);
    return true;
  } catch {
    return false;
  }
}
