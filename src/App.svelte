<script lang="ts">
  import { onMount } from "svelte";
  import type { Vec } from "./geom/vec";
  import Canvas from "./lib/Canvas.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import DocumentSettingsDialog from "./lib/DocumentSettingsDialog.svelte";
  import ExportPngDialog from "./lib/ExportPngDialog.svelte";
  import ModifierDock from "./lib/ModifierDock.svelte";
  import NewDocumentDialog from "./lib/NewDocumentDialog.svelte";
  import Notices from "./lib/Notices.svelte";
  import ShareReadyDialog from "./lib/ShareReadyDialog.svelte";
  import Sidebar from "./lib/Sidebar.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import ToolStrip from "./lib/ToolStrip.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import { hintFrom } from "./lib/hover-hint";
  import { flushAutosave, scheduleAutosave } from "./persist/autosave";
  import { errorMessage } from "./persist/errors";
  import { autosaveRecord, restoreAutosave } from "./persist/project-io";
  import { watchOtherTabs } from "./persist/tab-presence";
  import { app, copySelection, cutSelection, notify, pasteText } from "./state/appState.svelte";
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

  /** Input types that aren't text entry — a focused checkbox etc. must not block clipboard
   *  keyboard shortcuts from acting on the shape selection. Used only by `clipboardIgnored`. */
  const NON_TEXT_INPUT_TYPES = new Set([
    "checkbox",
    "radio",
    "color",
    "range",
    "button",
    "submit",
    "reset",
    "file",
  ]);

  function isTextField(t: EventTarget | null): boolean {
    return (
      t instanceof HTMLElement &&
      (t.isContentEditable ||
        (t.tagName === "INPUT" && !NON_TEXT_INPUT_TYPES.has((t as HTMLInputElement).type)) ||
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
    // Only a consumed action is cancelled: Enter with no tool to finish must still activate the
    // focused button, which is a default action of keydown.
    if (action && runEditAction(action)) e.preventDefault();
  }

  function onkeyup(e: KeyboardEvent) {
    if (e.key === " ") app.spaceHeld = false;
  }

  function onpointerover(e: PointerEvent) {
    app.hoverHint = hintFrom(e.target as Element | null, e.pointerType);
  }

  /** Only a mouse leaving the window clears the hint. A direct pointer (touch, and pen on iPad)
   *  gets a `pointerout` with a null `relatedTarget` the instant it lifts — the pointer has ceased
   *  to exist — so clearing on that would erase the press hint a moment after it was set. A touch
   *  or pen hint therefore stands until the next press replaces it (spec M5 §5, invariant 24),
   *  including after a hovering Pencil is lifted off the glass. */
  function onpointerout(e: PointerEvent) {
    if (e.pointerType === "mouse" && !e.relatedTarget) app.hoverHint = null;
  }

  /** A device with no hover gets its hints from a press instead (spec M5 §5). A mouse clears the
   *  hint on press as before — hover will set it again. */
  function onpointerdown(e: PointerEvent) {
    app.hoverHint =
      e.pointerType === "mouse" ? null : hintFrom(e.target as Element | null, e.pointerType);
  }

  /** Text fields and dialogs keep the browser's own clipboard behaviour. */
  function clipboardIgnored(e: Event): boolean {
    return app.dialog !== null || app.confirm !== null || isTextField(e.target);
  }

  function writeClipboard(e: ClipboardEvent, action: () => string | null) {
    if (clipboardIgnored(e) || !e.clipboardData || app.selection.length === 0) return;
    const text = action();
    if (text === null) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
    e.clipboardData.setData("image/svg+xml", text);
  }

  function onpaste(e: ClipboardEvent) {
    if (clipboardIgnored(e) || !e.clipboardData) return;
    const text = e.clipboardData.getData("image/svg+xml") || e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    pasteText(text);
  }

  // WebKit (Safari, iPad) only enables Edit ▸ Copy/Cut/Paste — and so only fires
  // copy/cut/paste for ⌘C/⌘X/⌘V — when there's a text selection, an editable focus, or a
  // beforecopy/beforecut/beforepaste handler that calls preventDefault(). Harmless elsewhere.
  // Not in lib.dom.d.ts, so <svelte:window> can't type these; register by hand.
  $effect(() => {
    const onBeforeCopyOrCut = (e: Event) => {
      if (!clipboardIgnored(e) && app.selection.length > 0) e.preventDefault();
    };
    const onBeforePaste = (e: Event) => {
      if (!clipboardIgnored(e)) e.preventDefault();
    };
    window.addEventListener("beforecopy", onBeforeCopyOrCut);
    window.addEventListener("beforecut", onBeforeCopyOrCut);
    window.addEventListener("beforepaste", onBeforePaste);
    return () => {
      window.removeEventListener("beforecopy", onBeforeCopyOrCut);
      window.removeEventListener("beforecut", onBeforeCopyOrCut);
      window.removeEventListener("beforepaste", onBeforePaste);
    };
  });
</script>

<svelte:window
  {onkeydown}
  {onkeyup}
  onblur={() => (app.spaceHeld = false)}
  oncopy={(e) => writeClipboard(e, copySelection)}
  oncut={(e) => writeClipboard(e, cutSelection)}
  {onpaste}
  {onpointerover}
  {onpointerout}
  {onpointerdown}
/>

<div class="flex h-full flex-col">
  <TopBar />
  <div class="flex min-h-0 flex-1">
    <ToolStrip />
    <main class="relative min-w-0 flex-1">
      <Canvas oncursor={(p) => (cursor = p)} />
      <ModifierDock />
      {#if app.propertiesOpen}
        <div class="absolute inset-y-0 right-0 z-20 flex shadow-xl min-[900px]:hidden">
          <Sidebar />
        </div>
      {/if}
    </main>
    <div class="hidden min-[900px]:flex">
      <Sidebar />
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
{:else if app.dialog === "export"}
  <ExportPngDialog />
{/if}

{#if app.confirm}
  <ConfirmDialog request={app.confirm} />
{/if}

{#if app.shareReady}
  <ShareReadyDialog request={app.shareReady} />
{/if}
