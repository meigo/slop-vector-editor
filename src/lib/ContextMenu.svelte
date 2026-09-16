<script lang="ts">
  import {
    app,
    convertSelectionToPath,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
  } from "../state/appState.svelte";

  function close() {
    app.contextMenu = null;
  }

  function run(action: () => void) {
    close();
    action();
  }
</script>

<svelte:window
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
    style="left: {app.contextMenu.x}px; top: {app.contextMenu.y}px"
    role="menu"
  >
    <button class="menu-item" role="menuitem" onclick={() => run(duplicateSelection)}>
      Duplicate <span class="kbd">⌘D</span>
    </button>
    <button class="menu-item" role="menuitem" onclick={() => run(convertSelectionToPath)}>
      Convert to path
    </button>
    <button class="menu-item" role="menuitem" onclick={() => run(flattenSelection)}>
      Flatten transform
    </button>
    <div class="my-1 h-px bg-line"></div>
    <button class="menu-item" role="menuitem" onclick={() => run(deleteSelection)}>
      Delete <span class="kbd">⌫</span>
    </button>
  </div>
{/if}
