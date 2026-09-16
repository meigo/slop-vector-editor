<script lang="ts">
  import type { Vec } from "./geom/vec";
  import Canvas from "./lib/Canvas.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import DocumentSettingsDialog from "./lib/DocumentSettingsDialog.svelte";
  import NewDocumentDialog from "./lib/NewDocumentDialog.svelte";
  import Notices from "./lib/Notices.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import { app } from "./state/appState.svelte";
  import { runCommand } from "./state/commands";
  import { commandForKey } from "./state/keys";

  let cursor = $state<Vec | null>(null);

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
