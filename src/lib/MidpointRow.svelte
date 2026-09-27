<script lang="ts">
  import type { Field } from "../state/properties";
  import NumberField from "./NumberField.svelte";

  let {
    label,
    mid,
    onmid,
    onlivestart,
    onliveend,
  }: {
    /** Accessible name prefix, e.g. "Fill". */
    label: string;
    mid: Field<number>;
    onmid: (mid: number) => void;
    /** Brackets a slider drag so the whole drag is one undo step (invariant 42). The caller owns
     *  the document gesture; this component never touches the store. */
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();

  const pct = $derived(mid.mixed ? null : Math.round(mid.value * 100));
  let live = $state(false);

  function startLive() {
    if (live) return;
    live = true;
    onlivestart?.();
  }

  /** Every way a drag can end: `change`, `blur` (no `change` fires when nothing moved) and
   *  destruction (clearing the selection removes this row mid-drag). */
  function endLive() {
    if (!live) return;
    live = false;
    onliveend?.();
  }

  $effect(() => () => endLive());
</script>

<!-- Spec M17 §5: where the two colours mix 50/50. The slider is the app's first range input:
     `touch-action: none` so iPadOS reads a drag on it as a drag, not a scroll (invariant 6), and
     `--ctl-h` high like every other control (invariant 23). -->
<div class="flex items-center gap-2" title="Midpoint — where the two colours mix 50/50">
  <span class="w-9 shrink-0 text-muted">Mid</span>
  <input
    type="range"
    min="1"
    max="99"
    step="1"
    class="min-w-0 flex-1 cursor-pointer"
    style="height: var(--ctl-h); touch-action: none"
    aria-label="{label} midpoint"
    value={pct ?? 50}
    oninput={(e) => {
      startLive();
      onmid(Number(e.currentTarget.value) / 100);
    }}
    onchange={endLive}
    onblur={endLive}
  />
  <!-- `NumberField`'s root is `display: contents`; this wrapper is the flex item it sizes
       against, as in PaintRow. -->
  <div class="w-16 shrink-0">
    <NumberField
      label=""
      value={pct}
      min={1}
      max={99}
      suffix="%"
      onchange={(v) => onmid(Math.round(v) / 100)}
    />
  </div>
</div>
