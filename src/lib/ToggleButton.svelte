<script lang="ts">
  import { nextToggle, toggleView, type ToggleValue } from "./toggle";

  let {
    value,
    label,
    ariaLabel,
    onchange,
    disabled = false,
    title,
  }: {
    value: ToggleValue;
    label: string;
    ariaLabel?: string;
    onchange: (next: boolean) => void;
    /** aria-disabled, never `disabled` (invariant 24): the button stays reachable so its reason
     *  `title` still works as a status-bar hint, and a press stays a no-op. */
    disabled?: boolean;
    title?: string;
  } = $props();

  const view = $derived(toggleView(value));
</script>

<button
  type="button"
  class={["btn", view.on && "ui-on", view.mixed && "ui-mixed"]}
  aria-pressed={view.pressed}
  aria-label={ariaLabel}
  aria-disabled={disabled}
  {title}
  onclick={() => {
    if (!disabled) onchange(nextToggle(value));
  }}
>
  {label}
</button>
