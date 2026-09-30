<script lang="ts">
  import { SCRUB_THRESHOLD_PX, scrubbedValue } from "./scrub";

  let {
    label,
    value,
    min = -Infinity,
    max = Infinity,
    suffix = "",
    step = 1,
    pxPerStep = 4,
    onchange,
    onlivestart,
    onliveend,
  }: {
    label: string;
    value: number | null;
    min?: number;
    max?: number;
    suffix?: string;
    /** The grid a drag snaps to (2026-09-28). Typed values are kept as typed. */
    step?: number;
    /** Horizontal travel worth one step; Shift makes it four times finer. */
    pxPerStep?: number;
    onchange: (v: number) => void;
    /** Brackets a drag so the whole drag is ONE undo step (invariant 42); `onchange` fires on every
     *  step change in between, so the artwork follows the pointer live. The caller owns the
     *  document gesture; this component never touches the store. */
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let initial = "";
  /** The value shown while dragging — the field owns its text then, as it does while typing. */
  let dragging = $state<number | null>(null);
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const shown = $derived(
    dragging !== null ? fmt(dragging) : editing ? draft : value === null ? "" : fmt(value),
  );

  /** The typed value, clamped; null when nothing new (or nothing numeric) was typed. */
  function typedValue(): number | null {
    if (draft === initial) return null;
    const v = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(v)) return null;
    return Math.min(max, Math.max(min, v));
  }

  function commit() {
    editing = false;
    const v = typedValue();
    if (v !== null) onchange(v);
  }

  let input: HTMLInputElement | undefined;
  // Non-reactive on purpose: nothing renders from it.
  let scrub: {
    id: number;
    startX: number;
    startValue: number;
    moved: boolean;
    last: number;
  } | null = null;

  function onpointerdown(e: PointerEvent) {
    // A mixed value ("–") has no single number to drag from; typing still works.
    if (value === null || e.button !== 0 || scrub) return;
    scrub = { id: e.pointerId, startX: e.clientX, startValue: value, moved: false, last: value };
    // No preventDefault: a press that never travels still focuses the field for typing.
    window.addEventListener("pointermove", onpointermove);
    window.addEventListener("pointerup", end);
    // A browser-taken pan (touch-action: pan-y) or palm rejection cancels the stream; that must END
    // the drag, not leave it armed (invariant 6).
    window.addEventListener("pointercancel", end);
  }

  function onpointermove(e: PointerEvent) {
    if (!scrub || e.pointerId !== scrub.id) return;
    const dx = e.clientX - scrub.startX;
    if (!scrub.moved) {
      if (Math.abs(dx) < SCRUB_THRESHOLD_PX) return;
      scrub.moved = true;
      // A value typed but not yet committed is committed first, and the drag starts from it
      // (review L19): the blur below skips the commit while dragging, which threw the typing away.
      if (editing) {
        const typed = typedValue();
        editing = false;
        if (typed !== null) {
          onchange(typed);
          scrub.startValue = typed;
          scrub.last = typed;
        }
      }
      dragging = scrub.startValue;
      input?.blur(); // a caret blinking in a field being dragged is a lie; `dragging` skips commit
      onlivestart?.();
    }
    const next = scrubbedValue({
      startValue: scrub.startValue,
      dx,
      step,
      pxPerStep,
      fine: e.shiftKey,
      min,
      max,
    });
    dragging = next;
    if (next !== scrub.last) {
      scrub.last = next;
      onchange(next);
    }
  }

  function end(e?: PointerEvent) {
    if (!scrub || (e && e.pointerId !== scrub.id)) return;
    window.removeEventListener("pointermove", onpointermove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    const moved = scrub.moved;
    scrub = null;
    dragging = null;
    if (!moved) return; // a tap: the field is focused for typing, nothing written
    onliveend?.();
    swallowNextClick();
  }

  // Clearing the selection removes the field mid-drag; the bracket must still close (invariant 42).
  $effect(() => () => end());

  /** A drag released over a dialog backdrop makes the browser fire a `click` there, which would
   *  close the dialog (slop-animator's finding). Swallow exactly that one click, in the capture
   *  phase, bounded by the first click seen and by a timeout. */
  function swallowNextClick() {
    const timer = setTimeout(() => window.removeEventListener("click", swallow, true), 400);
    function swallow(e: MouseEvent) {
      e.stopPropagation();
      e.preventDefault();
      clearTimeout(timer);
      window.removeEventListener("click", swallow, true);
    }
    window.addEventListener("click", swallow, true);
  }
</script>

<!-- Two grid cells, not a flex box: the label and the field each belong to a column shared with
     every other row in the panel (see `.field-grid`). The unit sits INSIDE the field rather than in
     a third column — a column would end every numeric row short of the panel's right edge while a
     full-width control (a button, a select, the align row) ran to it, and the two right edges read
     as a step. `pointer-events-none` so a click on the unit still lands in the input, and the
     input's right padding is what keeps the digits off it. -->
<label class="field-row text-xs whitespace-nowrap">
  <span class="text-muted">{label}</span>
  <span class="relative block w-full min-w-0">
    <!-- Drag sideways to change (2026-09-28); `touch-pan-y` leaves a vertical finger-scroll of the
         panel to the browser, which then cancels the pointer stream and so ends any drag. -->
    <input
      bind:this={input}
      class={[
        "field w-full min-w-0 touch-pan-y tabular-nums",
        value !== null && "cursor-ew-resize",
        suffix && "pr-6",
      ]}
      type="text"
      inputmode="decimal"
      value={shown}
      placeholder={value === null ? "–" : ""}
      onfocus={(e) => {
        draft = e.currentTarget.value;
        initial = draft;
        editing = true;
      }}
      oninput={(e) => (draft = e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          editing = false;
          e.currentTarget.blur();
        }
      }}
      title={value === null
        ? `${label || "Value"} — mixed; type a value`
        : `${label || "Value"} — drag sideways or type`}
      {onpointerdown}
      onblur={() => {
        // The blur the drag itself fires must not commit: the drag has already written live.
        if (dragging !== null) editing = false;
        else if (editing) commit();
      }}
    />
    {#if suffix}
      <span
        class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted"
        aria-hidden="true">{suffix}</span
      >
    {/if}
  </span>
</label>
