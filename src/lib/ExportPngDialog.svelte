<script lang="ts">
  import { app, exportPng } from "../state/appState.svelte";
  import { exportBox, exportRefusal, sizeLabel, type ExportRegion } from "../state/export-plan";
  import Modal from "./Modal.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  let region = $state<ExportRegion>("artboard");
  let scale = $state<number | null>(1);
  // Exporting the artboard is "give me this document", where the background belongs; exporting a
  // selection is "give me this object", where it almost never does (spec M12 §6). These are
  // defaults, not a standing rule: once the user has touched the toggle themselves, a region
  // change no longer overrides their choice.
  let transparent = $state(false);
  let transparentTouched = $state(false);
  let busy = $state(false);

  const hasSelection = $derived(app.selection.length > 0);
  const box = $derived(exportBox(app.doc, region, app.selection));
  const refusal = $derived(exportRefusal(box, scale ?? Number.NaN));
  const label = $derived(sizeLabel(box, scale ?? Number.NaN));

  function pickRegion(next: ExportRegion) {
    region = next;
    if (!transparentTouched) transparent = next === "selection";
  }

  function setTransparent(on: boolean) {
    transparent = on;
    transparentTouched = true;
  }

  function close() {
    app.dialog = null;
  }

  async function run() {
    if (refusal || scale === null || busy) return;
    busy = true;
    try {
      await exportPng(region, scale, transparent);
      close();
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Export PNG" onclose={close}>
  <div class="flex flex-col gap-1">
    <span class="section-title">Region</span>
    <select
      class="field"
      value={region}
      title="What the PNG covers"
      onchange={(e) => pickRegion(e.currentTarget.value as ExportRegion)}
    >
      <option value="artboard">Artboard</option>
      <option value="selection" disabled={!hasSelection}>
        {hasSelection ? "Selection" : "Selection — nothing selected"}
      </option>
    </select>
  </div>

  <div class="mt-3 flex flex-col gap-1">
    <span class="section-title">Size</span>
    <div class="flex items-center gap-3 text-xs">
      <label class="flex items-center gap-1">
        Scale
        <input class="field w-20" type="number" min="0.01" step="0.5" bind:value={scale} />
      </label>
      <span class="text-muted">×</span>
      <span class="text-muted">→ {label}</span>
    </div>
  </div>

  <div class="mt-3 flex flex-col gap-1">
    <span class="section-title">Background</span>
    <ToggleButton
      label="Transparent"
      ariaLabel="Transparent background"
      value={transparent}
      onchange={setTransparent}
    />
  </div>

  {#if refusal}
    <p class="mt-3 text-xs text-danger">{refusal}</p>
  {/if}

  {#snippet actions()}
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn btn-primary" disabled={refusal !== null || busy} onclick={run}>
      {busy ? "Exporting…" : "Export"}
    </button>
  {/snippet}
</Modal>
