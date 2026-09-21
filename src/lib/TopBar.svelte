<script lang="ts">
  import {
    BringToFront,
    ClipboardPaste,
    Copy,
    CopyPlus,
    Group,
    LayersArrowDown,
    LayersArrowUp,
    Maximize,
    Redo2,
    Scissors,
    SendToBack,
    SlidersHorizontal,
    SquaresExclude,
    SquaresIntersect,
    SquaresSubtract,
    SquaresUnite,
    Stamp,
    Trash2,
    Undo2,
    Ungroup,
    Waypoints,
    ZoomIn,
    ZoomOut,
  } from "@lucide/svelte";
  import {
    app,
    booleanSelection,
    breakApartSelection,
    bringSelectionForward,
    bringSelectionToFront,
    combineSelection,
    convertSelectionToPath,
    copyPng,
    copyToSystem,
    cutToSystem,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    groupSelection,
    deselectAll,
    invertSelection,
    pasteFromClipboard,
    reverseSelectionDirection,
    selectAll,
    selectSame,
    sendSelectionBackward,
    sendSelectionToBack,
    simplifySelection,
    subdivideSelectionNodes,
    type DialogKind,
    ungroupSelection,
  } from "../state/appState.svelte";
  import { runCommand } from "../state/commands";
  import type { Command } from "../state/keys";
  import { allIds } from "../doc/select-match";
  import { BOOL_LABEL, BOOL_OPS, BOOL_REASON, BOOL_TITLE, type BoolOp } from "../geom/boolean";
  import { PATH_LABEL, PATH_OPS, PATH_TITLE, type PathOp } from "../doc/path-ops";
  import { selectionActions } from "../state/properties";
  import IconButton from "./IconButton.svelte";

  let menuOpen = $state(false);
  let selectOpen = $state(false);
  let pathOpen = $state(false);
  let objectOpen = $state(false);
  let editOpen = $state(false);
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
  /** One list for the Object menu and the four bar icons, so the two can never drift apart. */
  const ARRANGE = $derived([
    {
      label: "Bring to front",
      keys: `${shiftMod}]`,
      icon: BringToFront,
      run: bringSelectionToFront,
    },
    { label: "Bring forward", keys: `${mod}]`, icon: LayersArrowUp, run: bringSelectionForward },
    { label: "Send backward", keys: `${mod}[`, icon: LayersArrowDown, run: sendSelectionBackward },
    { label: "Send to back", keys: `${shiftMod}[`, icon: SendToBack, run: sendSelectionToBack },
  ]);

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
  /** The Object menu is the arrange commands' home away from the bar (spec M10e §8). They had
   *  none: outside the four icons they existed only in the right-click menu and on ⌘]/⌘[, and
   *  `route.ts` opens the right-click menu for **mouse input only** — so on an iPad the icons were
   *  the single route, which is exactly what invariant 24 requires before a control may be hidden
   *  at a width. With this menu they may be. */
  function runObject(fn: () => void) {
    objectOpen = false;
    fn();
  }

  /** Undo and Redo are here because an Edit menu without them is a surprise, not because their
   *  icons are ever hidden — those two stay in the bar at every width. */
  function runEdit(fn: () => void) {
    editOpen = false;
    fn();
  }

  function runPath(op: BoolOp) {
    pathOpen = false;
    void booleanSelection(op);
  }

  const PATH_RUN: Readonly<Record<PathOp, () => void>> = {
    subdivide: subdivideSelectionNodes,
    reverse: reverseSelectionDirection,
    breakApart: breakApartSelection,
    combine: combineSelection,
    simplify: () => void simplifySelection(),
  };

  function runPathOp(op: PathOp) {
    pathOpen = false;
    PATH_RUN[op]();
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
        objectOpen = false;
        editOpen = false;
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
        <button class="menu-item" role="menuitem" onclick={() => dialog("export")}>
          Export PNG…
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
        editOpen && "ui-on",
      ]}
      aria-haspopup="menu"
      aria-expanded={editOpen}
      onclick={() => {
        menuOpen = false;
        selectOpen = false;
        pathOpen = false;
        objectOpen = false;
        editOpen = !editOpen;
      }}
    >
      Edit<span class="text-[10px] opacity-70">▾</span>
    </button>
    {#if editOpen}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (editOpen = false)}
      ></button>
      <div
        class="absolute top-full left-0 z-50 mt-1 w-56 rounded border border-line bg-panel py-1 shadow-lg"
        role="menu"
      >
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!app.canUndo}
          title={app.canUndo ? `Undo (${mod}Z)` : "Undo — nothing to undo"}
          onclick={() => app.canUndo && runEdit(() => command("undo"))}
        >
          Undo <span class="kbd">{mod}Z</span>
        </button>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!app.canRedo}
          title={app.canRedo ? `Redo (${shiftMod}Z)` : "Redo — nothing to redo"}
          onclick={() => app.canRedo && runEdit(() => command("redo"))}
        >
          Redo <span class="kbd">{shiftMod}Z</span>
        </button>
        <div class="my-1 h-px bg-line"></div>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={none}
          title={none ? "Cut — nothing selected" : `Cut (${mod}X)`}
          onclick={() => !none && runEdit(cutToSystem)}
        >
          Cut <span class="kbd">{mod}X</span>
        </button>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={none}
          title={none ? "Copy — nothing selected" : `Copy (${mod}C)`}
          onclick={() => !none && runEdit(copyToSystem)}
        >
          Copy <span class="kbd">{mod}C</span>
        </button>
        <button
          class="menu-item"
          role="menuitem"
          title="Paste ({mod}V)"
          onclick={() => runEdit(() => void pasteFromClipboard())}
        >
          Paste <span class="kbd">{mod}V</span>
        </button>
        <button
          class="menu-item"
          role="menuitem"
          title="Copy the artboard to the clipboard as a PNG"
          onclick={() => {
            editOpen = false;
            void copyPng();
          }}
        >
          Copy as PNG
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
        objectOpen = false;
        editOpen = false;
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
        objectOpen = false;
        editOpen = false;
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
        <div class="my-1 h-px bg-line"></div>
        {#each PATH_OPS as op (op)}
          <button
            class="menu-item"
            role="menuitem"
            aria-disabled={actions.pathReason[op] !== null}
            title={actions.pathReason[op] === null
              ? PATH_TITLE[op]
              : `${PATH_LABEL[op]} — ${actions.pathReason[op]}`}
            onclick={() => actions.pathReason[op] === null && runPathOp(op)}
          >
            {PATH_LABEL[op]}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="relative">
    <button
      class={[
        "inline-flex h-8 shrink-0 items-center gap-1 rounded px-1 text-sm whitespace-nowrap hover:bg-raised min-[900px]:px-2",
        objectOpen && "ui-on",
      ]}
      aria-haspopup="menu"
      aria-expanded={objectOpen}
      onclick={() => {
        menuOpen = false;
        selectOpen = false;
        pathOpen = false;
        editOpen = false;
        objectOpen = !objectOpen;
      }}
    >
      Object<span class="text-[10px] opacity-70">▾</span>
    </button>
    {#if objectOpen}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (objectOpen = false)}
      ></button>
      <div
        class="absolute top-full left-0 z-50 mt-1 w-56 rounded border border-line bg-panel py-1 shadow-lg"
        role="menu"
      >
        {#each ARRANGE as a (a.label)}
          <button
            class="menu-item"
            role="menuitem"
            aria-disabled={!anySelected}
            title={anySelected ? `${a.label} (${a.keys})` : `${a.label} — nothing selected`}
            onclick={() => anySelected && runObject(a.run)}
          >
            {a.label} <span class="kbd">{a.keys}</span>
          </button>
        {/each}
        <div class="my-1 h-px bg-line"></div>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!actions.canConvert}
          title={actions.canConvert
            ? "Convert to path"
            : "Convert to path — select a rectangle, ellipse or polygon"}
          onclick={() => actions.canConvert && runObject(convertSelectionToPath)}
        >
          Convert to path
        </button>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!actions.canFlatten}
          title={actions.canFlatten
            ? "Flatten transform"
            : "Flatten transform — select a moved or rotated path"}
          onclick={() => actions.canFlatten && runObject(flattenSelection)}
        >
          Flatten transform
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

  <!-- Hidden below the breakpoint; the Edit menu carries these at every width (invariant 24).
       Undo and Redo deliberately stay: they are the most-used controls in the bar. -->
  <span class="hidden min-[870px]:contents">
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
  </span>
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
    icon={Ungroup}
    disabled={!actions.canUngroup}
    disabledTitle="Ungroup — select a group"
    onclick={ungroupSelection}
  />
  <!-- Measured, not guessed (spec M10e §8): with the booleans shown and arrange hidden the bar
       needs 1102px, so they appear at 1110. The bar must never wrap or scroll (M2e), and the Path
       menu carries these commands at every width (spec M7 §6). -->
  <span class="hidden min-[1110px]:contents">
    <span class="bar-sep"></span>
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
  <!-- Arrange, from the same list the Object menu renders. Hidden below the breakpoint like the
       boolean operations, which is only legal because the Object menu now carries these commands
       at every width (invariant 24) — before it existed, the right-click menu was mouse-only and
       these icons were the one route on a touch device. With everything shown the bar needs
       1259px, so arrange appears at 1270. -->
  <span class="hidden min-[1270px]:contents">
    <span class="bar-sep"></span>
    {#each ARRANGE as a (a.label)}
      <IconButton
        label={a.label}
        title="{a.label} ({a.keys})"
        icon={a.icon}
        disabled={none}
        disabledTitle="{a.label} — nothing selected"
        onclick={a.run}
      />
    {/each}
  </span>
  <!-- Hidden below the breakpoint; the Object menu carries both at every width. -->
  <span class="hidden min-[950px]:contents">
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
  </span>

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
