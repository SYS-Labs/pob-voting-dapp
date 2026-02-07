import { writable, get } from 'svelte/store';
import { Transaction, type JsonRpcSigner } from 'ethers';
import type { IterationMetadata } from '~/interfaces';
import { metadataAPI } from '~/utils/metadata-api';
import { getPublicProvider } from '~/utils/provider';
import { getIterationMetadataCID, getPoBRegistryContract, REGISTRY_ADDRESSES } from '~/utils/registry';

export interface IterationMetadataForm {
  name: string;
  description: string;
  link: string;
}

export interface IterationMetadataManagerState {
  currentCID: string | null;
  currentConfirmations: number;
  pendingCID: string | null;
  pendingTxHash: string | null;
  pendingConfirmations: number;
  metadata: IterationMetadata | null;
  isSubmitting: boolean;
}

/**
 * Creates a Svelte store for managing iteration metadata updates
 * Handles CID loading, metadata submission, and confirmation polling
 */
export function createIterationMetadataManager(
  iterationNumber: number | null,
  round: number | null,
  chainId: number | null,
  contractAddress: string | null,
  signer: JsonRpcSigner | null,
  votingActive: boolean
) {
  const state = writable<IterationMetadataManagerState>({
    currentCID: null,
    currentConfirmations: 10,
    pendingCID: null,
    pendingTxHash: null,
    pendingConfirmations: 0,
    metadata: null,
    isSubmitting: false,
  });

  let pollingInterval: number | null = null;

  // Load current CID from PoBRegistry
  const loadCID = async () => {
    if (!chainId || !contractAddress) return;

    try {
      const provider = getPublicProvider(chainId);
      if (!provider) return;
      const cid = await getIterationMetadataCID(chainId, contractAddress, provider);

      state.update(s => ({
        ...s,
        currentCID: cid || null,
        currentConfirmations: cid ? 10 : s.currentConfirmations,
      }));

      // If CID loaded, fetch metadata
      if (cid) {
        try {
          const data = await metadataAPI.getIterationMetadata(chainId, contractAddress);
          state.update(s => ({ ...s, metadata: data }));
        } catch (error) {
          console.error('Failed to load metadata from API:', error);
        }
      }
    } catch (error) {
      console.error('Failed to load CID from PoBRegistry:', error);
    }
  };

  // Load pending state from localStorage
  const loadPendingState = () => {
    if (!chainId || !contractAddress) return;

    const storageKey = `pending-iteration-metadata-${chainId}-${contractAddress}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const pending = JSON.parse(stored);
        state.update(s => ({
          ...s,
          pendingCID: pending.cid,
          pendingTxHash: pending.txHash,
          pendingConfirmations: 0,
        }));
        console.log('[iterationMetadataManager] Loaded pending state from localStorage:', pending);
      }
    } catch (error) {
      console.error('Failed to load pending state from localStorage:', error);
    }
  };

  // Poll confirmations for pending tx
  const startPolling = () => {
    const currentState = get(state);
    if (!currentState.pendingTxHash || !chainId) return;

    const BLOCK_TIMES: Record<number, number> = {
      57: 150,
      5700: 120,
      31337: 10,
    };
    const MIN_POLL_INTERVAL = 2000;
    const blockTime = BLOCK_TIMES[chainId] || 120;
    const interval = Math.max((blockTime / 5) * 1000, MIN_POLL_INTERVAL);

    const pollConfirmations = async () => {
      const s = get(state);
      if (!s.pendingTxHash) return;

      try {
        const provider = getPublicProvider(chainId);
        if (!provider) return;

        const tx = await provider.getTransaction(s.pendingTxHash);
        if (!tx) return;

        if (!tx.blockNumber) {
          state.update(st => ({ ...st, pendingConfirmations: 0 }));
          return;
        }

        const currentBlock = await provider.getBlockNumber();
        const confirmations = currentBlock - tx.blockNumber + 1;

        state.update(st => ({ ...st, pendingConfirmations: confirmations }));

        if (confirmations >= 10) {
          state.update(st => ({
            ...st,
            currentCID: st.pendingCID,
            currentConfirmations: confirmations,
            pendingCID: null,
            pendingTxHash: null,
            pendingConfirmations: 0,
          }));

          if (chainId && contractAddress) {
            const storageKey = `pending-iteration-metadata-${chainId}-${contractAddress}`;
            localStorage.removeItem(storageKey);
          }

          if (pollingInterval !== null) {
            clearInterval(pollingInterval);
            pollingInterval = null;
          }

          // Reload metadata from API with the new CID
          loadCID();
        }
      } catch (error) {
        console.error('Failed to poll confirmations:', error);
      }
    };

    pollConfirmations();
    pollingInterval = window.setInterval(pollConfirmations, interval);
  };

  // Submit metadata update
  const submitMetadata = async (formData: IterationMetadataForm) => {
    if (!signer || !chainId || !contractAddress || iterationNumber === null || round === null) {
      throw new Error('Missing required parameters');
    }

    if (votingActive) {
      throw new Error('Cannot update metadata while voting is active');
    }

    const currentState = get(state);
    if (currentState.pendingConfirmations > 0 && currentState.pendingConfirmations < 10) {
      throw new Error('Please wait for pending transaction to confirm');
    }

    const registryAddress = REGISTRY_ADDRESSES[chainId];
    if (!registryAddress) {
      throw new Error(`PoBRegistry not deployed on chain ${chainId}`);
    }

    state.update(s => ({ ...s, isSubmitting: true }));
    try {
      const metadata: IterationMetadata = {
        iteration: iterationNumber,
        round,
        name: formData.name,
        description: formData.description || undefined,
        link: formData.link || undefined,
        chainId,
        votingMode: 0,
      };

      const cid = await metadataAPI.previewMetadata(metadata, 'iteration');

      const provider = signer.provider!;
      const registry = getPoBRegistryContract(chainId, provider);
      if (!registry) {
        throw new Error('Failed to get PoBRegistry contract');
      }

      const registryWithSigner = registry.connect(signer) as any;
      const txResponse = await registryWithSigner.setIterationMetadata(
        chainId,
        contractAddress,
        cid
      );

      const tx = await provider.getTransaction(txResponse.hash);
      if (!tx) {
        throw new Error('Failed to retrieve transaction from provider');
      }

      const transaction = Transaction.from({
        to: tx.to,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit,
        data: tx.data,
        value: tx.value,
        chainId: BigInt(chainId),
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        signature: tx.signature
      });
      const rawTx = transaction.serialized;

      await metadataAPI.submitMetadata({
        cid,
        rawTx,
        chainId,
        contractAddress,
        kind: 'iteration',
        metadata,
      });

      state.update(s => ({
        ...s,
        pendingCID: cid,
        pendingTxHash: txResponse.hash,
        pendingConfirmations: 0,
      }));

      const storageKey = `pending-iteration-metadata-${chainId}-${contractAddress}`;
      localStorage.setItem(storageKey, JSON.stringify({
        cid,
        txHash: txResponse.hash,
        timestamp: Date.now()
      }));

      startPolling();
    } finally {
      state.update(s => ({ ...s, isSubmitting: false }));
    }
  };

  // Clear pending state
  const clearPending = () => {
    state.update(s => ({
      ...s,
      pendingCID: null,
      pendingTxHash: null,
      pendingConfirmations: 0,
    }));

    if (chainId && contractAddress) {
      const storageKey = `pending-iteration-metadata-${chainId}-${contractAddress}`;
      localStorage.removeItem(storageKey);
    }

    if (pollingInterval !== null) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  };

  // Initialize
  loadCID();
  loadPendingState();
  startPolling();

  const destroy = () => {
    if (pollingInterval !== null) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  };

  return {
    subscribe: state.subscribe,
    submitMetadata,
    clearPending,
    destroy,
  };
}

