<script lang="ts">
  import type { ConfirmRequest } from "../state/appState.svelte";
  import Modal from "./Modal.svelte";

  let { request }: { request: ConfirmRequest } = $props();
</script>

<Modal title="Please confirm" onclose={() => request.resolve(false)}>
  <p class="text-xs text-muted">{request.text}</p>
  {#snippet actions()}
    <button class="btn" onclick={() => request.resolve(false)}>Cancel</button>
    <button class="btn btn-primary" onclick={() => request.resolve(true)}>
      {request.confirmLabel}
    </button>
  {/snippet}
</Modal>
