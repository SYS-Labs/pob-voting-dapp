import { writable, get } from 'svelte/store';
import { Contract, Transaction, type JsonRpcSigner } from 'ethers';
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

export interface ProjectMetadataManagerState {
  currentCID: string | null;
  currentTxHash: string | null;
  currentConfirmations: number;
  pendingCID: string | null;
  pendingTxHash: string | null;
  pendingConfirmations: number;
  metadata: ProjectMetadata | null;
  isSubmitting: boolean;
}

/**
 * Creates a Svelte store for managing a single project's metadata updates
 * Handles CID loading, metadata submission, and confirmation polling
 */
export function createProjectMetadataManager(
  projectAddress: string | null,
  chainId: number | null,
  contractAddress: string | null,
  signer: JsonRpcSigner | null,
) {
  const state = writable<ProjectMetadataManagerState>({
    currentCID: null,
    currentTxHash: null,
    currentConfirmations: 5,
    pendingCID: null,
    pendingTxHash: null,
    pendingConfirmations: 0,
    metadata: null,
    isSubmitting: false,
  });

  let pollingInterval: number | null = null;

  // Load current CID from PoBRegistry
  const loadCID = async () => {
    if (!projectAddress || !chainId || !contractAddress) return;

    try {
      const provider = getPublicProvider(chainId);
      if (!provider) return;
      const cid = await getProjectMetadataCID(chainId, contractAddress, projectAddress, provider);

      state.update(s => ({
        ...s,
        currentCID: cid || null,
        currentConfirmations: cid ? 5 : s.currentConfirmations,
      }));

      // If CID loaded, fetch metadata
      if (cid) {
        try {
          const data = await metadataAPI.getProjectMetadata(chainId, contractAddress, projectAddress);
          state.update(s => ({
            ...s,
            metadata: data,
            currentTxHash: data?.txHash || s.currentTxHash,
          }));
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
    if (!projectAddress || !chainId || !contractAddress) return;

    const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
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
        console.log('[projectMetadataManager] Loaded pending state from localStorage:', pending);
      }
    } catch (error) {
      console.error('Failed to load pending state from localStorage:', error);
    }
  };

  // Poll confirmations for pending tx
  const startPolling = () => {
    const currentState = get(state);
    if (!currentState.pendingTxHash || !chainId) return;

    // Calculate polling interval
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

        if (confirmations >= 5) {
          // Transaction settled
          state.update(st => ({
            ...st,
            currentCID: st.pendingCID,
            currentConfirmations: confirmations,
            pendingCID: null,
            pendingTxHash: null,
            pendingConfirmations: 0,
          }));

          if (projectAddress && chainId && contractAddress) {
            const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
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
  const submitMetadata = async (formData: ProjectMetadataForm) => {
    if (!signer || !projectAddress || !chainId || !contractAddress) {
      throw new Error('Missing required parameters');
    }

    const currentState = get(state);
    if (currentState.pendingConfirmations > 0 && currentState.pendingConfirmations < 5) {
      throw new Error('Please wait for pending transaction to confirm');
    }

    const registryAddress = REGISTRY_ADDRESSES[chainId];
    if (!registryAddress) {
      throw new Error(`PoBRegistry not deployed on chain ${chainId}`);
    }

    // Pre-flight RPC checks to match contract requirements and give clear errors
    const provider = getPublicProvider(chainId);
    if (!provider) {
      throw new Error('No RPC provider available');
    }

    const registryABI = [
      'function owner() view returns (address)',
      'function initializationComplete() view returns (bool)',
    ];
    const jurySCABI = [
      'function isRegisteredProject(address) view returns (bool)',
      'function projectsLocked() view returns (bool)',
    ];

    const registry = new Contract(registryAddress, registryABI, provider);
    const jurySC = new Contract(contractAddress, jurySCABI, provider);

    const [registryOwner, initComplete] = await Promise.all([
      registry.owner(),
      registry.initializationComplete(),
    ]);

    const signerAddress = await signer.getAddress();
    const isOwner = signerAddress.toLowerCase() === registryOwner.toLowerCase();

    if (!initComplete) {
      // During initialization only registry owner can set metadata
      if (!isOwner) {
        throw new Error('Only the registry owner can update metadata during initialization');
      }
    } else {
      // After initialization: project wallet must match, and contract checks apply
      if (!isOwner) {
        if (signerAddress.toLowerCase() !== projectAddress.toLowerCase()) {
          throw new Error('Only the project wallet can update its own metadata');
        }

        const [isRegistered, locked] = await Promise.all([
          jurySC.isRegisteredProject(projectAddress),
          jurySC.projectsLocked(),
        ]);

        if (!isRegistered) {
          throw new Error('Project is not registered in the JurySC contract');
        }
        if (locked) {
          throw new Error('Metadata editing is closed (voting has started)');
        }
      }
    }

    state.update(s => ({ ...s, isSubmitting: true }));
    try {
      // Prepare metadata
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

      // Preview CID
      const cid = await metadataAPI.previewMetadata(metadata, 'project');

      // Send transaction
      const provider = signer.provider!;
      const registry = getPoBRegistryContract(chainId, provider);
      if (!registry) {
        throw new Error('Failed to get PoBRegistry contract');
      }

      const registryWithSigner = registry.connect(signer) as any;
      const txResponse = await registryWithSigner.setProjectMetadata(
        chainId,
        contractAddress,
        projectAddress,
        cid
      );

      // Get raw tx for API verification
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

      // Submit to API
      await metadataAPI.submitMetadata({
        cid,
        rawTx,
        chainId,
        contractAddress,
        projectAddress,
        kind: 'project',
        metadata,
      });

      // Update state
      state.update(s => ({
        ...s,
        pendingCID: cid,
        pendingTxHash: txResponse.hash,
        pendingConfirmations: 0,
      }));

      // Save to localStorage
      const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
      localStorage.setItem(storageKey, JSON.stringify({
        cid,
        txHash: txResponse.hash,
        timestamp: Date.now()
      }));

      // Start polling
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

    if (projectAddress && chainId && contractAddress) {
      const storageKey = `pending-metadata-${chainId}-${contractAddress}-${projectAddress}`;
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

  // Cleanup function
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

