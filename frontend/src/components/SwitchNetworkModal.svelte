<script lang="ts">
  import Modal from './Modal.svelte';
  import { switchToNetwork } from '~/stores/wallet';
  import { SYS_COIN_ID } from '~/constants/networks';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
  }

  let { isOpen, onClose }: Props = $props();

  let switching = $state(false);
  let switchError = $state<string | null>(null);

  async function handleSwitch(targetChainId: number) {
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
    <div class="pob-pane space-y-4">
      <h2 class="text-xl font-bold text-white">Wrong Network</h2>

      <p class="text-sm text-[var(--pob-text-muted)]">
        This app runs on <strong class="text-white">Syscoin NEVM Mainnet</strong>.
        Click below to switch automatically.
      </p>

      <button
        type="button"
        onclick={() => handleSwitch(SYS_COIN_ID)}
        disabled={switching}
        class="pob-button w-full justify-center"
      >
        {switching ? 'Switching…' : 'Switch to NEVM Mainnet'}
      </button>

      {#if switchError}
        <p class="text-xs text-red-400">{switchError}</p>
      {/if}

      <p class="text-xs text-[var(--pob-text-muted)]">
        Chain ID: 57 &nbsp;·&nbsp; RPC: rpc.syscoin.org
      </p>

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
