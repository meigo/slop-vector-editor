<script lang="ts">
  import {
    ArrowDown,
    ArrowUp,
    BringToFront,
    ClipboardPaste,
    Copy,
    CopyPlus,
    Group,
    Maximize,
    Redo2,
    Scissors,
    SendToBack,
    SlidersHorizontal,
    Split,
    SquaresExclude,
    SquaresIntersect,
    SquaresSubtract,
    SquaresUnite,
    Stamp,
    Trash2,
    Undo2,
    Waypoints,
    ZoomIn,
    ZoomOut,
  } from "@lucide/svelte";
  import {
    app,
    booleanSelection,
    bringSelectionForward,
    bringSelectionToFront,
    convertSelectionToPath,
    copyToSystem,
    cutToSystem,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    groupSelection,
    deselectAll,
    invertSelection,
    pasteFromClipboard,
    selectAll,
    selectSame,
    sendSelectionBackward,
    sendSelectionToBack,
    type DialogKind,
    ungroupSelection,
  } from "../state/appState.svelte";
  import { runCommand } from "../state/commands";
  import type { Command } from "../state/keys";
  import { allIds } from "../doc/select-match";
  import { BOOL_LABEL, BOOL_OPS, BOOL_REASON, BOOL_TITLE, type BoolOp } from "../geom/boolean";
  import { selectionActions } from "../state/properties";
  import IconButton from "./IconButton.svelte";

  let menuOpen = $state(false);
  let selectOpen = $state(false);
  let pathOpen = $state(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl+";
  const shiftMod = isMac ? "⇧⌘" : "Ctrl+Shift+";

  const none = $derived(app.selection.length === 0);
  const actions = $derived(selectionActions(app.doc, app.selection));
  const anySelected = $derived(app.selection.length > 0);

  /** Spec (M6) §6: with every layer hidden or locked there is nothing to select, and Select All
   *  says so rather than doing nothing silently. */
  const anyInReach = $derived(allIds(app.doc, app.enteredGroupId).length > 0);
  const sameStyleReason = $derived(
    app.selection.length === 0 ? "— nothing selected" : "— a group has no fill",
  );
  const boolReason = $derived(
    actions.booleanRefusal === null ? null : BOOL_REASON[actions.booleanRefusal],
  );

  /** Lucide ships these four as a matched family, drawn to be read together — two overlapping
   *  squares with the result of each operation filled in. The set they replaced was assembled one
   *  by one from unrelated icons (`Combine`, `SquareMinus`, `Blend`, `SquareSlash`), so the four
   *  operations did not look like four variants of one thing. */
  const BOOL_ICON = {
    unite: SquaresUnite,
    subtract: SquaresSubtract,
    intersect: SquaresIntersect,
    exclude: SquaresExclude,
  };

  function command(cmd: Command) {
    menuOpen = false;
    runCommand(cmd);
  }

  function dialog(kind: DialogKind) {
    menuOpen = false;
    app.dialog = kind;
  }

  /** Close the menu, then act — the same order the File menu uses. */
  function runSelect(action: () => void) {
    selectOpen = false;
    action();
  }

  /** Close the menu, then act — the same order the File menu uses. */
  function runPath(op: BoolOp) {
    pathOpen = false;
    void booleanSelection(op);
  }
</script>

<!-- One bar, icons only (spec M2e §2). It never wraps or scrolls: a scrolling bar would clip the
     File menu (M2d §5), so only the file name shrinks. -->
<!-- Tighter gutters and gaps below 900px, where the bar has 25 gaps and no room to spare: at a
     correct 16px root it needs 776px of fixed width, and an iPad portrait window is 768. This buys
     back ~58px without hiding a control, which matters because the context menu — the only other
     route to most of these — is mouse-only. -->
<header
  class="flex h-11 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-1 min-[900px]:gap-1 min-[900px]:px-2"
>
  <div class="relative shrink-0">
    <button
      class={[
        "inline-flex h-8 shrink-0 items-center gap-1 rounded px-1 text-sm whitespace-nowrap hover:bg-raised min-[900px]:px-2",
        menuOpen && "ui-on",
      ]}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={() => {
        selectOpen = false;
        pathOpen = false;
        menuOpen = !menuOpen;
      }}
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

  <div class="relative shrink-0">
    <button
      class={[
        "inline-flex h-8 shrink-0 items-center gap-1 rounded px-1 text-sm whitespace-nowrap hover:bg-raised min-[900px]:px-2",
        selectOpen && "ui-on",
      ]}
      aria-haspopup="menu"
      aria-expanded={selectOpen}
      onclick={() => {
        menuOpen = false;
        pathOpen = false;
        selectOpen = !selectOpen;
      }}
    >
      Select<span class="text-[10px] opacity-70">▾</span>
    </button>
    {#if selectOpen}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (selectOpen = false)}
      ></button>
      <div
        class="absolute top-full left-0 z-50 mt-1 w-56 rounded border border-line bg-panel py-1 shadow-lg"
        role="menu"
      >
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!anyInReach}
          title={anyInReach ? `Select every object (${mod}A)` : "Select All — nothing to select"}
          onclick={() => anyInReach && runSelect(selectAll)}
        >
          Select All <span class="kbd">{mod}A</span>
        </button>
        <button
          class="menu-item"
          role="menuitem"
          title="Select what is not selected now ({shiftMod}A)"
          onclick={() => runSelect(invertSelection)}
        >
          Invert Selection <span class="kbd">{shiftMod}A</span>
        </button>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!anySelected}
          title={anySelected ? "Clear the selection (Esc)" : "Deselect — nothing selected"}
          onclick={() => anySelected && runSelect(deselectAll)}
        >
          Deselect <span class="kbd">Esc</span>
        </button>
        <div class="my-1 h-px bg-line"></div>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!actions.canSelectSameStyle}
          title={actions.canSelectSameStyle
            ? "Select every shape with this fill"
            : `Same Fill Colour ${sameStyleReason}`}
          onclick={() => actions.canSelectSameStyle && runSelect(() => selectSame("fill"))}
        >
          Same Fill Colour
        </button>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!actions.canSelectSameStyle}
          title={actions.canSelectSameStyle
            ? "Select every shape with this stroke"
            : `Same Stroke Colour ${sameStyleReason}`}
          onclick={() => actions.canSelectSameStyle && runSelect(() => selectSame("stroke"))}
        >
          Same Stroke Colour
        </button>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!actions.canSelectSameStyle}
          title={actions.canSelectSameStyle
            ? "Select every shape with this style"
            : `Same Style ${sameStyleReason}`}
          onclick={() => actions.canSelectSameStyle && runSelect(() => selectSame("style"))}
        >
          Same Style
        </button>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!actions.canSelectSameKind}
          title={actions.canSelectSameKind
            ? "Select every shape of this kind"
            : "Same Kind — nothing selected"}
          onclick={() => actions.canSelectSameKind && runSelect(() => selectSame("kind"))}
        >
          Same Kind
        </button>
      </div>
    {/if}
  </div>

  <div class="relative shrink-0">
    <button
      class={[
        "inline-flex h-8 shrink-0 items-center gap-1 rounded px-1 text-sm whitespace-nowrap hover:bg-raised min-[900px]:px-2",
        pathOpen && "ui-on",
      ]}
      aria-haspopup="menu"
      aria-expanded={pathOpen}
      onclick={() => {
        menuOpen = false;
        selectOpen = false;
        pathOpen = !pathOpen;
      }}
    >
      Path<span class="text-[10px] opacity-70">▾</span>
    </button>
    {#if pathOpen}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (pathOpen = false)}
      ></button>
      <div
        class="absolute top-full left-0 z-50 mt-1 w-56 rounded border border-line bg-panel py-1 shadow-lg"
        role="menu"
      >
        {#each BOOL_OPS as op (op)}
          <button
            class="menu-item"
            role="menuitem"
            aria-disabled={boolReason !== null}
            title={boolReason === null ? BOOL_TITLE[op] : `${BOOL_LABEL[op]} — ${boolReason}`}
            onclick={() => boolReason === null && runPath(op)}
          >
            {BOOL_LABEL[op]}
          </button>
        {/each}
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
  <IconButton
    label="Group"
    title="Group ({mod}G)"
    icon={Group}
    disabled={!actions.canGroup}
    disabledTitle="Group — nothing selected"
    onclick={groupSelection}
  />
  <IconButton
    label="Ungroup"
    title="Ungroup ({shiftMod}G)"
    icon={Split}
    disabled={!actions.canUngroup}
    disabledTitle="Ungroup — select a group"
    onclick={ungroupSelection}
  />
  <!-- The bar already carries 18 icons and three menus; four more do not fit at iPad-portrait
       widths, and it must never wrap or scroll (M2e). They appear where there is room, and the
       Path menu carries them at every width (spec M7 §6). -->
  <span class="hidden min-[900px]:contents">
    {#each BOOL_OPS as op (op)}
      <IconButton
        label={BOOL_LABEL[op]}
        title={BOOL_TITLE[op]}
        icon={BOOL_ICON[op]}
        disabled={boolReason !== null}
        disabledTitle="{BOOL_LABEL[op]} — {boolReason}"
        onclick={() => void booleanSelection(op)}
      />
    {/each}
  </span>
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
    icon={Waypoints}
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
