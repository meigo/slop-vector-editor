<script lang="ts">
  import { Link, Unlink } from "@lucide/svelte";
  import {
    linkedSize,
    scaledSide,
    scaleRefusal,
    sizeRefusal,
    type Anchor,
  } from "../doc/doc-resize";
  import { MAX_ARTBOARD } from "../doc/document";
  import { app, applyDocumentSize, renameDocument, type DocSize } from "../state/appState.svelte";
  import { baseName } from "../state/doc-name";
  import AnchorGrid from "./AnchorGrid.svelte";
  import Modal from "./Modal.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  // The dialog edits a copy; nothing changes until Apply (one undo step).
  const initial = app.doc.artboard;
  let name = $state(baseName(app.fileName));
  let w = $state<number | null>(initial.w);
  let h = $state<number | null>(initial.h);
  let hasBackground = $state(initial.background !== null);
  let color = $state(initial.background?.color ?? "#ffffff");
  // Spec M23 §2: each open starts in Crop/extend, centre anchor, ratio unlinked.
  let mode = $state<"extend" | "scale">("extend");
  let linked = $state(false);
  let ax = $state<Anchor>(0.5);
  let ay = $state<Anchor>(0.5);
  /** Scale drawing's factor comes from the side typed last. */
  let typed = $state<"w" | "h">("w");
  const k = $derived(typed === "w" ? Number(w) / initial.w : Number(h) / initial.h);
  const refusal = $derived(mode === "scale" ? scaleRefusal(app.doc, k) : sizeRefusal(w, h));

  function typedW() {
    typed = "w";
    if (typeof w !== "number" || !Number.isFinite(w)) return;
    if (mode === "scale") h = scaledSide(w, initial.w, initial.h);
    else if (linked) h = linkedSize(w, initial.w, initial.h);
  }
  function typedH() {
    typed = "h";
    if (typeof h !== "number" || !Number.isFinite(h)) return;
    if (mode === "scale") w = scaledSide(h, initial.h, initial.w);
    else if (linked) w = linkedSize(h, initial.h, initial.w);
  }
  function setMode(next: "extend" | "scale") {
    mode = next;
    if (next === "scale") typedW();
  }
  function toggleLink() {
    if (mode === "scale") return;
    linked = !linked;
    if (linked) typedW();
  }

  function close() {
    app.dialog = null;
  }

  function apply() {
    if (refusal !== null) return;
    const background = hasBackground ? { color, opacity: initial.background?.opacity ?? 1 } : null;
    const size: DocSize =
      mode === "scale" ? { mode, k } : { mode, w: Number(w), h: Number(h), ax, ay };
    renameDocument(name);
    applyDocumentSize(size, background);
    close();
  }
</script>

<Modal title="Document settings" onclose={close}>
  <label class="mb-3 flex flex-col gap-1">
    <span class="section-title">Name</span>
    <span class="flex items-center gap-1 text-xs">
      <input
        class="field min-w-0 flex-1"
        type="text"
        bind:value={name}
        spellcheck="false"
        autocomplete="off"
        title="Document name — used for the saved and exported file names"
      />
      <span class="text-muted">.svg</span>
    </span>
  </label>
  <div class="flex flex-col gap-2">
    <span class="section-title">Size</span>
    <div class="flex gap-1 text-xs">
      <button
        type="button"
        class={["btn flex-1", mode === "extend" && "ui-on"]}
        aria-pressed={mode === "extend"}
        title="Crop/extend — change the page around the drawing; the drawing keeps its size"
        onclick={() => setMode("extend")}>Crop/extend</button
      >
      <button
        type="button"
        class={["btn flex-1", mode === "scale" && "ui-on"]}
        aria-pressed={mode === "scale"}
        title="Scale drawing — everything scales with the page, strokes included"
        onclick={() => setMode("scale")}>Scale drawing</button
      >
    </div>
    <div class="flex items-center gap-2 text-xs">
      <label class="flex items-center gap-1">
        W <input
          class="field w-24"
          type="number"
          min="0"
          max={MAX_ARTBOARD}
          bind:value={w}
          oninput={typedW}
        />
      </label>
      <button
        type="button"
        class={["btn size-(--ctl-h) justify-center p-0", (linked || mode === "scale") && "ui-on"]}
        aria-label="Keep ratio"
        aria-pressed={linked || mode === "scale"}
        aria-disabled={mode === "scale"}
        title={mode === "scale"
          ? "Scale drawing always keeps the ratio"
          : linked
            ? "Keep ratio — typing one side sets the other"
            : "Keep ratio — off; W and H change independently"}
        onclick={toggleLink}
      >
        {#if linked || mode === "scale"}<Link size={16} />{:else}<Unlink size={16} />{/if}
      </button>
      <label class="flex items-center gap-1">
        H <input
          class="field w-24"
          type="number"
          min="0"
          max={MAX_ARTBOARD}
          bind:value={h}
          oninput={typedH}
        />
      </label>
      <span class="text-muted">px</span>
    </div>
    {#if mode === "extend"}
      <AnchorGrid {ax} {ay} onchange={(x, y) => ((ax = x), (ay = y))} />
    {/if}
    {#if refusal}<span class="text-xs text-muted" role="status">{refusal}</span>{/if}
  </div>
  <div class="mt-3 flex flex-col gap-1">
    <span class="section-title">Background</span>
    <div class="flex items-center gap-3 text-xs">
      <ToggleButton
        label="On"
        ariaLabel="Background on"
        value={hasBackground}
        onchange={(on) => (hasBackground = on)}
      />
      <input
        class="h-8 w-12 cursor-pointer rounded border border-line bg-raised disabled:opacity-40"
        type="color"
        disabled={!hasBackground}
        bind:value={color}
        aria-label="Background color"
      />
      {#if !hasBackground}<span class="text-muted">transparent</span>{/if}
    </div>
  </div>
  {#snippet actions()}
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn btn-primary" disabled={refusal !== null} onclick={apply}>Apply</button>
  {/snippet}
</Modal>
