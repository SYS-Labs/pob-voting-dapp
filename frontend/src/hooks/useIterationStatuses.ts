import { useState, useEffect, useCallback } from 'react';
import { JsonRpcProvider, Contract } from 'ethers';
import { JurySC_01ABI } from '~/abis';
import type { Iteration, IterationStatus } from '~/interfaces';

interface IterationStatusMap {
  [iterationNumber: number]: IterationStatus;
}

/**
 * Hook to manage iteration statuses as single source of truth
 * - Uses status from iterations.json if provided (for ended iterations)
 * - Otherwise loads from contract (for active/upcoming iterations)
 * - Can be updated when current iteration refreshes
 */
export function useIterationStatuses(
  iterations: Iteration[],
  provider: JsonRpcProvider | null,
  canReadData: boolean,
) {
  const [statuses, setStatuses] = useState<IterationStatusMap>({});
  const [loading, setLoading] = useState(false);

  // Load statuses for all iterations
  const loadStatuses = useCallback(async () => {
    if (!provider || !canReadData || iterations.length === 0) {
      console.log('[useIterationStatuses] Skipping load:', {
        hasProvider: !!provider,
        canReadData,
        iterationsLength: iterations.length,
      });
      return;
    }

    console.log('[useIterationStatuses] Loading statuses for', iterations.length, 'iterations');
    console.log('[useIterationStatuses] Provider network:', await provider.getNetwork());
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
          console.log(`[useIterationStatuses] Loading iteration ${iteration.iteration} from contract ${iteration.jurySC}`);
          const contract = new Contract(iteration.jurySC, JurySC_01ABI, provider);

          // Check if contract exists at address
          const code = await provider.getCode(iteration.jurySC);
          console.log(`[useIterationStatuses] Contract code length at ${iteration.jurySC}:`, code.length);

          const [isActive, votingEnded] = await Promise.all([
            contract.isActive(),
            contract.votingEnded(),
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
  }, [iterations, provider, canReadData]);

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
