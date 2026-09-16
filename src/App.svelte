<script lang="ts">
  import { onMount } from "svelte";
  import type { Vec } from "./geom/vec";
  import Canvas from "./lib/Canvas.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import DocumentSettingsDialog from "./lib/DocumentSettingsDialog.svelte";
  import NewDocumentDialog from "./lib/NewDocumentDialog.svelte";
  import Notices from "./lib/Notices.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import { scheduleAutosave } from "./persist/autosave";
  import { autosaveRecord, restoreAutosave } from "./persist/project-io";
  import { app, notify } from "./state/appState.svelte";
  import { runCommand } from "./state/commands";
  import { commandForKey } from "./state/keys";

  let cursor = $state<Vec | null>(null);

  // Autosave starts only after the restore attempt, so the empty startup document never
  // overwrites the saved one.
  let restored = $state(false);

  onMount(() => {
    void restoreAutosave().finally(() => (restored = true));
  });

  $effect(() => {
    if (!restored) return;
    void app.session; // any edit, undo, save or document replace
    void app.fileName;
    scheduleAutosave(autosaveRecord, (err) =>
      notify("error", `Autosave failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  });

  function isEditable(t: EventTarget | null): boolean {
    return (
      t instanceof HTMLElement &&
      (t.isContentEditable ||
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT")
    );
  }

  function onkeydown(e: KeyboardEvent) {
    // Modals own the keyboard (Modal.svelte handles Escape).
    if (app.dialog || app.confirm || isEditable(e.target)) return;
    const cmd = commandForKey(e);
    if (!cmd) return;
    e.preventDefault();
    runCommand(cmd);
  }
</script>

<svelte:window {onkeydown} />

<div class="flex h-full flex-col">
  <TopBar />
  <main class="min-h-0 flex-1">
    <Canvas oncursor={(p) => (cursor = p)} />
  </main>
  <StatusBar {cursor} />
</div>

<Notices />

{#if app.dialog === "new"}
  <NewDocumentDialog />
{:else if app.dialog === "settings"}
  <DocumentSettingsDialog />
{/if}

{#if app.confirm}
  <ConfirmDialog request={app.confirm} />
{/if}
