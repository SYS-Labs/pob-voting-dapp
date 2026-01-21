import { useState, useEffect, useCallback } from 'react';
import { Transaction, type JsonRpcSigner } from 'ethers';
import type { ProjectMetadata } from '~/interfaces';
import { metadataAPI } from '~/utils/metadata-api';
import { getPublicProvider } from '~/utils/provider';
import { getProjectMetadataCID, getPoBRegistryContract, REGISTRY_ADDRESSES } from '~/utils/registry';

export interface ProjectMetadataFormSocials {
  x: string;
  instagram: string;
  tiktok: string;
  linkedin: string;
}

export interface ProjectMetadataForm {
  name: string;
  yt_vid: string;
  proposal: string;
  socials: ProjectMetadataFormSocials;
}

export interface UseProjectMetadataManagerReturn {
  currentCID: string | null;
  currentConfirmations: number;
  pendingCID: string | null;
  pendingTxHash: string | null;
  pendingConfirmations: number;
  metadata: ProjectMetadata | null;
  isSubmitting: boolean;
  submitMetadata: (formData: ProjectMetadataForm) => Promise<void>;
  clearPending: () => void;
}

/**
 * Hook for managing a single project's metadata updates
 * Handles CID loading, metadata submission, and confirmation polling
 */
export function useProjectMetadataManager(
  projectAddress: string | null,
  chainId: number | null,
  contractAddress: string | null,
  signer: JsonRpcSigner | null,
  metadataLocked: boolean
): UseProjectMetadataManagerReturn {
  const [currentCID, setCurrentCID] = useState<string | null>(null);
  const [currentConfirmations, setCurrentConfirmations] = useState(5); // Default settled
  const [pendingCID, setPendingCID] = useState<string | null>(null);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState(0);
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load current CID from PoBRegistry
  useEffect(() => {
    if (!projectAddress || !chainId || !contractAddress) return;

    const loadCID = async () => {
      try {
        const provider = getPublicProvider(chainId);
        if (!provider) return;
        const cid = await getProjectMetadataCID(chainId, contractAddress, projectAddress, provider);

        setCurrentCID(cid || null);
        if (cid) {
          setCurrentConfirmations(5); // Already on-chain = settled
        }
      } catch (error) {
        console.error('Failed to load CID from PoBRegistry:', error);
      }
    };

    loadCID();
  }, [projectAddress, chainId, contractAddress]);

  // Load metadata from API when CID changes
  useEffect(() => {
    if (!currentCID || !chainId || !contractAddress || !projectAddress) return;

    const loadMetadata = async () => {
      try {
        const data = await metadataAPI.getProjectMetadata(chainId, contractAddress, projectAddress);
        setMetadata(data);
      } catch (error) {
        console.error('Failed to load metadata from API:', error);
      }
    };

    loadMetadata();
  }, [currentCID, chainId, contractAddress, projectAddress]);

  // Load pending state from localStorage on mount
  useEffect(() => {
    if (!projectAddress || !chainId || !contractAddress) return;

    const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const pending = JSON.parse(stored);
        setPendingCID(pending.cid);
        setPendingTxHash(pending.txHash);
        setPendingConfirmations(0); // Will be updated by polling
        console.log('[useProjectMetadataManager] Loaded pending state from localStorage:', pending);
      }
    } catch (error) {
      console.error('Failed to load pending state from localStorage:', error);
    }
  }, [projectAddress, chainId, contractAddress]);

  // Poll confirmations for pending tx
  useEffect(() => {
    if (!pendingTxHash || !chainId) return;

    // Calculate polling interval based on chain block time
    // Same ratio as TxPendingModal: blockTime / 5 = max 5 polls per block
    const BLOCK_TIMES: Record<number, number> = {
      57: 150,      // NEVM mainnet (150s blocks)
      5700: 120,    // NEVM testnet (120s blocks)
      31337: 10,    // Hardhat (10s blocks)
    };
    const MIN_POLL_INTERVAL = 2000; // 2 seconds minimum
    const blockTime = BLOCK_TIMES[chainId] || 120;
    const pollingInterval = Math.max((blockTime / 5) * 1000, MIN_POLL_INTERVAL);

    const pollConfirmations = async () => {
      try {
        const provider = getPublicProvider(chainId);
        if (!provider) return;

        // Get transaction receipt from RPC (same as TxPendingModal)
        const tx = await provider.getTransaction(pendingTxHash);

        if (!tx) {
          console.warn('Transaction not found:', pendingTxHash);
          return;
        }

        if (!tx.blockNumber) {
          // Transaction is pending
          setPendingConfirmations(0);
          return;
        }

        const currentBlock = await provider.getBlockNumber();
        const confirmations = currentBlock - tx.blockNumber + 1;

        setPendingConfirmations(confirmations);

        if (confirmations >= 5) {
          // Transaction settled - move to current and clear pending
          if (pendingCID) {
            setCurrentCID(pendingCID);
            setCurrentConfirmations(confirmations);
          }
          // Clear pending state and localStorage
          setPendingCID(null);
          setPendingTxHash(null);
          setPendingConfirmations(0);

          if (projectAddress && chainId && contractAddress) {
            const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
            localStorage.removeItem(storageKey);
          }
        }
      } catch (error) {
        console.error('Failed to poll confirmations:', error);
      }
    };

    // Poll immediately
    pollConfirmations();

    // Then poll at calculated interval
    const interval = setInterval(pollConfirmations, pollingInterval);

    return () => clearInterval(interval);
  }, [pendingTxHash, pendingCID, chainId, projectAddress, contractAddress]);

  // Submit metadata update using role-gated flow
  const submitMetadata = useCallback(async (formData: ProjectMetadataForm) => {
    if (!signer || !projectAddress || !chainId || !contractAddress) {
      throw new Error('Missing required parameters');
    }

    // Owner bypass: when VITE_OWNER_METADATA_BYPASS is enabled, skip metadataLocked check
    const ownerBypassEnabled = import.meta.env.VITE_OWNER_METADATA_BYPASS === 'true';
    if (metadataLocked && !ownerBypassEnabled) {
      throw new Error('Metadata editing closed (voting started)');
    }

    if (pendingConfirmations > 0 && pendingConfirmations < 5) {
      throw new Error('Please wait for pending transaction to confirm');
    }

    const registryAddress = REGISTRY_ADDRESSES[chainId];
    if (!registryAddress) {
      throw new Error(`PoBRegistry not deployed on chain ${chainId}`);
    }

    setIsSubmitting(true);
    try {
      // 1. Prepare metadata object
      // Only include socials if at least one field has a value
      const hasSocials = formData.socials.x || formData.socials.instagram ||
                         formData.socials.tiktok || formData.socials.linkedin;
      const socials = hasSocials ? {
        x: formData.socials.x || undefined,
        instagram: formData.socials.instagram || undefined,
        tiktok: formData.socials.tiktok || undefined,
        linkedin: formData.socials.linkedin || undefined,
      } : undefined;

      const metadata: ProjectMetadata = {
        chainId,
        account: projectAddress,
        name: formData.name,
        yt_vid: formData.yt_vid || undefined,
        proposal: formData.proposal || undefined,
        socials,
      };

      // 2. Preview CID (deterministic, no upload yet)
      const cid = await metadataAPI.previewMetadata(metadata, 'project');
      console.log('Previewed CID:', cid);

      // 3. Send transaction to blockchain (signs & broadcasts in one step)
      // Note: Browser wallets don't support eth_signTransaction, so we sign+broadcast together
      const provider = signer.provider!;
      const registry = getPoBRegistryContract(chainId, provider);
      if (!registry) {
        throw new Error('Failed to get PoBRegistry contract');
      }

      const registryWithSigner = registry.connect(signer) as any;

      // 4. Sign and send transaction (ONE wallet prompt)
      console.log('Sending transaction to set CID on-chain...');
      const txResponse = await registryWithSigner.setProjectMetadata(
        chainId,
        contractAddress,
        projectAddress,
        cid
      );
      console.log('Transaction sent:', txResponse.hash);

      // 5. Get the raw signed transaction from the provider
      // This is needed for the API to verify the signer and authorize IPFS upload
      const tx = await provider.getTransaction(txResponse.hash);
      if (!tx) {
        throw new Error('Failed to retrieve transaction from provider');
      }

      // Reconstruct and serialize the transaction to get raw tx
      // Note: Use the chainId we know is correct, as tx.chainId might be 0 on local networks
      const transaction = Transaction.from({
        to: tx.to,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit,
        data: tx.data,
        value: tx.value,
        chainId: BigInt(chainId), // Use our chainId, not tx.chainId which might be 0
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        signature: tx.signature
      });
      const rawTx = transaction.serialized;
      console.log('Reconstructed raw transaction with chainId:', chainId);

      // 6. Submit to API for verification and IPFS upload
      // API will verify the signer is authorized before uploading to IPFS
      const result = await metadataAPI.submitMetadata({
        cid,
        rawTx,
        chainId,
        contractAddress,
        projectAddress,
        kind: 'project',
        metadata,
      });

      console.log('API verified and uploaded to IPFS:', result);

      // 7. Set pending state and save to localStorage
      setPendingCID(cid);
      setPendingTxHash(txResponse.hash);
      setPendingConfirmations(0);

      const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
      localStorage.setItem(storageKey, JSON.stringify({
        cid,
        txHash: txResponse.hash,
        timestamp: Date.now()
      }));

      console.log('Metadata submitted:', { cid, txHash: txResponse.hash });
    } finally {
      setIsSubmitting(false);
    }
  }, [signer, projectAddress, chainId, contractAddress, metadataLocked, pendingConfirmations]);

  // Clear pending state from memory and localStorage
  const clearPending = useCallback(() => {
    setPendingCID(null);
    setPendingTxHash(null);
    setPendingConfirmations(0);

    if (projectAddress && chainId && contractAddress) {
      const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
      localStorage.removeItem(storageKey);
    }
  }, [projectAddress, chainId, contractAddress]);

  return {
    currentCID,
    currentConfirmations,
    pendingCID,
    pendingTxHash,
    pendingConfirmations,
    metadata,
    isSubmitting,
    submitMetadata,
    clearPending,
  };
}
