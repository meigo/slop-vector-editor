<script lang="ts">
  import type { Paint } from "../doc/document";
  import NumberField from "./NumberField.svelte";

  let {
    label,
    paint,
    selected = false,
    onchange,
    onlivestart,
    onliveend,
  }: {
    /** Accessible name prefix, e.g. "Fill" or "Fill start". */
    label: string;
    paint: Paint;
    /** The stop picked on the canvas (spec M15 §7). */
    selected?: boolean;
    onchange: (p: Paint) => void;
    /** Brackets a live drag of the swatch so the whole drag is one undo step. The caller owns the
     *  document gesture; this component stays presentational and never touches the store. */
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();

  let hexDraft = $state<string | null>(null);
  /** True between the first `input` of a picker drag and the `change`/`blur` that ends it. */
  let live = $state(false);

  function startLive() {
    if (live) return;
    live = true;
    onlivestart?.();
  }

  /** Must run on every way the drag can end, including ones that fire no `change`: dismissing the
   *  picker without altering the colour fires only `blur`, and clearing the selection destroys this
   *  component outright. A gesture left open would silently stop recording undo history. */
  function endLive() {
    if (!live) return;
    live = false;
    onliveend?.();
  }

  $effect(() => () => endLive());

  function setColor(raw: string) {
    const hex = (raw.startsWith("#") ? raw : `#${raw}`).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    onchange({ color: hex, opacity: paint.opacity });
  }
</script>

<div class={["flex min-w-0 flex-1 items-center gap-2 rounded", selected && "ui-selected"]}>
  <!-- A square control of the shared height (`--ctl-h`), not a fixed `size-8`: it has to track
       the 32/24px control size like every other control. It was `h-8 w-10`, and a flex item
       shrinks below its width, so in the 240px sidebar the row squeezed it to a tall ~17px sliver
       at full height. `aspect-square` (width from height) replaced that, but `input[type=color]`
       does not reliably honour `aspect-ratio` in Chrome — the swatch rendered ~50px wide instead
       of square once this row had to share space with a stop label (spec M15 §7, found in the
       browser check after Task 6). Setting `width` alongside `height` is what actually pins it
       square; `shrink-0` still keeps flex-shrink from touching either one when the row is tight. -->
  <input
    type="color"
    class="shrink-0 cursor-pointer rounded border border-line bg-raised"
    style="width: var(--ctl-h); height: var(--ctl-h)"
    value={paint.color}
    aria-label="{label} colour"
    oninput={(e) => {
      startLive();
      setColor(e.currentTarget.value);
    }}
    onchange={(e) => {
      setColor(e.currentTarget.value);
      endLive();
    }}
    onblur={endLive}
  />
  <!-- Fixed, not shrinkable: a hex value must always be fully readable. `w-18` (72px) is sized to
       the text, not the old `w-20` — 7 mono characters at ~7.2px plus the field's border and
       padding need ~68px, and 72px leaves a little breathing room. The opacity field below is the
       one that gives way. -->
  <input
    class="field w-18 shrink-0 font-mono tabular-nums"
    aria-label="{label} hex"
    value={hexDraft ?? paint.color}
    oninput={(e) => (hexDraft = e.currentTarget.value)}
    onkeydown={(e) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        hexDraft = null;
        e.currentTarget.blur();
      }
    }}
    onblur={() => {
      if (hexDraft !== null) setColor(hexDraft);
      hexDraft = null;
    }}
  />
  <!-- `NumberField`'s own root is `display: contents` (it's meant for `.field-grid`), so it has no
       box of its own to put `flex-1`/`min-w-0` on. Wrapping it gives it one: this div is the flex
       item that takes whatever the swatch and hex leave behind and shrinks first when the row is
       tight, and it is also what `width: 100%` on the field inside now measures against — without
       it, that 100% read against the whole row, which is why the opacity field previously grabbed
       most of the space instead of giving it up. -->
  <div class="min-w-0 flex-1">
    <NumberField
      label=""
      value={Math.round(paint.opacity * 100)}
      min={0}
      max={100}
      suffix="%"
      onchange={(v) => onchange({ ...paint, opacity: v / 100 })}
    />
  </div>
</div>
