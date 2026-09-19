<script lang="ts">
  import { findNode } from "../doc/tree";
  import {
    app,
    bringSelectionForward,
    bringSelectionToFront,
    closeTargetSubpath,
    convertSelectionToPath,
    copyToSystem,
    cutToSystem,
    deleteSelectedNodes,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    groupSelection,
    invertSelection,
    pasteFromClipboard,
    selectAll,
    selectSame,
    sendSelectionBackward,
    sendSelectionToBack,
    setSelectedNodeType,
    ungroupSelection,
  } from "../state/appState.svelte";
  import { selectionActions } from "../state/properties";

  const MARGIN = 4;
  let innerWidth = $state(0);
  let innerHeight = $state(0);
  // Estimated size until the first measurement.
  let width = $state(208);
  let height = $state(150);
  const actions = $derived(selectionActions(app.doc, app.selection));
  const canClosePath = $derived.by(() => {
    if (app.toolId !== "node" || app.nodeSel.length === 0) return false;
    const found = app.nodeTarget === null ? null : findNode(app.doc, app.nodeTarget);
    const path = found && found.node.kind === "path" ? found.node : null;
    const sub = path?.subpaths[app.nodeSel[0].sub];
    return sub ? !sub.closed : false;
  });
  const left = $derived(
    app.contextMenu
      ? Math.max(MARGIN, Math.min(app.contextMenu.x, innerWidth - width - MARGIN))
      : 0,
  );
  const top = $derived(
    app.contextMenu
      ? Math.max(MARGIN, Math.min(app.contextMenu.y, innerHeight - height - MARGIN))
      : 0,
  );

  function close() {
    app.contextMenu = null;
  }

  function run(action: () => void) {
    close();
    action();
  }
</script>

<svelte:window
  bind:innerWidth
  bind:innerHeight
  onkeydown={(e) => {
    if (e.key === "Escape" && app.contextMenu) close();
  }}
/>

{#if app.contextMenu}
  <button
    class="fixed inset-0 z-40 cursor-default"
    aria-label="Close menu"
    tabindex="-1"
    onclick={close}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></button>
  <div
    class="fixed z-50 w-52 rounded border border-line bg-panel py-1 shadow-lg"
    style="left: {left}px; top: {top}px"
    role="menu"
    bind:clientWidth={width}
    bind:clientHeight={height}
  >
    {#if app.selection.length > 0}
      <button class="menu-item" role="menuitem" onclick={() => run(cutToSystem)}>
        Cut <span class="kbd">⌘X</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(copyToSystem)}>
        Copy <span class="kbd">⌘C</span>
      </button>
    {/if}
    <button class="menu-item" role="menuitem" onclick={() => run(() => void pasteFromClipboard())}>
      Paste <span class="kbd">⌘V</span>
    </button>
    {#if app.toolId === "node" && app.nodeSel.length > 0}
      <div class="my-1 h-px bg-line"></div>
      <button class="menu-item" role="menuitem" onclick={() => run(deleteSelectedNodes)}>
        Delete node{app.nodeSel.length > 1 ? "s" : ""} <span class="kbd">⌫</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => run(() => setSelectedNodeType("corner"))}
      >
        Corner
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => run(() => setSelectedNodeType("smooth"))}
      >
        Smooth
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => run(() => setSelectedNodeType("symmetric"))}
      >
        Symmetric
      </button>
      {#if canClosePath}
        <button
          class="menu-item"
          role="menuitem"
          onclick={() => run(() => closeTargetSubpath(app.nodeSel[0].sub))}
        >
          Close path
        </button>
      {/if}
    {/if}
    {#if app.selection.length > 0}
      <div class="my-1 h-px bg-line"></div>
      <button class="menu-item" role="menuitem" onclick={() => run(duplicateSelection)}>
        Duplicate <span class="kbd">⌘D</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(groupSelection)}>
        Group <span class="kbd">⌘G</span>
      </button>
      {#if actions.canUngroup}
        <button class="menu-item" role="menuitem" onclick={() => run(ungroupSelection)}>
          Ungroup <span class="kbd">⇧⌘G</span>
        </button>
      {/if}
      {#if actions.canConvert}
        <button class="menu-item" role="menuitem" onclick={() => run(convertSelectionToPath)}>
          Convert to path
        </button>
      {/if}
      {#if actions.canFlatten}
        <button class="menu-item" role="menuitem" onclick={() => run(flattenSelection)}>
          Flatten transform
        </button>
      {/if}
      <div class="my-1 h-px bg-line"></div>
      <button class="menu-item" role="menuitem" onclick={() => run(bringSelectionToFront)}>
        Bring to front <span class="kbd">⇧⌘]</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(bringSelectionForward)}>
        Bring forward <span class="kbd">⌘]</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(sendSelectionBackward)}>
        Send backward <span class="kbd">⌘[</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(sendSelectionToBack)}>
        Send to back <span class="kbd">⇧⌘[</span>
      </button>
      <div class="my-1 h-px bg-line"></div>
      <button class="menu-item" role="menuitem" onclick={() => run(deleteSelection)}>
        Delete <span class="kbd">⌫</span>
      </button>
    {/if}
    <div class="my-1 h-px bg-line"></div>
    <button class="menu-item" role="menuitem" onclick={() => run(selectAll)}>
      Select All <span class="kbd">⌘A</span>
    </button>
    <button class="menu-item" role="menuitem" onclick={() => run(invertSelection)}>
      Invert Selection <span class="kbd">⇧⌘A</span>
    </button>
    {#if actions.canSelectSameStyle}
      <button class="menu-item" role="menuitem" onclick={() => run(() => selectSame("fill"))}>
        Same Fill Colour
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(() => selectSame("stroke"))}>
        Same Stroke Colour
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(() => selectSame("style"))}>
        Same Style
      </button>
    {/if}
    {#if actions.canSelectSameKind}
      <button class="menu-item" role="menuitem" onclick={() => run(() => selectSame("kind"))}>
        Same Kind
      </button>
    {/if}
  </div>
{/if}
