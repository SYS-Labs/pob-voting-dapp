<script lang="ts">
  import Modal from './Modal.svelte';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onDisconnect: () => void;
    onSwitchWallet: () => void;
    walletAddress: string;
    chainId: number | null;
    networkLabel: string;
    walletName?: string | null;
  }

  let {
    isOpen,
    onClose,
    onDisconnect,
    onSwitchWallet,
    walletAddress,
    chainId,
    networkLabel,
    walletName = null,
  }: Props = $props();

  function handleDisconnect() {
    onClose();
    onDisconnect();
  }

  function handleSwitchWallet() {
    onClose();
    onSwitchWallet();
  }
</script>

<Modal {isOpen} {onClose} maxWidth="md">
  {#snippet children()}
    <div class="pob-pane space-y-5">
      <div class="pr-10">
        <h2 class="pob-pane__title">Wallet Connected</h2>
        <p class="pob-pane__meta mt-1">Current connection</p>
      </div>

      <div class="space-y-3">
        <div class="pob-fieldset space-y-2">
          {#if walletName}
            <div class="flex items-center justify-between gap-3">
              <span class="pob-label">Wallet</span>
              <span class="min-w-0 truncate text-right font-semibold text-[var(--pob-text)]">{walletName}</span>
            </div>
          {/if}
          <div class="flex items-center justify-between gap-3">
            <span class="pob-label">Network</span>
            <span class="min-w-0 truncate text-right font-semibold text-[var(--pob-text)]">{networkLabel}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="pob-label">Chain ID</span>
            <span class="pob-mono text-xs text-[var(--pob-text)]">{chainId ?? 'Unknown'}</span>
          </div>
        </div>

        <div class="pob-fieldset space-y-2">
          <p class="pob-label">Address</p>
          <p class="pob-mono break-all text-sm text-[var(--pob-text)]">{walletAddress}</p>
        </div>
      </div>

      <div class="grid gap-3 pt-2 sm:grid-cols-2">
        <button
          type="button"
          onclick={handleSwitchWallet}
          class="pob-button w-full justify-center"
        >
          Switch Wallet
        </button>
        <button
          type="button"
          onclick={handleDisconnect}
          class="pob-button pob-button--outline w-full justify-center"
        >
          Disconnect Wallet
        </button>
      </div>
    </div>
  {/snippet}
</Modal>
