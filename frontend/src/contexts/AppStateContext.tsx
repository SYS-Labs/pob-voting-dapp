import { createContext, useContext, useCallback, useEffect, useState, useMemo, type ReactNode } from 'react';
import { BrowserProvider, JsonRpcProvider, JsonRpcSigner } from 'ethers';
import { createProviderWithoutENS } from '~/utils/provider';
import { NETWORKS } from '~/constants/networks';
import type { Iteration, IterationStatus, ProjectMetadata } from '~/interfaces';

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

  // Project metadata
  projectMetadata: Record<string, ProjectMetadata>;
  projectMetadataLoading: boolean;

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

  useEffect(() => {
    const isProduction = import.meta.env.PROD;
    setIterationsLoading(true);
    setIterationsError(null);

    if (isProduction) {
      console.log('[Iterations] Loading from iterations.json (production)');
      fetch('/iterations.json')
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load iterations.json: ${res.status}`);
          return res.json();
        })
        .then((data: Iteration[]) => {
          setIterations(data);
          setIterationsLoading(false);
          console.log('[Iterations] Loaded', data.length, 'iterations');
        })
        .catch((err) => {
          console.error('[Iterations] Failed to load iterations', err);
          setIterationsError(err.message || 'Failed to load iterations manifest.');
          setIterationsLoading(false);
        });
    } else {
      fetch('/iterations.local.json')
        .then((res) => {
          if (res.ok) {
            console.log('[Iterations] Loading from iterations.local.json (dev mode)');
            return res.json();
          }
          throw new Error('Local config not found');
        })
        .catch(() => {
          console.log('[Iterations] Loading from iterations.json (fallback)');
          return fetch('/iterations.json').then((res) => {
            if (!res.ok) throw new Error(`Failed to load iterations.json: ${res.status}`);
            return res.json();
          });
        })
        .then((data: Iteration[]) => {
          setIterations(data);
          setIterationsLoading(false);
          console.log('[Iterations] Loaded', data.length, 'iterations');
        })
        .catch((err) => {
          console.error('[Iterations] Failed to load iterations', err);
          setIterationsError(err.message || 'Failed to load iterations manifest.');
          setIterationsLoading(false);
        });
    }
  }, []);

  // --------------------------------------------------------------------------
  // Project Metadata State
  // --------------------------------------------------------------------------
  const [projectMetadata, setProjectMetadata] = useState<Record<string, ProjectMetadata>>({});
  const [projectMetadataLoading, setProjectMetadataLoading] = useState<boolean>(true);

  useEffect(() => {
    const isProduction = import.meta.env.PROD;

    const loadProjectMetadata = async (): Promise<ProjectMetadata[]> => {
      if (isProduction) {
        console.log('[Projects] Loading metadata from projects.json (production)');
        const response = await fetch('/projects.json');
        if (!response.ok) throw new Error(`Failed to load projects.json: ${response.status}`);
        return (await response.json()) as ProjectMetadata[];
      } else {
        try {
          const localResponse = await fetch('/projects.local.json');
          if (!localResponse.ok) throw new Error(`projects.local.json responded with ${localResponse.status}`);
          console.log('[Projects] Loading metadata from projects.local.json (dev mode)');
          return (await localResponse.json()) as ProjectMetadata[];
        } catch (localError) {
          console.log('[Projects] Fallback to projects.json', localError);
          const response = await fetch('/projects.json');
          if (!response.ok) throw new Error(`Failed to load projects.json: ${response.status}`);
          return (await response.json()) as ProjectMetadata[];
        }
      }
    };

    setProjectMetadataLoading(true);
    loadProjectMetadata()
      .then((entries) => {
        const map: Record<string, ProjectMetadata> = {};
        entries.forEach((entry) => {
          if (!entry?.account) return;
          const key = `${entry.chainId}:${entry.account.toLowerCase()}`;
          map[key] = entry;
        });
        setProjectMetadata(map);
        setProjectMetadataLoading(false);
        console.log('[Projects] Loaded metadata entries:', Object.keys(map).length);
      })
      .catch((metadataError) => {
        console.error('[Projects] Failed to load metadata', metadataError);
        setProjectMetadataLoading(false);
      });
  }, []);

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
    if (chainId === null) return iterations;
    return iterations.filter((iteration) => iteration.chainId === chainId);
  }, [iterations, chainId]);

  const currentIteration = useMemo(() => {
    if (!filteredIterations.length) return null;
    if (selectedIterationNumber === null) return filteredIterations[0];
    return (
      filteredIterations.find((iteration) => iteration.iteration === selectedIterationNumber) ?? filteredIterations[0]
    );
  }, [filteredIterations, selectedIterationNumber]);

  // Auto-adjust selection when filtered list changes
  useEffect(() => {
    if (!filteredIterations.length) {
      if (selectedIterationNumber !== null) {
        setSelectedIteration(null);
      }
      return;
    }
    if (
      selectedIterationNumber !== null &&
      !filteredIterations.some((iteration) => iteration.iteration === selectedIterationNumber)
    ) {
      setSelectedIteration(filteredIterations[0].iteration);
    }
  }, [filteredIterations, selectedIterationNumber, setSelectedIteration]);

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
    projectMetadata,
    projectMetadataLoading,
    publicProvider,
    resetContractState,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
