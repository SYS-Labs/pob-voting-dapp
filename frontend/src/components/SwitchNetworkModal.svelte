<script lang="ts">
  import Modal from './Modal.svelte';
  import { switchToNetwork } from '~/stores/wallet';
  import { NETWORKS, SYS_COIN_ID } from '~/constants/networks';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    targetChainId?: number;
  }

  let { isOpen, onClose, targetChainId = SYS_COIN_ID }: Props = $props();

  let switching = $state(false);
  let switchError = $state<string | null>(null);
  const targetNetwork = $derived(NETWORKS[targetChainId]);

  async function handleSwitch() {
    switching = true;
    switchError = null;
    try {
      await switchToNetwork(targetChainId);
      onClose();
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e?.code === 4001) {
        switchError = 'Switch rejected. Please switch manually in your wallet.';
      } else {
        switchError = e?.message ?? 'Failed to switch network.';
      }
    } finally {
      switching = false;
    }
  }
</script>

<Modal {isOpen} {onClose} maxWidth="md">
  {#snippet children()}
    <div class="pob-pane space-y-5">
      <div class="pr-10">
        <h2 class="pob-pane__title">Wrong Network</h2>
        <p class="pob-pane__meta mt-1">Wallet chain mismatch</p>
      </div>

      <p class="text-sm text-[var(--pob-text-muted)]">
        Switch to <strong class="text-white">{targetNetwork?.name ?? `Chain ${targetChainId}`}</strong>.
        Click below to switch automatically.
      </p>

      <button
        type="button"
        onclick={handleSwitch}
        disabled={switching}
        class="pob-button w-full justify-center"
      >
        {switching ? 'Switching…' : `Switch to ${targetNetwork?.name ?? `Chain ${targetChainId}`}`}
      </button>

      {#if switchError}
        <p class="pob-form__error">{switchError}</p>
      {/if}

      <div class="pob-fieldset grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <span class="pob-label">Chain ID</span>
          <span class="pob-mono text-xs text-[var(--pob-text)]">{targetChainId}</span>
        </div>
        {#if targetNetwork?.rpcUrl}
          <div class="grid gap-1">
            <span class="pob-label">RPC</span>
            <span class="pob-mono break-all text-xs text-[var(--pob-text-muted)]">
              {targetNetwork.rpcUrl.replace(/^https?:\/\//, '')}
            </span>
          </div>
        {/if}
      </div>

      <button
        type="button"
        onclick={onClose}
        class="pob-button pob-button--outline w-full justify-center"
      >
        Close
      </button>
    </div>
  {/snippet}
</Modal>
