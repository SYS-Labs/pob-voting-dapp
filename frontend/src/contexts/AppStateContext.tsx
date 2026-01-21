import { createContext, useContext, useCallback, useEffect, useState, useMemo, type ReactNode } from 'react';
import { BrowserProvider, JsonRpcProvider, JsonRpcSigner } from 'ethers';
import { createProviderWithoutENS, getPublicProvider } from '~/utils/provider';
import { NETWORKS } from '~/constants/networks';
import type { Iteration, IterationStatus } from '~/interfaces';
import { getAllIterationIds, getIterationInfo, getRounds, getIterationMetadataCID, getJurySCInfo } from '~/utils/registry';
import { metadataAPI } from '~/utils/metadata-api';
import { iterationsAPI, type IterationSnapshot } from '~/utils/iterations-api';

// ============================================================================
// Types
// ============================================================================

interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  walletAddress: string | null;
  chainId: number | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
}

interface AppStateContextValue {
  // Wallet state
  wallet: WalletState;

  // Iteration data
  iterations: Iteration[];
  iterationsLoading: boolean;
  iterationsError: string | null;

  // Filtered iterations (by chainId)
  filteredIterations: Iteration[];

  // Selected iteration
  selectedIterationNumber: number | null;
  setSelectedIteration: (iteration: number | null) => void;
  currentIteration: Iteration | null;

  // Iteration statuses
  iterationStatuses: Record<number, IterationStatus>;
  updateIterationStatus: (iteration: number, status: IterationStatus) => void;
  refreshIterations: () => Promise<void>;

  // Public provider for read-only operations
  publicProvider: JsonRpcProvider | null;

  // Reset state (called on wallet/chain change)
  resetContractState: () => void;
}

// ============================================================================
// Context
// ============================================================================

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}

// ============================================================================
// Provider Component
// ============================================================================

interface AppStateProviderProps {
  children: ReactNode;
}

export function AppStateProvider({ children }: AppStateProviderProps) {
  // --------------------------------------------------------------------------
  // Wallet State
  // --------------------------------------------------------------------------
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [userDisconnected, setUserDisconnected] = useState<boolean>(() => {
    return localStorage.getItem('userDisconnected') === 'true';
  });

  // Contract state reset callback (simple trigger for now)
  const resetContractState = useCallback(() => {
    console.log('[AppState] Resetting contract state');
    // Consumers will implement their own reset logic
  }, []);

  const handleAccountsChanged = useCallback(
    (accounts: unknown) => {
      if (!Array.isArray(accounts) || accounts.some((acct) => typeof acct !== 'string')) {
        console.warn('[handleAccountsChanged] Unexpected payload:', accounts);
        setWalletAddress(null);
        setSigner(null);
        resetContractState();
        return;
      }
      if (!accounts.length) {
        setWalletAddress(null);
        setSigner(null);
        resetContractState();
        return;
      }
      const [primaryAccount] = accounts as string[];
      setUserDisconnected(false);
      localStorage.setItem('userDisconnected', 'false');
      setWalletAddress(primaryAccount);
      if (provider) {
        provider.getSigner().then((nextSigner) => setSigner(nextSigner));
      }
    },
    [provider, resetContractState],
  );

  const handleChainChanged = useCallback(
    (hexChainId: unknown) => {
      if (typeof hexChainId !== 'string') {
        console.warn('[handleChainChanged] Unexpected payload:', hexChainId);
        return;
      }
      const numericChainId = Number.parseInt(hexChainId, 16);
      setChainId(numericChainId);
      resetContractState();
    },
    [resetContractState],
  );

  const connectWallet = useCallback(async () => {
    console.log('[connectWallet] Starting wallet connection...');
    const ethereum = window.ethereum;
    if (!ethereum) {
      console.error('[connectWallet] No ethereum provider found');
      throw new Error('No injected wallet detected. Please install a Web3 wallet.');
    }
    try {
      setUserDisconnected(false);
      localStorage.setItem('userDisconnected', 'false');
      const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
      const numericChainId = Number.parseInt(hexChainId, 16);
      console.log('[connectWallet] Chain ID:', numericChainId);
      const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
      const accounts = await nextProvider.send('eth_requestAccounts', []);
      console.log('[connectWallet] Connected to account:', accounts[0]);
      setProvider(nextProvider);
      setChainId(numericChainId);
      setWalletAddress(accounts[0]);
      const nextSigner = await nextProvider.getSigner();
      setSigner(nextSigner);
      console.log('[connectWallet] Connection complete');
    } catch (walletError) {
      console.error('[connectWallet] Error:', walletError);
      throw walletError;
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    console.log('[disconnectWallet] Disconnecting...');
    setUserDisconnected(true);
    localStorage.setItem('userDisconnected', 'true');
    setWalletAddress(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    resetContractState();
    console.log('[disconnectWallet] Disconnected. State cleared.');
  }, [resetContractState]);

  // Auto-connect on mount
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum || userDisconnected) return;

    let cancelled = false;

    void (async () => {
      console.log('[Auto-connect] Checking for existing accounts...');
      try {
        const accounts = await ethereum.request<string[]>({ method: 'eth_accounts' });
        if (!accounts || !accounts.length) {
          console.log('[Auto-connect] No accounts found');
          return;
        }
        if (cancelled) return;

        console.log('[Auto-connect] Found account, restoring connection...');
        const hexChainId = await ethereum.request<string>({ method: 'eth_chainId' });
        const numericChainId = Number.parseInt(hexChainId, 16);
        const nextProvider = createProviderWithoutENS(ethereum, numericChainId);
        const nextSigner = await nextProvider.getSigner();

        if (cancelled) return;

        setProvider(nextProvider);
        setChainId(numericChainId);
        setWalletAddress(accounts[0]);
        setSigner(nextSigner);
        console.log('[Auto-connect] Restored connection');
      } catch (autoConnectError) {
        if (!cancelled) {
          console.log('[Auto-connect] Failed silently', autoConnectError);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userDisconnected]);

  // Event listeners
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum || !provider) return;

    console.log('[Event listeners] Setting up...');

    if (typeof ethereum.on === 'function') {
      ethereum.on('accountsChanged', handleAccountsChanged);
      ethereum.on('chainChanged', handleChainChanged);
    }

    return () => {
      console.log('[Event listeners] Cleaning up...');
      if (typeof ethereum.removeListener === 'function') {
        ethereum.removeListener('accountsChanged', handleAccountsChanged);
        ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [provider, handleAccountsChanged, handleChainChanged]);

  // --------------------------------------------------------------------------
  // Iterations State
  // --------------------------------------------------------------------------
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [iterationsLoading, setIterationsLoading] = useState<boolean>(true);
  const [iterationsError, setIterationsError] = useState<string | null>(null);

  /**
   * Transform API snapshot to Iteration object
   */
  const transformSnapshotToIteration = useCallback((snapshot: IterationSnapshot): Iteration => {
    // Extract name from first project's metadata if available, or use default
    const name = `Iteration #${snapshot.iterationId}`;

    // Map juryState to IterationStatus
    let status: IterationStatus;
    if (snapshot.juryState === 'active') {
      status = 'active';
    } else if (snapshot.juryState === 'ended' || snapshot.juryState === 'locked') {
      status = 'ended';
    } else {
      status = 'upcoming';
    }

    // Map previous rounds from API (include full voting data)
    const prev_rounds = snapshot.prevRounds?.map(r => ({
      round: r.round,
      jurySC: r.jurySC,
      pob: r.pob,
      version: r.version,
      deployBlockHint: r.deployBlockHint,
      votingMode: r.votingMode,
      juryState: r.juryState,
      winner: r.winner,
      entityVotes: r.entityVotes,
      daoHicIndividualVotes: r.daoHicIndividualVotes,
      projects: r.projects,
    })) || [];

    return {
      iteration: snapshot.iterationId,
      chainId: snapshot.chainId,
      jurySC: snapshot.juryAddress,
      pob: snapshot.pobAddress,
      name,
      version: '002',
      deployBlockHint: snapshot.deployBlockHint,
      round: snapshot.round,
      votingMode: snapshot.votingMode,
      status, // Include status from API juryState
      prev_rounds,
    };
  }, []);

  /**
   * Load iterations from API, falling back to RPC on failure
   */
  const refreshIterations = useCallback(async () => {
    setIterationsLoading(true);
    setIterationsError(null);

    const enforceChainId = import.meta.env.VITE_CHAIN_ID ? Number(import.meta.env.VITE_CHAIN_ID) : null;

    // Try API first
    console.log('[Iterations] Trying API...');
    try {
      const snapshots = await iterationsAPI.getAllIterations();

      if (snapshots && snapshots.length > 0) {
        // Filter by enforced chain if set
        const filteredSnapshots = enforceChainId
          ? snapshots.filter(s => s.chainId === enforceChainId)
          : snapshots;

        const apiIterations = filteredSnapshots.map(transformSnapshotToIteration);
        apiIterations.sort((a, b) => b.iteration - a.iteration);
        setIterations(apiIterations);
        setIterationsLoading(false);
        console.log('[Iterations] Loaded from API:', apiIterations.length);
        return;
      }
      console.log('[Iterations] No snapshots from API, falling back to RPC');
    } catch (apiErr) {
      console.warn('[Iterations] API failed, falling back to RPC:', apiErr);
    }

    // Fall back to RPC
    try {
      const supportedChainIds = enforceChainId
        ? [enforceChainId]
        : Object.keys(NETWORKS).map(Number);
      const allIterations: Iteration[] = [];

      console.log('[Iterations] Loading from PoBRegistry via RPC', enforceChainId ? `(enforced chainId: ${enforceChainId})` : '(all chains)');

      for (const chainId of supportedChainIds) {
        const provider = getPublicProvider(chainId);
        if (!provider) continue;

        // Get all iteration IDs from registry for this chain
        const iterationIds = await getAllIterationIds(chainId, provider);

        for (const iterationId of iterationIds) {
          // Get iteration info
          const info = await getIterationInfo(iterationId, chainId, provider);
          if (!info) continue;

          // Get all rounds for this iteration
          const rounds = await getRounds(iterationId, chainId, provider);

          if (rounds.length === 0) {
            allIterations.push({
              iteration: iterationId,
              chainId: chainId,
              jurySC: '',
              pob: '',
              name: info.name || `Iteration #${iterationId}`,
              version: '002',
              round: undefined,
              prev_rounds: [],
            });
            continue;
          }

          // Get latest round (highest roundId)
          const latestRound = rounds.reduce((max, r) =>
            r.roundId > max.roundId ? r : max
          );

          // Fetch PoB and votingMode from JurySC contract
          const jurySCInfo = await getJurySCInfo(latestRound.jurySC, provider);
          if (!jurySCInfo) {
            console.warn(`[Iterations] Failed to fetch JurySC info for iteration ${iterationId}, using defaults`);
          }

          // Get iteration metadata CID
          const iterCID = await getIterationMetadataCID(
            chainId,
            latestRound.jurySC,
            provider
          );

          // Fetch metadata from API if CID exists
          let metadata = null;
          if (iterCID) {
            try {
              const batch = await metadataAPI.batchGetByCIDs([iterCID]);
              metadata = batch[iterCID];
            } catch (err) {
              console.warn(`[Iterations] Failed to fetch metadata for iteration ${iterationId}:`, err);
            }
          }

          // Fetch JurySC info for all previous rounds in parallel
          const prevRoundsWithInfo = await Promise.all(
            rounds
              .filter(r => r.roundId < latestRound.roundId)
              .map(async (r) => {
                const prevJurySCInfo = await getJurySCInfo(r.jurySC, provider);
                return {
                  round: r.roundId,
                  jurySC: r.jurySC,
                  pob: prevJurySCInfo?.pob || '',
                  version: '001', // Historical
                  deployBlockHint: r.deployBlockHint,
                  votingMode: prevJurySCInfo?.votingMode ?? 0,
                };
              })
          );

          // Build iteration object
          allIterations.push({
            iteration: iterationId,
            chainId: chainId,
            jurySC: latestRound.jurySC,
            pob: jurySCInfo?.pob || '',
            name: metadata?.name || info.name || `Iteration #${iterationId}`,
            version: '002',
            deployBlockHint: latestRound.deployBlockHint,
            link: metadata?.link,
            round: latestRound.roundId,
            votingMode: jurySCInfo?.votingMode ?? 0,
            prev_rounds: prevRoundsWithInfo,
          });
        }
      }

      allIterations.sort((a, b) => b.iteration - a.iteration);
      setIterations(allIterations);
      setIterationsLoading(false);
      console.log('[Iterations] Loaded from registry:', allIterations.length);
    } catch (err) {
      console.error('[Iterations] Failed to load from registry', err);
      setIterationsError(err instanceof Error ? err.message : 'Failed to load');
      setIterationsLoading(false);
    }
  }, [transformSnapshotToIteration]);

  // Load iterations from PoBRegistry via RPC
  useEffect(() => {
    void refreshIterations();
  }, [refreshIterations]);

  // --------------------------------------------------------------------------
  // Project Metadata State
  // NOTE: Project metadata is now loaded per-iteration in useContractState
  // This global state is removed as part of the PoBRegistry migration
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Iteration Selection & Filtering
  // --------------------------------------------------------------------------
  const [selectedIterationNumber, setSelectedIterationInternal] = useState<number | null>(() => {
    // Try to restore from localStorage
    const stored = localStorage.getItem('selectedIteration');
    return stored ? parseInt(stored, 10) : null;
  });

  const setSelectedIteration = useCallback((iteration: number | null) => {
    setSelectedIterationInternal(iteration);
    if (iteration !== null) {
      localStorage.setItem('selectedIteration', iteration.toString());
    } else {
      localStorage.removeItem('selectedIteration');
    }
  }, []);

  const filteredIterations = useMemo(() => {
    // Don't filter by wallet chainId - iterations can be on any network
    // Each iteration uses its own public RPC provider regardless of wallet network
    return iterations;
  }, [iterations]);

  const usableIterations = useMemo(() => {
    return filteredIterations.filter((iteration) => {
      return Boolean(iteration.jurySC && iteration.pob && iteration.round);
    });
  }, [filteredIterations]);

  const currentIteration = useMemo(() => {
    if (!usableIterations.length) return null;
    if (selectedIterationNumber === null) return usableIterations[0];
    return (
      usableIterations.find((iteration) => iteration.iteration === selectedIterationNumber) ?? usableIterations[0]
    );
  }, [usableIterations, selectedIterationNumber]);

  // Auto-adjust selection when filtered list changes
  useEffect(() => {
    if (!usableIterations.length) {
      if (selectedIterationNumber !== null) {
        setSelectedIteration(null);
      }
      return;
    }
    if (
      selectedIterationNumber !== null &&
      !usableIterations.some((iteration) => iteration.iteration === selectedIterationNumber)
    ) {
      setSelectedIteration(usableIterations[0].iteration);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usableIterations, selectedIterationNumber]);

  // --------------------------------------------------------------------------
  // Iteration Statuses
  // --------------------------------------------------------------------------
  const [iterationStatuses, setIterationStatuses] = useState<Record<number, IterationStatus>>({});

  const updateIterationStatus = useCallback((iteration: number, status: IterationStatus) => {
    console.log(`[AppState] Updating status for iteration ${iteration}:`, status);
    setIterationStatuses((prev) => ({
      ...prev,
      [iteration]: status,
    }));
  }, []);

  // --------------------------------------------------------------------------
  // Public Provider
  // --------------------------------------------------------------------------
  const readChainId = currentIteration?.chainId ?? chainId;
  const publicProvider = useMemo(() => {
    if (!readChainId) return null;
    const network = NETWORKS[readChainId];
    if (!network) {
      console.warn('[PublicProvider] No network config for chainId:', readChainId);
      return null;
    }
    console.log('[PublicProvider] Creating provider for', network.name, 'chainId:', readChainId);
    return new JsonRpcProvider(network.rpcUrl, readChainId, { staticNetwork: true });
  }, [readChainId]);

  // --------------------------------------------------------------------------
  // Context Value
  // --------------------------------------------------------------------------
  const value: AppStateContextValue = {
    wallet: {
      provider,
      signer,
      walletAddress,
      chainId,
      connectWallet,
      disconnectWallet,
    },
    iterations,
    iterationsLoading,
    iterationsError,
    filteredIterations,
    selectedIterationNumber,
    setSelectedIteration,
    currentIteration,
    iterationStatuses,
    updateIterationStatus,
    refreshIterations,
    publicProvider,
    resetContractState,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
