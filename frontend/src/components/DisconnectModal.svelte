<script lang="ts">
  import Modal from './Modal.svelte';
  import WalletIcon from './WalletIcon.svelte';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onDisconnect: () => void;
    onSwitchWallet: () => void;
    onSwitchAccount: () => void | Promise<void>;
    isSwitchingAccount?: boolean;
    walletAddress: string;
    chainId: number | null;
    networkLabel: string;
    walletName?: string | null;
    walletIcon?: string | null;
  }

  let {
    isOpen,
    onClose,
    onDisconnect,
    onSwitchWallet,
    onSwitchAccount,
    isSwitchingAccount = false,
    walletAddress,
    chainId,
    networkLabel,
    walletName = null,
    walletIcon = null,
  }: Props = $props();

  function handleDisconnect() {
    onClose();
    onDisconnect();
  }

  function handleSwitchWallet() {
    onClose();
    onSwitchWallet();
  }

  async function handleSwitchAccount() {
    await onSwitchAccount();
  }
</script>

<Modal {isOpen} {onClose} maxWidth="lg">
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
            <span class="inline-flex min-w-0 items-center justify-end gap-2 text-right font-semibold text-[var(--pob-text)]">
              <WalletIcon icon={walletIcon} name={walletName} size="sm" />
              <span class="min-w-0 truncate">{networkLabel}</span>
            </span>
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

      <div class="connection-actions pt-2">
        <button
          type="button"
          onclick={handleSwitchAccount}
          disabled={isSwitchingAccount}
          class="pob-button pob-button--compact w-full justify-center"
        >
          {isSwitchingAccount ? 'Switching...' : 'Switch Account'}
        </button>
        <button
          type="button"
          onclick={handleSwitchWallet}
          disabled={isSwitchingAccount}
          class="pob-button pob-button--compact pob-button--outline w-full justify-center"
        >
          Switch Wallet
        </button>
        <button
          type="button"
          onclick={handleDisconnect}
          disabled={isSwitchingAccount}
          class="pob-button pob-button--compact pob-button--outline w-full justify-center"
        >
          Disconnect
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

<style>
  .connection-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  @media (max-width: 479px) {
    .connection-actions {
      grid-template-columns: 1fr;
    }
  }
</style>
