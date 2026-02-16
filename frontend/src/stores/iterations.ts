import { writable, derived } from 'svelte/store';
import type { Iteration, IterationStatus } from '~/interfaces';
import { iterationsAPI, type IterationSnapshot } from '~/utils/iterations-api';
import { mergeCertNFTAddresses } from '~/utils/certNFT';

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
    entityVotes: {
      smt: (r.entityVotes as any).smt ?? r.entityVotes.devRel ?? null,
      daoHic: r.entityVotes.daoHic,
      community: r.entityVotes.community,
    },
    smtVoters: r.devRelAccount ? [r.devRelAccount] : [],
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

// Internal derived store
const selectedIterationNumber = derived(iterationsStore, $s => $s.selectedIterationNumber);

// Public derived stores
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

export async function refreshIterations(): Promise<void> {
  iterationsStore.update(s => ({ ...s, loading: true, error: null }));

  const enforceChainId = (import.meta as any).env?.VITE_CHAIN_ID
    ? Number((import.meta as any).env.VITE_CHAIN_ID)
    : null;

  try {
    const result = await iterationsAPI.getAllIterations();

    if (!result.iterations || result.iterations.length === 0) {
      iterationsStore.update(s => ({
        ...s, iterations: [], loading: false,
        error: 'No iterations available.',
      }));
      return;
    }

    // Register CertNFT addresses from API so cert utils can find them
    if (result.certNFTAddresses) {
      mergeCertNFTAddresses(result.certNFTAddresses);
    }

    const snapshots = result.iterations;
    const filteredSnapshots = enforceChainId
      ? snapshots.filter(s => s.chainId === enforceChainId)
      : snapshots;

    const apiIterations = filteredSnapshots.map(transformSnapshotToIteration);
    apiIterations.sort((a, b) => b.iteration - a.iteration);

    const statuses: Record<number, IterationStatus> = {};
    for (const it of apiIterations) {
      statuses[it.iteration] = it.status || 'upcoming';
    }
    iterationsStore.update(s => ({ ...s, iterations: apiIterations, statuses, loading: false }));
  } catch (err) {
    console.error('[Iterations] API failed:', err);
    iterationsStore.update(s => ({
      ...s,
      error: 'Unable to load iterations. Please try again later.',
      loading: false,
    }));
  }
}
