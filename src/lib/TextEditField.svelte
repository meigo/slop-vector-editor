<script lang="ts">
  import { untrack } from "svelte";
  import { boxFromPoints, type Box } from "../geom/box";
  import { applyMat, multiply } from "../geom/mat";
  import { findNode } from "../doc/tree";
  import {
    app,
    editCaretStops,
    endTextEdit,
    registerTextBlur,
    registerTextFocus,
    setTextSelection,
    setView,
    typeTextEdit,
  } from "../state/appState.svelte";
  import { runCommand } from "../state/commands";
  import { commandForKey } from "../state/keys";
  import { docToScreen, revealPan } from "../state/viewport";
  import { toCodePoint, toUtf16, verticalMove } from "../text/edit";

  /** The hidden textarea that mirrors the title being edited on the canvas (spec M22 §1): its
   *  value is the title's text and its selection is the caret and the selection, so the browser
   *  supplies the keyboard, IME, autocorrect, word movement, clipboard and the field's own undo.
   *  Always mounted — a field that is not in the document cannot take the synchronous focus iOS
   *  needs to raise its keyboard — and never `display: none`, which cannot take focus either. */
  let {
    width,
    height,
    pressing,
  }: {
    /** The canvas size in px, to keep the field inside it. */
    width: number;
    height: number;
    /** True while a canvas press is running or has just ended (see `onblur`). */
    pressing: () => boolean;
  } = $props();

  let el: HTMLTextAreaElement;
  /** The session whose text the field holds; null outside one. */
  let mirroredId: string | null = null;
  /** True from the session's first `input`: the field is then the source of the text, and the
   *  document only trails it by an outline (or keeps an old text for a quietly refused keystroke,
   *  which must not snap back until the commit — invariant 41). */
  let typed = false;
  let composing = false;
  /** ↑/↓'s remembered x in the title's own space, kept across consecutive vertical moves. */
  let goalX: number | null = null;
  /** The focus index the last vertical move set: any other caret position means something else
   *  moved it (a click, a drag, the field's own keys), so the goal x no longer applies. */
  let goalAt: number | null = null;

  const MARGIN = 24;

  $effect(() => {
    registerTextFocus(() => el.focus({ preventScroll: true }));
    registerTextBlur(() => el.blur());
    return () => {
      registerTextFocus(null);
      registerTextBlur(null);
    };
  });

  /** The edited title's text and world matrix, or null. */
  const edited = $derived.by(() => {
    const e = app.textEdit;
    if (!e) return null;
    const found = findNode(app.doc, e.id);
    const n = found?.node;
    if (!found || !n || n.kind !== "path" || !n.text) return null;
    return { id: n.id, text: n.text.text, world: multiply(found.parent, n.transform) };
  });

  /** The caret's rectangle in canvas px (the focus stop through the title's world matrix and the
   *  view), or null while the stops are not loaded. */
  function caretRect(): Box | null {
    const e = app.textEdit;
    const t = edited;
    const stops = editCaretStops();
    if (!e || !t || !stops) return null;
    // The document trails the field during a burst, so the stops can be one keystroke short.
    const s = stops[Math.min(e.focus, stops.length - 1)];
    const a = docToScreen(app.view, applyMat(t.world, { x: s.x, y: s.top }));
    const b = docToScreen(app.view, applyMat(t.world, { x: s.x, y: s.bottom }));
    return boxFromPoints([a, b]);
  }

  /** Where the field sits: at the caret, kept inside the canvas, so the browser never has a
   *  reason to scroll anything to reach it — not the page, and not the overflow-hidden host,
   *  which a focused field's typing can still scroll. */
  const at = $derived.by(() => {
    const r = caretRect();
    const x = r ? r.x : 0;
    const y = r ? r.y : 0;
    return {
      x: Math.min(Math.max(x, 0), Math.max(width - 1, 0)),
      y: Math.min(Math.max(y, 0), Math.max(height - 16, 0)),
    };
  });

  // The value: set when a session starts, and from the document only until the field becomes the
  // source. Never while an IME composition is running.
  $effect(() => {
    const t = edited;
    untrack(() => {
      if (!t) {
        mirroredId = null;
        typed = false;
        return;
      }
      if (composing) return;
      if (t.id !== mirroredId) {
        mirroredId = t.id;
        typed = false;
        goalX = null;
      } else if (typed) {
        return;
      }
      if (el.value !== t.text) el.value = t.text;
    });
  });

  // The selection: the store's anchor/focus into the field, when they differ from the field's.
  $effect(() => {
    const e = app.textEdit;
    void edited;
    untrack(() => {
      if (!e || composing || mirroredId !== e.id) return;
      const text = el.value;
      const cur = fieldSelection();
      if (cur && cur.anchor === e.anchor && cur.focus === e.focus) return;
      const lo = Math.min(e.anchor, e.focus);
      const hi = Math.max(e.anchor, e.focus);
      el.setSelectionRange(
        toUtf16(text, lo),
        toUtf16(text, hi),
        e.focus < e.anchor ? "backward" : "forward",
      );
    });
  });

  // Auto-pan (spec M22 §6): after entering and after each selection change — and as the caret
  // stops arrive or change with the text — the view pans by the least that shows the caret above
  // the on-screen keyboard. The view itself is read untracked: panning away by hand while editing
  // must not be undone until the caret next moves.
  $effect(() => {
    void app.textEdit;
    void editCaretStops();
    untrack(reveal);
  });

  // The keyboard raises after the focus, which is when the first reveal ran.
  $effect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (app.textEdit) reveal();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  });

  function reveal(): void {
    const r = caretRect();
    if (!r) return;
    // The canvas host, which the field is mounted in.
    const h = (el.parentElement ?? el).getBoundingClientRect();
    const vv = window.visualViewport;
    // The canvas intersected with the visual viewport, in canvas px.
    const left = Math.max(h.left, vv ? vv.offsetLeft : h.left);
    const top = Math.max(h.top, vv ? vv.offsetTop : h.top);
    const right = Math.min(h.right, vv ? vv.offsetLeft + vv.width : h.right);
    const bottom = Math.min(h.bottom, vv ? vv.offsetTop + vv.height : h.bottom);
    if (right <= left || bottom <= top) return;
    const visible = { x: left - h.left, y: top - h.top, w: right - left, h: bottom - top };
    const next = revealPan(app.view, r, visible, MARGIN);
    if (next !== app.view) setView(next);
  }

  /** The field's selection in code points, anchor first, or null when it does not hold the
   *  session's text. */
  function fieldSelection(): { anchor: number; focus: number } | null {
    const e = app.textEdit;
    if (!e || mirroredId !== e.id) return null;
    const text = el.value;
    const start = toCodePoint(text, el.selectionStart);
    const end = toCodePoint(text, el.selectionEnd);
    return el.selectionDirection === "backward"
      ? { anchor: end, focus: start }
      : { anchor: start, focus: end };
  }

  function readSelection(): void {
    if (document.activeElement !== el) return;
    const s = fieldSelection();
    if (s) setTextSelection(s.anchor, s.focus);
  }

  function oninput() {
    if (!app.textEdit || mirroredId !== app.textEdit.id) return;
    typed = true;
    // The caret after the edit tells a doubled letter's twins apart (review M5).
    typeTextEdit(el.value, toCodePoint(el.value, el.selectionStart));
    readSelection();
  }

  function onkeydown(e: KeyboardEvent) {
    const vertical =
      (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!vertical) {
      if (!["Shift", "Meta", "Control", "Alt"].includes(e.key)) goalX = null;
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        void endTextEdit();
        el.blur();
      }
      // ⌘S / ⌘⇧S (Ctrl on other systems) are the app's Save and Save As, not the browser's Save
      // Page: the window's shortcut handler skips a focused field, and this one is focused for the
      // whole session. The same command path as the window's (`commandForKey` → `runCommand`).
      const cmd = commandForKey(e);
      if ((cmd === "save" || cmd === "saveAs") && !e.isComposing) {
        e.preventDefault();
        runCommand(cmd);
      }
      // ⌘A and everything else: the field's own.
      return;
    }
    const edit = app.textEdit;
    const stops = editCaretStops();
    if (e.isComposing || !edit || !stops) return;
    // The stops trail the field during a burst; past their end, the field's own ↑/↓ is better
    // than a caret on the wrong character.
    if (edit.focus >= stops.length) return;
    e.preventDefault();
    if (edit.focus !== goalAt) goalX = null;
    goalX ??= stops[edit.focus].x;
    const i = verticalMove(stops, edit.focus, e.key === "ArrowUp" ? -1 : 1, goalX);
    goalAt = i;
    setTextSelection(e.shiftKey ? edit.anchor : i, i);
  }

  function onblur(e: FocusEvent) {
    // A store-driven leave clears `textEdit` before it blurs the field: nothing to end twice.
    if (app.textEdit === null) return;
    // A press on the (non-focusable) canvas moves focus to nothing. Where the canvas's mousedown
    // cannot cancel that — a cancelled pointerdown suppresses the mousedown — take it back: the
    // press itself decides, through the tool, whether the session goes on.
    if (e.relatedTarget === null && pressing()) {
      el.focus({ preventScroll: true });
      return;
    }
    void endTextEdit();
  }

  $effect(() => {
    const onSelectionChange = () => readSelection();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  });
</script>

<textarea
  bind:this={el}
  class="text-edit-field"
  style="left: {at.x}px; top: {at.y}px"
  aria-label="Title text on canvas"
  spellcheck="false"
  tabindex="-1"
  {oninput}
  {onkeydown}
  onkeyup={readSelection}
  onselect={readSelection}
  {onblur}
  oncompositionstart={() => (composing = true)}
  oncompositionend={() => {
    composing = false;
    readSelection();
  }}></textarea>

<style>
  .text-edit-field {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    /* 16px: iOS zooms the whole page on focusing a field with a smaller font. */
    font-size: 16px;
    width: 1px;
    height: 1em;
    padding: 0;
    border: 0;
    resize: none;
    overflow: hidden;
    white-space: pre;
  }
</style>
