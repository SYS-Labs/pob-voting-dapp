<script lang="ts">
  import Modal from './Modal.svelte';
  import WalletIcon from './WalletIcon.svelte';
  import type { WalletProviderOption } from '~/stores/wallet';

  interface Props {
    isOpen: boolean;
    wallets: WalletProviderOption[];
    isConnecting: boolean;
    error: string | null;
    onClose: () => void;
    onSelect: (walletId: string) => void | Promise<void>;
    onRefresh: () => void;
  }

  let {
    isOpen,
    wallets,
    isConnecting,
    error,
    onClose,
    onSelect,
    onRefresh,
  }: Props = $props();

</script>

<Modal
  {isOpen}
  {onClose}
  maxWidth="md"
  closeOnBackdropClick={!isConnecting}
  closeOnEscape={!isConnecting}
  showCloseButton={!isConnecting}
>
  {#snippet children()}
    <div class="pob-pane space-y-5">
      <div class="pr-10">
        <div>
          <h2 class="pob-pane__title">Choose Wallet</h2>
          <p class="pob-pane__meta mt-1">Select a browser wallet</p>
        </div>
      </div>

      {#if wallets.length > 0}
        <div class="space-y-3">
          {#each wallets as wallet (wallet.id)}
            <button
              type="button"
              class="pob-fieldset w-full cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60"
              onclick={() => onSelect(wallet.id)}
              disabled={isConnecting}
            >
              <span class="flex items-center gap-3">
                <WalletIcon icon={wallet.info.icon} name={wallet.info.name} size="md" />

                <span class="min-w-0 flex-1">
                  <span class="block font-semibold text-[var(--pob-text)]">{wallet.info.name}</span>
                  <span class="block truncate text-xs text-[var(--pob-text-muted)]">
                    {wallet.isLegacy ? 'Injected provider' : wallet.info.rdns}
                  </span>
                </span>
              </span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="pob-fieldset space-y-3">
          <p class="text-sm text-[var(--pob-text-muted)]">
            No injected wallet was found.
          </p>
          <button
            type="button"
            onclick={onRefresh}
            class="pob-button pob-button--outline w-full justify-center"
          >
            Check Again
          </button>
        </div>
      {/if}

      {#if error}
        <p class="pob-form__error">{error}</p>
      {/if}

      <button
        type="button"
        onclick={onClose}
        disabled={isConnecting}
        class="pob-button pob-button--outline w-full justify-center"
      >
        {isConnecting ? 'Connecting...' : 'Cancel'}
      </button>
    </div>
  {/snippet}
</Modal>
