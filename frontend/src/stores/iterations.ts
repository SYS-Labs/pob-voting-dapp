import { writable, derived, get } from 'svelte/store';
import { JsonRpcProvider, Contract } from 'ethers';
import type { Iteration, IterationStatus } from '~/interfaces';
import { NETWORKS } from '~/constants/networks';
import {
  getAllIterationIds,
  getIterationInfo,
  getRounds,
  getIterationMetadataCID,
  getJurySCInfo,
} from '~/utils/registry';
import { metadataAPI } from '~/utils/metadata-api';
import { iterationsAPI, type IterationSnapshot } from '~/utils/iterations-api';
import { getPublicProvider } from '~/utils/provider';
import { JurySC_01ABI } from '~/abis';
import JurySC_01_v001_ABI from '~/abis/JurySC_01_v001.json';
import JurySC_01_v002_ABI from '~/abis/JurySC_01_v002.json';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';

// ============================================================================
// Types
// ============================================================================

interface IterationsState {
  iterations: Iteration[];
  loading: boolean;
  error: string | null;
  selectedIterationNumber: number | null;
  statuses: Record<number, IterationStatus>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getJurySCABI(iteration: Iteration | null) {
  if (!iteration) return JurySC_01ABI;
  if (iteration.version === '001') return JurySC_01_v001_ABI;
  return JurySC_01_v002_ABI;
}

function transformSnapshotToIteration(snapshot: IterationSnapshot): Iteration {
  const name = `Iteration #${snapshot.iterationId}`;

  let status: IterationStatus;
  if (snapshot.juryState === 'active') {
    status = 'active';
  } else if (snapshot.juryState === 'ended' || snapshot.juryState === 'locked') {
    status = 'ended';
  } else {
    status = 'upcoming';
  }

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
    devRelAccount: r.devRelAccount,
    daoHicVoters: r.daoHicVoters,
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
    status,
    prev_rounds,
  };
}

// ============================================================================
// Store
// ============================================================================

const initialState: IterationsState = {
  iterations: [],
  loading: true,
  error: null,
  selectedIterationNumber: (() => {
    const stored = localStorage.getItem('selectedIteration');
    return stored ? parseInt(stored, 10) : null;
  })(),
  statuses: {},
};

export const iterationsStore = writable<IterationsState>(initialState);

// Derived stores
export const iterations = derived(iterationsStore, $s => $s.iterations);
export const iterationsLoading = derived(iterationsStore, $s => $s.loading);
export const iterationsError = derived(iterationsStore, $s => $s.error);
export const selectedIterationNumber = derived(iterationsStore, $s => $s.selectedIterationNumber);
export const iterationStatuses = derived(iterationsStore, $s => $s.statuses);

// Filtered iterations (usable ones with contracts set up)
export const usableIterations = derived(iterationsStore, $s =>
  $s.iterations.filter(it => Boolean(it.jurySC && it.pob && it.round))
);

export const currentIteration = derived(
  [usableIterations, selectedIterationNumber],
  ([$usable, $selected]) => {
    if (!$usable.length) return null;
    if ($selected === null) return $usable[0];
    return $usable.find(it => it.iteration === $selected) ?? $usable[0];
  }
);

// ============================================================================
// Actions
// ============================================================================

export function setSelectedIteration(iterationNumber: number | null): void {
  iterationsStore.update(s => ({ ...s, selectedIterationNumber: iterationNumber }));
  if (iterationNumber !== null) {
    localStorage.setItem('selectedIteration', iterationNumber.toString());
  } else {
    localStorage.removeItem('selectedIteration');
  }
}

export function updateIterationStatus(iterationNumber: number, status: IterationStatus): void {
  console.log(`[Iterations] Updating status for iteration ${iterationNumber}:`, status);
  iterationsStore.update(s => ({
    ...s,
    statuses: { ...s.statuses, [iterationNumber]: status },
  }));
}

export async function loadIterationStatuses(): Promise<void> {
  const state = get(iterationsStore);
  const { iterations } = state;

  if (iterations.length === 0) return;

  console.log('[loadIterationStatuses] Starting for', iterations.length, 'iterations');

  // Create providers for each unique chainId
  const providersByChain: Record<number, JsonRpcProvider> = {};
  const uniqueChains = new Set(iterations.map(it => it.chainId));

  for (const chainId of uniqueChains) {
    const network = NETWORKS[chainId];
    if (network) {
      providersByChain[chainId] = new JsonRpcProvider(network.rpcUrl, chainId, { staticNetwork: true });
    }
  }

  const newStatuses: Record<number, IterationStatus> = {};

  await Promise.all(
    iterations.map(async (iteration) => {
      if (!iteration.jurySC || !iteration.round) {
        newStatuses[iteration.iteration] = 'upcoming';
        return;
      }

      // Use status from JSON if provided
      if (iteration.status) {
        newStatuses[iteration.iteration] = iteration.status;
        return;
      }

      // Load from contract
      try {
        const provider = providersByChain[iteration.chainId];
        if (!provider) {
          newStatuses[iteration.iteration] = 'upcoming';
          return;
        }

        const contract = new Contract(iteration.jurySC, getJurySCABI(iteration), provider);
        const [isActive, votingEnded] = await cachedPromiseAll(provider, iteration.chainId, [
          { key: `iteration:${iteration.iteration}:isActive`, promise: contract.isActive() },
          { key: `iteration:${iteration.iteration}:votingEnded`, promise: contract.votingEnded() },
        ]);

        if (votingEnded) {
          newStatuses[iteration.iteration] = 'ended';
        } else if (isActive) {
          newStatuses[iteration.iteration] = 'active';
        } else {
          newStatuses[iteration.iteration] = 'upcoming';
        }
      } catch (error) {
        console.warn(`[loadIterationStatuses] Failed for iteration ${iteration.iteration}:`, error);
        newStatuses[iteration.iteration] = 'upcoming';
      }
    })
  );

  iterationsStore.update(s => ({ ...s, statuses: { ...s.statuses, ...newStatuses } }));
  console.log('[loadIterationStatuses] Complete:', newStatuses);
}

export async function refreshIterations(): Promise<void> {
  iterationsStore.update(s => ({ ...s, loading: true, error: null }));

  const enforceChainId = (import.meta as any).env?.VITE_CHAIN_ID
    ? Number((import.meta as any).env.VITE_CHAIN_ID)
    : null;

  // Try API first
  console.log('[Iterations] Trying API...');
  try {
    const snapshots = await iterationsAPI.getAllIterations();

    if (snapshots && snapshots.length > 0) {
      const filteredSnapshots = enforceChainId
        ? snapshots.filter(s => s.chainId === enforceChainId)
        : snapshots;

      const apiIterations = filteredSnapshots.map(transformSnapshotToIteration);
      apiIterations.sort((a, b) => b.iteration - a.iteration);

      iterationsStore.update(s => ({ ...s, iterations: apiIterations, loading: false }));
      console.log('[Iterations] Loaded from API:', apiIterations.length);

      // Load statuses after iterations are loaded
      await loadIterationStatuses();
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

    console.log('[Iterations] Loading from PoBRegistry via RPC');

    for (const chainId of supportedChainIds) {
      const provider = getPublicProvider(chainId);
      if (!provider) continue;

      const iterationIds = await getAllIterationIds(chainId, provider);

      for (const iterationId of iterationIds) {
        const info = await getIterationInfo(iterationId, chainId, provider);
        if (!info) continue;

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

        const latestRound = rounds.reduce((max, r) =>
          r.roundId > max.roundId ? r : max
        );

        const jurySCInfo = await getJurySCInfo(latestRound.jurySC, provider);
        const iterCID = await getIterationMetadataCID(chainId, latestRound.jurySC, provider);

        let metadata = null;
        if (iterCID) {
          try {
            const batch = await metadataAPI.batchGetByCIDs([iterCID]);
            metadata = batch[iterCID];
          } catch (err) {
            console.warn(`[Iterations] Failed to fetch metadata for iteration ${iterationId}:`, err);
          }
        }

        const prevRoundsWithInfo = await Promise.all(
          rounds
            .filter(r => r.roundId < latestRound.roundId)
            .map(async (r) => {
              const prevJurySCInfo = await getJurySCInfo(r.jurySC, provider);
              return {
                round: r.roundId,
                jurySC: r.jurySC,
                pob: prevJurySCInfo?.pob || '',
                version: '001',
                deployBlockHint: r.deployBlockHint,
                votingMode: prevJurySCInfo?.votingMode ?? 0,
              };
            })
        );

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
    iterationsStore.update(s => ({ ...s, iterations: allIterations, loading: false }));
    console.log('[Iterations] Loaded from registry:', allIterations.length);

    // Load statuses after iterations are loaded
    await loadIterationStatuses();
  } catch (err) {
    console.error('[Iterations] Failed to load from registry', err);
    iterationsStore.update(s => ({
      ...s,
      error: err instanceof Error ? err.message : 'Failed to load',
      loading: false,
    }));
  }
}
