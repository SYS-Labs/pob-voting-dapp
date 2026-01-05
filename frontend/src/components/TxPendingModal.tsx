import { useEffect, useState, useRef } from 'react';
import type { BrowserProvider } from 'ethers';
import Modal from './Modal';
import { ProgressSpinner } from './ProgressSpinner';

interface TxPendingModalProps {
  isOpen: boolean;
  txHash: string | null;
  provider: BrowserProvider | null;
  chainId: number | null;
  onClose: () => void;
  onConfirmed: () => void;
  onError: (error: string) => void;
  actionLabel?: string;
}

// Chain block times in seconds
const BLOCK_TIMES: Record<number, number> = {
  57: 150,      // NEVM mainnet
  5700: 120,    // NEVM testnet
  31337: 10,    // Hardhat (fast local chain)
};

const MIN_POLL_INTERVAL = 2000; // 2 seconds minimum

function getPollingInterval(chainId: number | null): number {
  if (!chainId) return MIN_POLL_INTERVAL;

  const blockTime = BLOCK_TIMES[chainId];
  if (!blockTime) return MIN_POLL_INTERVAL;

  // blockTime / 5 = max 5 polls per average block time
  const intervalSeconds = blockTime / 5;
  const intervalMs = intervalSeconds * 1000;

  // Ensure minimum of 2 seconds
  return Math.max(intervalMs, MIN_POLL_INTERVAL);
}

export default function TxPendingModal({
  isOpen,
  txHash,
  provider,
  chainId,
  onClose,
  onConfirmed,
  onError,
  actionLabel = 'Transaction',
}: TxPendingModalProps) {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'error'>('pending');
  const intervalRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const pollingInterval = getPollingInterval(chainId);
  const rotationDuration = pollingInterval / 1000; // Convert to seconds for CSS

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !txHash || !provider) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setStatus('pending');
      return;
    }

    setStatus('pending');

    const pollTransaction = async () => {
      try {
        const receipt = await provider.getTransactionReceipt(txHash);

        if (receipt) {
          if (!mountedRef.current) return;

          if (receipt.status === 1) {
            setStatus('confirmed');
            if (intervalRef.current !== null) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            // Small delay to show confirmation state
            setTimeout(() => {
              if (mountedRef.current) {
                onConfirmed();
              }
            }, 1000);
          } else {
            setStatus('error');
            if (intervalRef.current !== null) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            onError('Transaction failed');
          }
        }
      } catch (error) {
        console.error('[TxPendingModal] Polling error:', error);
        // Don't stop polling on RPC errors, just continue
      }
    };

    // Poll immediately
    pollTransaction();

    // Then poll at interval
    intervalRef.current = window.setInterval(pollTransaction, pollingInterval);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOpen, txHash, provider, pollingInterval, onConfirmed, onError]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="md"
      closeOnBackdropClick={status !== 'pending'}
      closeOnEscape={status !== 'pending'}
      showCloseButton={status !== 'pending'}
    >
      <div className="pob-pane space-y-4">
        <div className="flex items-center gap-4">
          <ProgressSpinner size={48} rotationDuration={rotationDuration} />
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white">
              {!txHash
                ? 'Awaiting Wallet Approval'
                : status === 'pending'
                  ? 'Transaction Pending'
                  : status === 'confirmed'
                    ? 'Confirmed!'
                    : 'Failed'}
            </h2>
            <p className="text-sm text-[var(--pob-text-muted)]">{actionLabel}</p>
          </div>
        </div>

        {txHash && (
          <div className="rounded-lg bg-white/5 p-3">
            <p className="pob-label mb-1">Transaction Hash</p>
            <p className="pob-mono break-all text-xs text-white/80">{txHash}</p>
          </div>
        )}

        <div className="text-sm text-[var(--pob-text-muted)]">
          {!txHash && (
            <p>Please confirm the transaction in your wallet...</p>
          )}
          {txHash && status === 'pending' && (
            <>
              <p>Waiting for confirmation...</p>
              <p className="mt-1 text-xs">
                Polling every {(pollingInterval / 1000).toFixed(0)} seconds
              </p>
            </>
          )}
          {status === 'confirmed' && (
            <p className="text-[var(--pob-primary)]">Transaction confirmed successfully!</p>
          )}
        </div>

        {status !== 'pending' && (
          <button
            type="button"
            onClick={onClose}
            className="pob-button pob-button--outline w-full justify-center"
          >
            Close
          </button>
        )}
      </div>
    </Modal>
  );
}
