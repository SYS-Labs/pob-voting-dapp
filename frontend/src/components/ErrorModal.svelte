<script lang="ts">
  import Modal from './Modal.svelte';

  interface Props {
    isOpen: boolean;
    error: string;
    onClose: () => void;
    onRetry?: () => void;
    title?: string;
  }

  let {
    isOpen,
    error,
    onClose,
    onRetry,
    title = 'Error',
  }: Props = $props();

  function handleRetry() {
    onClose();
    if (onRetry) {
      onRetry();
    }
  }
</script>

<Modal {isOpen} {onClose} maxWidth="md">
  {#snippet children()}
    <div class="pob-pane space-y-4">
      <h2 class="text-xl font-bold text-white">{title}</h2>

      <div class="rounded-lg border border-[rgba(247,147,26,0.4)] bg-[rgba(247,147,26,0.08)] p-4">
        <p class="text-sm text-white">{error}</p>
      </div>

      <div class="flex gap-3">
        {#if onRetry}
          <button
            type="button"
            onclick={handleRetry}
            class="pob-button flex-1 justify-center"
          >
            Retry
          </button>
        {/if}
        <button
          type="button"
          onclick={onClose}
          class="pob-button pob-button--outline flex-1 justify-center"
        >
          {onRetry ? 'Dismiss' : 'Close'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>
