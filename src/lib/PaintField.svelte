<script lang="ts">
  import type { Paint } from "../doc/document";
  import type { Field } from "../state/properties";
  import NumberField from "./NumberField.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  let {
    label,
    field,
    present,
    fallback,
    onchange,
    onlivestart,
    onliveend,
  }: {
    label: string;
    field: Field<Paint | null>;
    present: Field<boolean>;
    fallback: Paint;
    onchange: (p: Paint | null) => void;
    /** Brackets a live drag of the swatch so the whole drag is one undo step. The caller owns the
     *  document gesture; this component stays presentational and never touches the store. */
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();

  const paint = $derived(field.mixed ? null : field.value);
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
    onchange({ color: hex, opacity: paint?.opacity ?? fallback.opacity });
  }
</script>

<div class="flex flex-col gap-1">
  <div class="flex items-center justify-between">
    <span class="section-title">{label}</span>
    <ToggleButton
      label="On"
      ariaLabel={`${label} on`}
      value={present.mixed ? "mixed" : present.value}
      onchange={(on) => onchange(on ? (paint ?? fallback) : null)}
    />
  </div>
  {#if paint}
    <div class="flex items-center gap-2">
      <!-- A square control of the shared height (`--ctl-h`), not a fixed `size-8`: it has to track
           the 32/24px control size like every other control. `aspect-square` plus `shrink-0` is
           what keeps it square — it was `h-8 w-10`, and a flex item shrinks below its width, so in
           the 240px sidebar the row squeezed it to a tall ~17px sliver at full height. -->
      <input
        type="color"
        class="aspect-square shrink-0 cursor-pointer rounded border border-line bg-raised"
        style="height: var(--ctl-h)"
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
      <input
        class="field w-20 font-mono tabular-nums"
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
      <NumberField
        label=""
        value={Math.round(paint.opacity * 100)}
        min={0}
        max={100}
        suffix="%"
        onchange={(v) => onchange({ ...paint, opacity: v / 100 })}
      />
    </div>
  {/if}
</div>
