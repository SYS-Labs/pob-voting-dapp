<script lang="ts">
  import type { BrowserProvider } from 'ethers';
  import Modal from './Modal.svelte';
  import ProgressSpinner from './ProgressSpinner.svelte';

  interface Props {
    isOpen: boolean;
    txHash: string | null;
    provider: BrowserProvider | null;
    chainId: number | null;
    onClose: () => void;
    onConfirmed: () => void;
    onError: (error: string) => void;
    actionLabel?: string;
  }

  let {
    isOpen,
    txHash,
    provider,
    chainId,
    onClose,
    onConfirmed,
    onError,
    actionLabel = 'Transaction',
  }: Props = $props();

  let status = $state<'pending' | 'confirmed' | 'error'>('pending');

  // Chain block times in seconds
  const BLOCK_TIMES: Record<number, number> = {
    57: 150,      // NEVM mainnet
    5700: 120,    // NEVM testnet
    31337: 10,    // Hardhat
  };

  const MIN_POLL_INTERVAL = 2000;

  function getPollingInterval(chainId: number | null): number {
    if (!chainId) return MIN_POLL_INTERVAL;
    const blockTime = BLOCK_TIMES[chainId];
    if (!blockTime) return MIN_POLL_INTERVAL;
    const intervalSeconds = blockTime / 5;
    const intervalMs = intervalSeconds * 1000;
    return Math.max(intervalMs, MIN_POLL_INTERVAL);
  }

  const pollingInterval = $derived(getPollingInterval(chainId));
  const rotationDuration = $derived(pollingInterval / 1000);

  $effect(() => {
    if (!isOpen || !txHash || !provider) {
      status = 'pending';
      return;
    }

    let mounted = true;
    let intervalId: number | null = null;

    status = 'pending';

    const pollTransaction = async () => {
      try {
        const receipt = await provider.getTransactionReceipt(txHash);

        if (receipt && mounted) {
          if (receipt.status === 1) {
            status = 'confirmed';
            if (intervalId !== null) {
              clearInterval(intervalId);
              intervalId = null;
            }
            setTimeout(() => {
              if (mounted) {
                onConfirmed();
              }
            }, 1000);
          } else {
            status = 'error';
            if (intervalId !== null) {
              clearInterval(intervalId);
              intervalId = null;
            }
            onError('Transaction failed');
          }
        }
      } catch (error) {
        console.error('[TxPendingModal] Polling error:', error);
      }
    };

    pollTransaction();
    intervalId = window.setInterval(pollTransaction, pollingInterval);

    return () => {
      mounted = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  });
</script>

<Modal
  {isOpen}
  {onClose}
  maxWidth="md"
  closeOnBackdropClick={status !== 'pending'}
  closeOnEscape={status !== 'pending'}
  showCloseButton={status !== 'pending'}
>
  {#snippet children()}
    <div class="pob-pane space-y-4">
      <div class="flex items-center gap-4">
        <ProgressSpinner size={48} {rotationDuration} />
        <div class="flex-1">
          <h2 class="text-xl font-bold text-white">
            {#if !txHash}
              Awaiting Wallet Approval
            {:else if status === 'pending'}
              Transaction Pending
            {:else if status === 'confirmed'}
              Confirmed!
            {:else}
              Failed
            {/if}
          </h2>
          <p class="text-sm text-[var(--pob-text-muted)]">{actionLabel}</p>
        </div>
      </div>

      {#if txHash}
        <div class="rounded-lg bg-white/5 p-3">
          <p class="pob-label mb-1">Transaction Hash</p>
          <p class="pob-mono break-all text-xs text-white/80">{txHash}</p>
        </div>
      {/if}

      <div class="text-sm text-[var(--pob-text-muted)]">
        {#if !txHash}
          <p>Please confirm the transaction in your wallet...</p>
        {:else if status === 'pending'}
          <p>Waiting for confirmation...</p>
          <p class="mt-1 text-xs">
            Polling every {(pollingInterval / 1000).toFixed(0)} seconds
          </p>
        {:else if status === 'confirmed'}
          <p class="text-[var(--pob-primary)]">Transaction confirmed successfully!</p>
        {/if}
      </div>

      {#if status !== 'pending'}
        <button
          type="button"
          onclick={onClose}
          class="pob-button pob-button--outline w-full justify-center"
        >
          Close
        </button>
      {/if}
    </div>
  {/snippet}
</Modal>
