<script lang="ts">
  import {
    ArrowDown,
    ArrowUp,
    BringToFront,
    ClipboardPaste,
    Copy,
    CopyPlus,
    Maximize,
    Redo2,
    Scissors,
    SendToBack,
    SlidersHorizontal,
    Spline,
    Stamp,
    Trash2,
    Undo2,
    ZoomIn,
    ZoomOut,
  } from "@lucide/svelte";
  import {
    app,
    bringSelectionForward,
    bringSelectionToFront,
    convertSelectionToPath,
    copyToSystem,
    cutToSystem,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    pasteFromClipboard,
    sendSelectionBackward,
    sendSelectionToBack,
    type DialogKind,
  } from "../state/appState.svelte";
  import { runCommand } from "../state/commands";
  import type { Command } from "../state/keys";
  import { selectionActions } from "../state/properties";
  import IconButton from "./IconButton.svelte";

  let menuOpen = $state(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl+";
  const shiftMod = isMac ? "⇧⌘" : "Ctrl+Shift+";

  const none = $derived(app.selection.length === 0);
  const actions = $derived(selectionActions(app.doc, app.selection));

  function command(cmd: Command) {
    menuOpen = false;
    runCommand(cmd);
  }

  function dialog(kind: DialogKind) {
    menuOpen = false;
    app.dialog = kind;
  }
</script>

<!-- One bar, icons only (spec M2e §2). It never wraps or scrolls: a scrolling bar would clip the
     File menu (M2d §5), so only the file name shrinks. -->
<header class="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 text-xs">
  <div class="relative shrink-0">
    <button
      class={[
        "inline-flex h-8 shrink-0 items-center gap-1 rounded px-2 text-xs whitespace-nowrap hover:bg-raised",
        menuOpen && "ui-on",
      ]}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      File<span class="text-[10px] opacity-70">▾</span>
    </button>
    {#if menuOpen}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (menuOpen = false)}
      ></button>
      <div
        class="absolute top-full left-0 z-50 mt-1 w-56 rounded border border-line bg-panel py-1 shadow-lg"
        role="menu"
      >
        <button class="menu-item" role="menuitem" onclick={() => dialog("new")}>New…</button>
        <button class="menu-item" role="menuitem" onclick={() => command("open")}>
          Open… <span class="kbd">{mod}O</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => command("save")}>
          Save <span class="kbd">{mod}S</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => command("saveAs")}>
          Save As… <span class="kbd">{shiftMod}S</span>
        </button>
        <div class="my-1 h-px bg-line"></div>
        <button class="menu-item" role="menuitem" onclick={() => dialog("settings")}>
          Document settings…
        </button>
      </div>
    {/if}
  </div>

  <!-- Unsaved = recoloured name, never an inserted glyph (guide §5: state must not move layout). -->
  <span class={["ml-1 min-w-0 truncate", app.dirty && "text-accent"]} title={app.fileName}>
    {app.fileName}{#if app.dirty}<span class="sr-only">, unsaved changes</span>{/if}
  </span>

  <span class="bar-sep"></span>
  <IconButton
    label="Undo"
    title="Undo ({mod}Z)"
    icon={Undo2}
    disabled={!app.canUndo}
    disabledTitle="Undo — nothing to undo"
    onclick={() => command("undo")}
  />
  <IconButton
    label="Redo"
    title="Redo ({shiftMod}Z)"
    icon={Redo2}
    disabled={!app.canRedo}
    disabledTitle="Redo — nothing to redo"
    onclick={() => command("redo")}
  />

  <span class="bar-sep"></span>
  <IconButton
    label="Cut"
    title="Cut ({mod}X)"
    icon={Scissors}
    disabled={none}
    disabledTitle="Cut — nothing selected"
    onclick={cutToSystem}
  />
  <IconButton
    label="Copy"
    title="Copy ({mod}C)"
    icon={Copy}
    disabled={none}
    disabledTitle="Copy — nothing selected"
    onclick={copyToSystem}
  />
  <IconButton
    label="Paste"
    title="Paste ({mod}V)"
    icon={ClipboardPaste}
    onclick={() => void pasteFromClipboard()}
  />

  <span class="bar-sep"></span>
  <IconButton
    label="Duplicate"
    title="Duplicate ({mod}D)"
    icon={CopyPlus}
    disabled={none}
    disabledTitle="Duplicate — nothing selected"
    onclick={duplicateSelection}
  />
  <IconButton
    label="Delete"
    title="Delete (⌫)"
    icon={Trash2}
    disabled={none}
    disabledTitle="Delete — nothing selected"
    onclick={deleteSelection}
  />
  <span class="bar-sep"></span>
  <IconButton
    label="Bring to front"
    title="Bring to front ({shiftMod}])"
    icon={BringToFront}
    disabled={none}
    disabledTitle="Bring to front — nothing selected"
    onclick={bringSelectionToFront}
  />
  <IconButton
    label="Bring forward"
    title="Bring forward ({mod}])"
    icon={ArrowUp}
    disabled={none}
    disabledTitle="Bring forward — nothing selected"
    onclick={bringSelectionForward}
  />
  <IconButton
    label="Send backward"
    title="Send backward ({mod}[)"
    icon={ArrowDown}
    disabled={none}
    disabledTitle="Send backward — nothing selected"
    onclick={sendSelectionBackward}
  />
  <IconButton
    label="Send to back"
    title="Send to back ({shiftMod}[)"
    icon={SendToBack}
    disabled={none}
    disabledTitle="Send to back — nothing selected"
    onclick={sendSelectionToBack}
  />

  <span class="bar-sep"></span>
  <IconButton
    label="Convert to path"
    title="Convert to path"
    icon={Spline}
    disabled={!actions.canConvert}
    disabledTitle="Convert to path — select a rectangle, ellipse or polygon"
    onclick={convertSelectionToPath}
  />
  <IconButton
    label="Flatten transform"
    title="Flatten transform"
    icon={Stamp}
    disabled={!actions.canFlatten}
    disabledTitle="Flatten transform — select a moved or rotated path"
    onclick={flattenSelection}
  />

  <div class="ml-auto flex shrink-0 items-center gap-1">
    <IconButton
      label="Zoom out"
      title="Zoom out (-)"
      icon={ZoomOut}
      onclick={() => command("zoomOut")}
    />
    <button
      class="h-8 w-14 shrink-0 rounded text-center tabular-nums hover:bg-raised"
      title="Zoom to 100% ({mod}1)"
      onclick={() => command("zoom100")}
    >
      {Math.round(app.view.zoom * 100)}%
    </button>
    <IconButton
      label="Zoom in"
      title="Zoom in (=)"
      icon={ZoomIn}
      onclick={() => command("zoomIn")}
    />
    <IconButton
      label="Fit artboard"
      title="Fit artboard ({mod}0)"
      icon={Maximize}
      onclick={() => command("fit")}
    />
    <span class="bar-sep min-[900px]:hidden"></span>
    <button
      class={["icon-btn min-[900px]:hidden", app.propertiesOpen && "ui-on"]}
      aria-label="Properties"
      aria-pressed={app.propertiesOpen}
      title="Properties"
      onclick={() => (app.propertiesOpen = !app.propertiesOpen)}
    >
      <SlidersHorizontal size={18} />
    </button>
  </div>
</header>
