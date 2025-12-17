import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Project, IterationStatus } from '~/interfaces';

// ============================================================================
// Types
// ============================================================================

interface EntityVotes {
  devRel: string | null;
  daoHic: string | null;
  community: string | null;
}

interface IterationData {
  projects: Project[];
  entityVotes: EntityVotes;
  winner: { projectAddress: string | null; hasWinner: boolean };
  votingMode: number;
  projectScores: {
    addresses: string[];
    scores: bigint[];
    totalPossible: bigint;
  } | null;
  statusFlags: { isActive: boolean; votingEnded: boolean };
  iterationTimes: { startTime: number | null; endTime: number | null };
  voteCounts: { devRel: number; daoHic: number; community: number };
  devRelAccount: string | null;
  daoHicVoters: string[];
  projectsLocked: boolean;
  contractLocked: boolean;
}

interface IterationDataCache {
  [iterationNumber: number]: IterationData | undefined;
}

interface IterationDataContextValue {
  // Get cached data for an iteration
  getIterationData: (iteration: number) => IterationData | null;

  // Set data for an iteration
  setIterationData: (iteration: number, data: Partial<IterationData>) => void;

  // Clear cache for an iteration
  clearIterationData: (iteration: number) => void;

  // Clear all cache
  clearAllData: () => void;

  // Persist to localStorage (for ended iterations)
  persistIterationData: (iteration: number, status: IterationStatus) => void;

  // Load from localStorage
  loadPersistedData: (iteration: number) => IterationData | null;
}

// ============================================================================
// Context
// ============================================================================

const IterationDataContext = createContext<IterationDataContextValue | null>(null);

export function useIterationData() {
  const context = useContext(IterationDataContext);
  if (!context) {
    throw new Error('useIterationData must be used within IterationDataProvider');
  }
  return context;
}

// ============================================================================
// localStorage Utilities
// ============================================================================

const CACHE_VERSION = 1;
const STORAGE_KEY = 'pob_iteration_cache';
const VERSION_KEY = 'pob_cache_version';

function getStorageKey(iteration: number): string {
  return `${STORAGE_KEY}:${iteration}`;
}

function getCacheVersion(): number {
  const stored = localStorage.getItem(VERSION_KEY);
  return stored ? parseInt(stored, 10) : 0;
}

function setCacheVersion(): void {
  localStorage.setItem(VERSION_KEY, CACHE_VERSION.toString());
}

function clearOldCache(): void {
  const currentVersion = getCacheVersion();
  if (currentVersion < CACHE_VERSION) {
    console.log('[IterationDataCache] Cache version mismatch, clearing old cache');
    // Clear all iteration cache keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    setCacheVersion();
  }
}

// ============================================================================
// Provider Component
// ============================================================================

interface IterationDataProviderProps {
  children: ReactNode;
}

export function IterationDataProvider({ children }: IterationDataProviderProps) {
  // In-memory cache
  const [cache, setCache] = useState<IterationDataCache>({});

  // Clear old cache on mount
  useState(() => {
    clearOldCache();
  });

  const getIterationData = useCallback(
    (iteration: number): IterationData | null => {
      return cache[iteration] || null;
    },
    [cache],
  );

  const setIterationData = useCallback((iteration: number, data: Partial<IterationData>) => {
    setCache((prev) => ({
      ...prev,
      [iteration]: {
        ...(prev[iteration] || {
          projects: [],
          entityVotes: { devRel: null, daoHic: null, community: null },
          winner: { projectAddress: null, hasWinner: false },
          votingMode: 0,
          projectScores: null,
          statusFlags: { isActive: false, votingEnded: false },
          iterationTimes: { startTime: null, endTime: null },
          voteCounts: { devRel: 0, daoHic: 0, community: 0 },
          devRelAccount: null,
          daoHicVoters: [],
          projectsLocked: false,
          contractLocked: false,
        }),
        ...data,
      },
    }));
  }, []);

  const clearIterationData = useCallback((iteration: number) => {
    setCache((prev) => {
      const next = { ...prev };
      delete next[iteration];
      return next;
    });
    // Also clear from localStorage
    localStorage.removeItem(getStorageKey(iteration));
  }, []);

  const clearAllData = useCallback(() => {
    setCache({});
    // Clear all localStorage cache
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }, []);

  const persistIterationData = useCallback(
    (iteration: number, status: IterationStatus) => {
      // Only persist ended iterations (immutable data)
      if (status !== 'ended') {
        console.log(`[IterationDataCache] Not persisting iteration ${iteration} - status is ${status}`);
        return;
      }

      const data = cache[iteration];
      if (!data) {
        console.log(`[IterationDataCache] No data to persist for iteration ${iteration}`);
        return;
      }

      try {
        // Convert bigint to string for JSON serialization
        const serializable = {
          ...data,
          projectScores: data.projectScores
            ? {
                addresses: data.projectScores.addresses,
                scores: data.projectScores.scores.map((s) => s.toString()),
                totalPossible: data.projectScores.totalPossible.toString(),
              }
            : null,
        };

        localStorage.setItem(getStorageKey(iteration), JSON.stringify(serializable));
        console.log(`[IterationDataCache] Persisted data for ended iteration ${iteration}`);
      } catch (error) {
        console.warn(`[IterationDataCache] Failed to persist iteration ${iteration}:`, error);
      }
    },
    [cache],
  );

  const loadPersistedData = useCallback((iteration: number): IterationData | null => {
    try {
      const stored = localStorage.getItem(getStorageKey(iteration));
      if (!stored) return null;

      const parsed = JSON.parse(stored);

      // Convert string back to bigint
      if (parsed.projectScores) {
        parsed.projectScores = {
          addresses: parsed.projectScores.addresses,
          scores: parsed.projectScores.scores.map((s: string) => BigInt(s)),
          totalPossible: BigInt(parsed.projectScores.totalPossible),
        };
      }

      console.log(`[IterationDataCache] Loaded persisted data for iteration ${iteration}`);
      return parsed as IterationData;
    } catch (error) {
      console.warn(`[IterationDataCache] Failed to load persisted data for iteration ${iteration}:`, error);
      return null;
    }
  }, []);

  const value: IterationDataContextValue = {
    getIterationData,
    setIterationData,
    clearIterationData,
    clearAllData,
    persistIterationData,
    loadPersistedData,
  };

  return <IterationDataContext.Provider value={value}>{children}</IterationDataContext.Provider>;
}
