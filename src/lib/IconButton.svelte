<script lang="ts">
  import type { Scissors } from "@lucide/svelte";

  /** A top-bar action (spec M2e §2): icon only, named by aria-label, explained by title. A
   *  disabled button stays in place and says why (aria-disabled keeps its tooltip reachable). */
  let {
    label,
    title,
    icon: Icon,
    onclick,
    disabled = false,
    disabledTitle,
  }: {
    label: string;
    title: string;
    icon: typeof Scissors;
    onclick: () => void;
    disabled?: boolean;
    disabledTitle?: string;
  } = $props();
</script>

<button
  type="button"
  class="icon-btn"
  aria-label={label}
  aria-disabled={disabled}
  title={disabled && disabledTitle ? disabledTitle : title}
  onclick={() => {
    if (!disabled) onclick();
  }}
>
  <Icon size={18} />
</button>
