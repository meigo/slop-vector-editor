<script lang="ts">
  import type { Paint } from "../doc/document";
  import type { Field } from "../state/properties";
  import NumberField from "./NumberField.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  let {
    label,
    field,
    fallback,
    onchange,
  }: {
    label: string;
    field: Field<Paint | null>;
    fallback: Paint;
    onchange: (p: Paint | null) => void;
  } = $props();

  const paint = $derived(field.mixed ? null : field.value);
  let hexDraft = $state<string | null>(null);

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
      ariaLabel={label}
      value={field.mixed ? "mixed" : paint !== null}
      onchange={(on) => onchange(on ? (paint ?? fallback) : null)}
    />
  </div>
  {#if paint}
    <div class="flex items-center gap-2">
      <input
        type="color"
        class="h-8 w-10 cursor-pointer rounded border border-line bg-raised"
        value={paint.color}
        aria-label="{label} colour"
        onchange={(e) => setColor(e.currentTarget.value)}
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
