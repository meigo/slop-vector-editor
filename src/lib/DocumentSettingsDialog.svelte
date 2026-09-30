<script lang="ts">
  import { isValidArtboardSize, MAX_ARTBOARD } from "../doc/document";
  import { app, applyArtboard, renameDocument } from "../state/appState.svelte";
  import { baseName } from "../state/doc-name";
  import Modal from "./Modal.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  // The dialog edits a copy; nothing changes until Apply (one undo step).
  const initial = app.doc.artboard;
  let name = $state(baseName(app.fileName));
  let w = $state<number | null>(initial.w);
  let h = $state<number | null>(initial.h);
  let hasBackground = $state(initial.background !== null);
  let color = $state(initial.background?.color ?? "#ffffff");
  const valid = $derived(isValidArtboardSize(w) && isValidArtboardSize(h));

  function close() {
    app.dialog = null;
  }

  function apply() {
    if (!isValidArtboardSize(w) || !isValidArtboardSize(h)) return;
    const background = hasBackground ? { color, opacity: initial.background?.opacity ?? 1 } : null;
    renameDocument(name);
    applyArtboard({ w, h, background });
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
  <div class="flex flex-col gap-1">
    <span class="section-title">Size</span>
    <div class="flex items-center gap-3 text-xs">
      <label class="flex items-center gap-1">
        W <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={w} />
      </label>
      <label class="flex items-center gap-1">
        H <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={h} />
      </label>
      <span class="text-muted">px</span>
    </div>
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
    <button class="btn btn-primary" disabled={!valid} onclick={apply}>Apply</button>
  {/snippet}
</Modal>
