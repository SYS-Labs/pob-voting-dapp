import { useState, useEffect, useCallback, useMemo } from 'react';
import { JsonRpcProvider, Contract } from 'ethers';
import { JurySC_01ABI } from '~/abis';
import JurySC_01_v001_ABI from '~/abis/JurySC_01_v001.json';
import JurySC_01_v002_ABI from '~/abis/JurySC_01_v002.json';
import { NETWORKS } from '~/constants/networks';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';
import type { Iteration, IterationStatus } from '~/interfaces';

interface IterationStatusMap {
  [iterationNumber: number]: IterationStatus;
}

// Helper to select ABI based on iteration version
function getJurySCABI(iteration: Iteration | null) {
  if (!iteration) return JurySC_01ABI; // Default to latest
  if (iteration.version === '001') return JurySC_01_v001_ABI;
  return JurySC_01_v002_ABI; // Default to v002 for "002" and any future versions
}

/**
 * Hook to manage iteration statuses as single source of truth
 * - Uses status from iterations.json if provided (for ended iterations)
 * - Otherwise loads from contract (for active/upcoming iterations)
 * - Can be updated when current iteration refreshes
 */
export function useIterationStatuses(
  iterations: Iteration[],
  _provider: JsonRpcProvider | null, // Kept for backward compatibility but not used
  canReadData: boolean,
) {
  const [statuses, setStatuses] = useState<IterationStatusMap>({});
  const [loading, setLoading] = useState(false);

  // Create providers for each unique chainId
  const providersByChain = useMemo(() => {
    const providers: Record<number, JsonRpcProvider> = {};
    const uniqueChains = new Set(iterations.map(it => it.chainId));

    for (const chainId of uniqueChains) {
      const network = NETWORKS[chainId];
      if (network) {
        providers[chainId] = new JsonRpcProvider(network.rpcUrl, chainId, { staticNetwork: true });
      }
    }

    return providers;
  }, [iterations]);

  // Load statuses for all iterations
  const loadStatuses = useCallback(async () => {
    console.log('[useIterationStatuses] loadStatuses called -', {
      canReadData,
      iterationsLength: iterations.length,
      iterations: iterations.map(it => ({ iteration: it.iteration, round: it.round, chainId: it.chainId, version: it.version })),
      providersByChainKeys: Object.keys(providersByChain),
    });

    if (!canReadData || iterations.length === 0) {
      console.log('[useIterationStatuses] Skipping load - canReadData:', canReadData, 'iterations.length:', iterations.length);
      return;
    }

    console.log('[useIterationStatuses] Starting status load for', iterations.length, 'iterations');
    setLoading(true);

    const newStatuses: IterationStatusMap = {};

    // Process all iterations
    await Promise.all(
      iterations.map(async (iteration) => {
        // If status is in JSON, use it (no need to query contract)
        if (iteration.status) {
          console.log(`[useIterationStatuses] Using JSON status for iteration ${iteration.iteration}:`, iteration.status);
          newStatuses[iteration.iteration] = iteration.status;
          return;
        }

        // Otherwise, load from contract
        try {
          const provider = providersByChain[iteration.chainId];
          if (!provider) {
            console.warn(`[useIterationStatuses] No provider for chainId ${iteration.chainId}`);
            newStatuses[iteration.iteration] = 'upcoming';
            return;
          }

          console.log(`[useIterationStatuses] Loading iteration ${iteration.iteration} from contract ${iteration.jurySC} on chain ${iteration.chainId} with version ${iteration.version || 'latest'}`);
          const contract = new Contract(iteration.jurySC, getJurySCABI(iteration), provider);

          const [isActive, votingEnded] = await cachedPromiseAll(provider, iteration.chainId, [
            { key: `iteration:${iteration.iteration}:isActive`, promise: contract.isActive() },
            { key: `iteration:${iteration.iteration}:votingEnded`, promise: contract.votingEnded() },
          ]);

          console.log(`[useIterationStatuses] Iteration ${iteration.iteration} contract responses:`, {
            isActive,
            votingEnded,
          });

          let status: IterationStatus = 'upcoming';
          if (votingEnded) {
            status = 'ended';
          } else if (isActive) {
            status = 'active';
          }

          console.log(`[useIterationStatuses] Loaded status for iteration ${iteration.iteration} from contract:`, status);
          newStatuses[iteration.iteration] = status;
        } catch (error) {
          console.warn(`[useIterationStatuses] Failed to load status for iteration ${iteration.iteration}:`, error);
          // Default to upcoming on error
          newStatuses[iteration.iteration] = 'upcoming';
        }
      }),
    );

    setStatuses(newStatuses);
    setLoading(false);
    console.log('[useIterationStatuses] All statuses loaded:', newStatuses);
  }, [iterations, providersByChain, canReadData]);

  // Update status for a specific iteration (when refreshing current iteration)
  const updateIterationStatus = useCallback((iterationNumber: number, status: IterationStatus) => {
    console.log(`[useIterationStatuses] Updating status for iteration ${iterationNumber}:`, status);
    setStatuses((prev) => ({
      ...prev,
      [iterationNumber]: status,
    }));
  }, []);

  // Load statuses on mount and when iterations/provider changes
  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  return {
    statuses,
    loading,
    updateIterationStatus,
    reloadStatuses: loadStatuses,
  };
}
