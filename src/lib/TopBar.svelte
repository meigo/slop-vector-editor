<script lang="ts">
  import { Maximize, Menu, Redo2, Undo2, ZoomIn, ZoomOut } from "@lucide/svelte";
  import { app, type DialogKind } from "../state/appState.svelte";
  import { runCommand } from "../state/commands";
  import type { Command } from "../state/keys";

  let menuOpen = $state(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl+";

  function command(cmd: Command) {
    menuOpen = false;
    runCommand(cmd);
  }

  function dialog(kind: DialogKind) {
    menuOpen = false;
    app.dialog = kind;
  }
</script>

<header class="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 text-xs">
  <div class="relative">
    <button
      class="icon-btn"
      aria-label="File menu"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <Menu size={18} />
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
          Save As… <span class="kbd">⇧{mod}S</span>
        </button>
        <div class="my-1 h-px bg-line"></div>
        <button class="menu-item" role="menuitem" onclick={() => dialog("settings")}>
          Document settings…
        </button>
      </div>
    {/if}
  </div>

  <span class="ml-1 min-w-0 truncate" title={app.fileName}>
    {app.fileName}{#if app.dirty}<span class="text-warn" aria-label="unsaved changes"> ●</span>{/if}
  </span>

  <div class="ml-auto flex items-center gap-1">
    <button
      class="icon-btn"
      aria-label="Undo"
      title="Undo ({mod}Z)"
      disabled={!app.canUndo}
      onclick={() => command("undo")}
    >
      <Undo2 size={18} />
    </button>
    <button
      class="icon-btn"
      aria-label="Redo"
      title="Redo (⇧{mod}Z)"
      disabled={!app.canRedo}
      onclick={() => command("redo")}
    >
      <Redo2 size={18} />
    </button>
    <span class="mx-1 h-5 w-px bg-line"></span>
    <button
      class="icon-btn"
      aria-label="Zoom out"
      title="Zoom out (-)"
      onclick={() => command("zoomOut")}
    >
      <ZoomOut size={18} />
    </button>
    <button
      class="h-8 w-14 rounded text-center tabular-nums hover:bg-raised"
      title="Zoom to 100% ({mod}1)"
      onclick={() => command("zoom100")}
    >
      {Math.round(app.view.zoom * 100)}%
    </button>
    <button
      class="icon-btn"
      aria-label="Zoom in"
      title="Zoom in (+)"
      onclick={() => command("zoomIn")}
    >
      <ZoomIn size={18} />
    </button>
    <button
      class="icon-btn"
      aria-label="Fit artboard"
      title="Fit artboard ({mod}0)"
      onclick={() => command("fit")}
    >
      <Maximize size={18} />
    </button>
  </div>
</header>
