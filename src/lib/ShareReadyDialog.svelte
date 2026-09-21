<script lang="ts">
  import {
    shareReadyCancel,
    shareReadyDownload,
    shareReadyRetry,
    type ShareReadyRequest,
  } from "../state/appState.svelte";
  import Modal from "./Modal.svelte";

  let { request }: { request: ShareReadyRequest } = $props();

  // Held while the sheet is up: a second tap throws InvalidStateError ("already open").
  let sharing = $state(false);

  async function share() {
    if (sharing) return;
    sharing = true;
    try {
      await shareReadyRetry();
    } finally {
      sharing = false;
    }
  }
</script>

<Modal title="{request.file.name} is ready" onclose={shareReadyCancel}>
  <p class="text-xs text-muted">In the share sheet, choose “Save to Files” and pick a folder.</p>
  {#if request.note}<p class="mt-1 text-xs text-muted">{request.note}</p>{/if}
  {#if request.error}
    <p class="mt-2 text-xs text-danger">Couldn't share: {request.error}</p>
  {/if}
  {#snippet actions()}
    <button class="btn" disabled={sharing} onclick={shareReadyCancel}>Cancel</button>
    <button
      class="btn"
      disabled={sharing}
      title="Download to the browser's Downloads, as before"
      onclick={shareReadyDownload}
    >
      Download instead
    </button>
    <button class="btn btn-primary" disabled={sharing} onclick={share}>Save to Files…</button>
  {/snippet}
</Modal>
