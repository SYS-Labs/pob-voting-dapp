import { useState, useEffect, useCallback } from 'react';
import { Contract } from 'ethers';
import type { JsonRpcSigner } from 'ethers';
import type { ProjectMetadata } from '~/interfaces';
import { metadataAPI } from '~/utils/metadata-api';
import { getPublicProvider } from '~/utils/provider';
import JurySC_01ABI from '~/abis/JurySC_01_v002.json';

export interface ProjectMetadataForm {
  name: string;
  yt_vid: string;
  proposal: string;
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
  votingActive: boolean
): UseProjectMetadataManagerReturn {
  const [currentCID, setCurrentCID] = useState<string | null>(null);
  const [currentConfirmations, setCurrentConfirmations] = useState(10); // Default settled
  const [pendingCID, setPendingCID] = useState<string | null>(null);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState(0);
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load current CID from contract
  useEffect(() => {
    if (!projectAddress || !chainId || !contractAddress) return;

    const loadCID = async () => {
      try {
        const provider = getPublicProvider(chainId);
        const contract = new Contract(contractAddress, JurySC_01ABI, provider);
        const cid = await contract.projectMetadataCID(projectAddress);

        setCurrentCID(cid || null);
        if (cid) {
          setCurrentConfirmations(10); // Already on-chain = settled
        }
      } catch (error) {
        console.error('Failed to load CID from contract:', error);
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

  // Restore pending state from localStorage on mount
  useEffect(() => {
    if (!projectAddress || !chainId) return;

    const key = `pob_metadata_pending_${chainId}_${projectAddress}`;
    const stored = localStorage.getItem(key);

    if (stored) {
      try {
        const { cid, txHash, timestamp } = JSON.parse(stored);

        // Only restore if less than 24 hours old
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          setPendingCID(cid);
          setPendingTxHash(txHash);
          setPendingConfirmations(0);
        } else {
          localStorage.removeItem(key);
        }
      } catch (error) {
        console.error('Failed to restore pending state:', error);
        localStorage.removeItem(key);
      }
    }
  }, [projectAddress, chainId]);

  // Poll confirmations for pending tx
  useEffect(() => {
    if (!pendingTxHash) return;

    const pollConfirmations = async () => {
      try {
        const status = await metadataAPI.getMetadataUpdateStatus(pendingTxHash);

        setPendingConfirmations(status.confirmations);

        if (status.confirmations >= 10) {
          // Transaction settled - move to current and clear pending
          if (pendingCID) {
            setCurrentCID(pendingCID);
            setCurrentConfirmations(status.confirmations);
          }
          clearPending();
        }
      } catch (error) {
        console.error('Failed to poll confirmations:', error);
      }
    };

    // Poll immediately
    pollConfirmations();

    // Then poll every 5 seconds
    const interval = setInterval(pollConfirmations, 5000);

    return () => clearInterval(interval);
  }, [pendingTxHash, pendingCID]);

  // Submit metadata update
  const submitMetadata = useCallback(async (formData: ProjectMetadataForm) => {
    if (!signer || !projectAddress || !chainId || !contractAddress) {
      throw new Error('Missing required parameters');
    }

    if (votingActive) {
      throw new Error('Cannot update metadata while voting is active');
    }

    if (pendingConfirmations > 0 && pendingConfirmations < 1) {
      throw new Error('Please wait for at least 1 confirmation before submitting again');
    }

    setIsSubmitting(true);
    try {
      // 1. Sign message proving ownership of project address
      const message = `Update metadata for project ${projectAddress} on chain ${chainId}`;
      const signature = await signer.signMessage(message);

      // 2. POST to API - API will upload to IPFS and call contract
      const { cid, txHash } = await metadataAPI.setProjectMetadata(
        chainId,
        contractAddress,
        projectAddress,
        {
          chainId,
          account: projectAddress,
          name: formData.name,
          yt_vid: formData.yt_vid || undefined,
          proposal: formData.proposal || undefined,
        },
        signature,
        message
      );

      // 3. Set pending state
      setPendingCID(cid);
      setPendingTxHash(txHash);
      setPendingConfirmations(0);

      // 4. Persist to localStorage
      const key = `pob_metadata_pending_${chainId}_${projectAddress}`;
      localStorage.setItem(key, JSON.stringify({
        cid,
        txHash,
        timestamp: Date.now(),
      }));

      console.log('Metadata submitted:', { cid, txHash });
    } finally {
      setIsSubmitting(false);
    }
  }, [signer, projectAddress, chainId, contractAddress, votingActive, pendingConfirmations]);

  // Clear pending state
  const clearPending = useCallback(() => {
    setPendingCID(null);
    setPendingTxHash(null);
    setPendingConfirmations(0);

    if (projectAddress && chainId) {
      const key = `pob_metadata_pending_${chainId}_${projectAddress}`;
      localStorage.removeItem(key);
    }
  }, [projectAddress, chainId]);

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
