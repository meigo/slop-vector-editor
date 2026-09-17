<script lang="ts">
  import { nextToggle, toggleView, type ToggleValue } from "./toggle";

  let {
    value,
    label,
    ariaLabel,
    onchange,
  }: {
    value: ToggleValue;
    label: string;
    ariaLabel?: string;
    onchange: (next: boolean) => void;
  } = $props();

  const view = $derived(toggleView(value));
</script>

<button
  type="button"
  class={["btn", view.on && "ui-on", view.mixed && "ui-mixed"]}
  aria-pressed={view.pressed}
  aria-label={ariaLabel}
  onclick={() => onchange(nextToggle(value))}
>
  {label}
</button>
