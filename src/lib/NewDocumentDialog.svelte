<script lang="ts">
  import { isValidArtboardSize, MAX_ARTBOARD } from "../doc/document";
  import { createNewDocument } from "../persist/project-io";
  import { app } from "../state/appState.svelte";
  import Modal from "./Modal.svelte";

  const PRESETS = [
    { label: "1920 × 1080", w: 1920, h: 1080 },
    { label: "1080 × 1080", w: 1080, h: 1080 },
    { label: "A4 (96 dpi)", w: 794, h: 1123 },
    { label: "800 × 600", w: 800, h: 600 },
    { label: "512 × 512", w: 512, h: 512 },
  ];

  let w = $state<number | null>(1920);
  let h = $state<number | null>(1080);
  const valid = $derived(isValidArtboardSize(w) && isValidArtboardSize(h));

  function close() {
    app.dialog = null;
  }

  function create() {
    if (!isValidArtboardSize(w) || !isValidArtboardSize(h)) return;
    close();
    createNewDocument(w, h);
  }
</script>

<Modal title="New document" onclose={close}>
  <div class="flex flex-wrap gap-1">
    {#each PRESETS as p (p.label)}
      <button
        class={["btn", p.w === w && p.h === h && "ui-on"]}
        aria-pressed={p.w === w && p.h === h}
        onclick={() => {
          w = p.w;
          h = p.h;
        }}>{p.label}</button
      >
    {/each}
  </div>
  <div class="mt-3 flex items-center gap-3 text-xs">
    <label class="flex items-center gap-1">
      W <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={w} />
    </label>
    <label class="flex items-center gap-1">
      H <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={h} />
    </label>
    <span class="text-muted">px</span>
  </div>
  {#if app.dirty}
    <p class="mt-3 text-xs text-warn">
      The current document has unsaved changes. They will be lost.
    </p>
  {/if}
  {#snippet actions()}
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn btn-primary" disabled={!valid} onclick={create}>Create</button>
  {/snippet}
</Modal>
