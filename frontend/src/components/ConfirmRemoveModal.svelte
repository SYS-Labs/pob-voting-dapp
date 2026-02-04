<script lang="ts">
  import Modal from './Modal.svelte';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    targetAddress: string;
    isPending: boolean;
    title?: string;
    description?: string;
    entityLabel?: string;
    confirmLabel?: string;
  }

  let {
    isOpen,
    onClose,
    onConfirm,
    targetAddress,
    isPending,
    title,
    description,
    entityLabel,
    confirmLabel,
  }: Props = $props();

  const modalTitle = $derived(title ?? 'Remove DAO HIC Voter?');
  const modalDescription = $derived(description ?? 'This will revoke voting access for the following address:');
  const modalEntityLabel = $derived(entityLabel ?? 'DAO HIC voter');
  const modalConfirmLabel = $derived(confirmLabel ?? 'Yes, remove');
</script>

<Modal
  {isOpen}
  {onClose}
  maxWidth="md"
  closeOnBackdropClick={!isPending}
  closeOnEscape={!isPending}
  showCloseButton={!isPending}
>
  {#snippet children()}
    <div class="pob-pane space-y-4">
      <h2 class="text-xl font-bold text-white">{modalTitle}</h2>

      <div class="space-y-3">
        <p class="text-sm text-[var(--pob-text-muted)]">{modalDescription}</p>

        <div class="pob-fieldset space-y-2">
          <p class="text-xs uppercase tracking-[0.12em] text-[var(--pob-text-muted)]">
            {modalEntityLabel}
          </p>
          <p class="pob-mono break-all text-sm text-white">{targetAddress}</p>
        </div>
      </div>

      <div class="flex gap-3 pt-2">
        <button
          type="button"
          onclick={onClose}
          disabled={isPending}
          class="pob-button pob-button--outline flex-1 justify-center"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onConfirm}
          disabled={isPending}
          class="pob-button flex-1 justify-center"
        >
          {isPending ? 'Removing...' : modalConfirmLabel}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>
