<script lang="ts">
  import { onMount } from "svelte";
  import type { Vec } from "./geom/vec";
  import Canvas from "./lib/Canvas.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import ContextBar from "./lib/ContextBar.svelte";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import DocumentSettingsDialog from "./lib/DocumentSettingsDialog.svelte";
  import ModifierDock from "./lib/ModifierDock.svelte";
  import NewDocumentDialog from "./lib/NewDocumentDialog.svelte";
  import Notices from "./lib/Notices.svelte";
  import PropertiesPanel from "./lib/PropertiesPanel.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import ToolStrip from "./lib/ToolStrip.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import { flushAutosave, scheduleAutosave } from "./persist/autosave";
  import { autosaveRecord, errorMessage, restoreAutosave } from "./persist/project-io";
  import { watchOtherTabs } from "./persist/tab-presence";
  import { app, notify } from "./state/appState.svelte";
  import { runCommand, runEditAction } from "./state/commands";
  import { commandForKey, editActionForKey } from "./state/keys";

  let cursor = $state<Vec | null>(null);

  // Autosave starts only after the restore attempt, so the empty startup document never
  // overwrites the saved one. It stays off entirely when storage is unavailable, so we don't
  // schedule a write that would just fail a few seconds later.
  let autosaveEnabled = $state(false);

  onMount(() => {
    void restoreAutosave().then((ok) => (autosaveEnabled = ok));
    return watchOtherTabs(() =>
      notify(
        "error",
        "This editor is also open in another tab. Both tabs share one autosave — keep editing in one tab only.",
      ),
    );
  });

  $effect(() => {
    if (!autosaveEnabled) return;
    void app.session; // any edit, undo, save or document replace
    void app.fileName;
    scheduleAutosave(autosaveRecord, (err) =>
      notify("error", `Autosave failed: ${errorMessage(err)}`),
    );
  });

  // A pending 3 s debounce would otherwise be lost if the tab is closed or backgrounded (e.g.
  // switching apps on iPad) before it fires.
  $effect(() => {
    if (!autosaveEnabled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushAutosave);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushAutosave);
    };
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
    // Modals and menus own the keyboard (they handle Escape themselves).
    if (app.dialog || app.confirm || app.contextMenu || isEditable(e.target)) return;
    if (e.key === " ") {
      e.preventDefault();
      app.spaceHeld = true;
      return;
    }
    const cmd = commandForKey(e);
    if (cmd) {
      e.preventDefault();
      runCommand(cmd);
      return;
    }
    const action = editActionForKey(e);
    if (action) {
      e.preventDefault();
      runEditAction(action);
    }
  }

  function onkeyup(e: KeyboardEvent) {
    if (e.key === " ") app.spaceHeld = false;
  }
</script>

<svelte:window {onkeydown} {onkeyup} onblur={() => (app.spaceHeld = false)} />

<div class="flex h-full flex-col">
  <TopBar />
  <ContextBar />
  <div class="flex min-h-0 flex-1">
    <ToolStrip />
    <main class="relative min-w-0 flex-1">
      <Canvas oncursor={(p) => (cursor = p)} />
      <ModifierDock />
      {#if app.propertiesOpen}
        <div class="absolute inset-y-0 right-0 z-20 flex shadow-xl min-[900px]:hidden">
          <PropertiesPanel />
        </div>
      {/if}
    </main>
    <div class="hidden min-[900px]:flex">
      <PropertiesPanel />
    </div>
  </div>
  <StatusBar {cursor} />
</div>

<ContextMenu />

<Notices />

{#if app.dialog === "new"}
  <NewDocumentDialog />
{:else if app.dialog === "settings"}
  <DocumentSettingsDialog />
{/if}

{#if app.confirm}
  <ConfirmDialog request={app.confirm} />
{/if}
