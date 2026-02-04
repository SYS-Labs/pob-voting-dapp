<script lang="ts">
  import Modal from './Modal.svelte';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onDisconnect: () => void;
    walletAddress: string;
    chainId: number | null;
    networkLabel: string;
  }

  let {
    isOpen,
    onClose,
    onDisconnect,
    walletAddress,
    chainId,
    networkLabel,
  }: Props = $props();

  function handleDisconnect() {
    onClose();
    onDisconnect();
  }
</script>

<Modal {isOpen} {onClose} maxWidth="md">
  {#snippet children()}
    <div class="pob-pane space-y-4">
      <h2 class="text-xl font-bold text-white">Wallet Connected</h2>

      <div class="space-y-3">
        <div class="pob-fieldset space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-xs text-[var(--pob-text-muted)] uppercase tracking-wider">Network:</span>
            <span class="font-semibold text-white">{networkLabel}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-[var(--pob-text-muted)] uppercase tracking-wider">Chain ID:</span>
            <span class="pob-mono text-xs text-white">{chainId}</span>
          </div>
        </div>

        <div class="pob-fieldset space-y-2">
          <p class="text-xs text-[var(--pob-text-muted)] uppercase tracking-wider">Address</p>
          <p class="pob-mono text-sm text-white break-all">{walletAddress}</p>
        </div>
      </div>

      <div class="pt-2">
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
