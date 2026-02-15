import { writable, derived, get } from 'svelte/store';
import { Contract, Interface, JsonRpcProvider, type JsonRpcSigner, ethers } from 'ethers';
import { PoB_01ABI, IVersionAdapterABI } from '~/abis';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';
import { batchGetProjectMetadataCIDs } from '~/utils/registry';
import { resolveAdapter } from '~/utils/adapterResolver';
import { metadataAPI } from '~/utils/metadata-api';
import { iterationsAPI, type IterationSnapshot } from '~/utils/iterations-api';
import { getTransactionContext } from './registry';
import type {
  Badge,
  Iteration,
  PageType,
  ParticipantRole,
  Project,
  ProjectMetadata,
} from '~/interfaces';

// ============================================================================
// Types
// ============================================================================

interface EntityVotes {
  smt: string | null;
  daoHic: string | null;
  community: string | null;
}

interface RoleStatuses {
  community: boolean;
  smt: boolean;
  dao_hic: boolean;
  project: boolean;
}

export interface CommunityBadgeState extends Badge {
  hasVoted: boolean;
  vote: string | null;
}

interface ContractState {
  roles: RoleStatuses;
  rolesLoading: boolean;
  isOwner: boolean;
  projects: Project[];
  smtVoters: string[];
  smtIndividualVotes: Record<string, string>;
  daoHicVoters: string[];
  daoHicIndividualVotes: Record<string, string>;
  projectsLocked: boolean;
  contractLocked: boolean;
  voteCounts: { smt: number; daoHic: number; community: number };
  totalCommunityVoters: number;
  entityVotes: EntityVotes;
  badges: Badge[];
  communityBadges: CommunityBadgeState[];
  smtVote: string | null;
  daoHicVote: string | null;
  winner: { projectAddress: string | null; hasWinner: boolean };
  votingMode: number;
  projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null;
  statusFlags: { isActive: boolean; votingEnded: boolean };
  iterationTimes: { startTime: number | null; endTime: number | null };
  loading: boolean;
  hasLoadError: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

// Entity IDs for IVersionAdapter
const ENTITY_SMT = 0;
const ENTITY_DAO_HIC = 1;

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value) return null;
  if (value === ethers.ZeroAddress) return null;
  return value;
}

/**
 * Resolve IVersionAdapter for a given iteration.
 * Returns the adapter Contract and jurySC address, or null if resolution fails.
 */
async function getAdapter(
  currentIteration: Iteration,
  provider: JsonRpcProvider
): Promise<{ adapter: Contract; jurySC: string } | null> {
  const roundId = currentIteration.round ?? 1;
  return resolveAdapter(
    currentIteration.chainId,
    currentIteration.iteration,
    roundId,
    provider
  );
}

// ============================================================================
// Store
// ============================================================================

const initialState: ContractState = {
  roles: { community: false, smt: false, dao_hic: false, project: false },
  rolesLoading: false,
  isOwner: false,
  projects: [],
  smtVoters: [],
  smtIndividualVotes: {},
  daoHicVoters: [],
  daoHicIndividualVotes: {},
  projectsLocked: false,
  contractLocked: false,
  voteCounts: { smt: 0, daoHic: 0, community: 0 },
  totalCommunityVoters: 0,
  entityVotes: { smt: null, daoHic: null, community: null },
  badges: [],
  communityBadges: [],
  smtVote: null,
  daoHicVote: null,
  winner: { projectAddress: null, hasWinner: false },
  votingMode: 0,
  projectScores: null,
  statusFlags: { isActive: false, votingEnded: false },
  iterationTimes: { startTime: null, endTime: null },
  loading: false,
  hasLoadError: false,
};

export const contractStateStore = writable<ContractState>(initialState);

// Derived stores for easy access
export const roles = derived(contractStateStore, $s => $s.roles);
export const rolesLoading = derived(contractStateStore, $s => $s.rolesLoading);
export const isOwner = derived(contractStateStore, $s => $s.isOwner);
export const projects = derived(contractStateStore, $s => $s.projects);
export const smtVoters = derived(contractStateStore, $s => $s.smtVoters);
export const smtIndividualVotes = derived(contractStateStore, $s => $s.smtIndividualVotes);
export const daoHicVoters = derived(contractStateStore, $s => $s.daoHicVoters);
export const daoHicIndividualVotes = derived(contractStateStore, $s => $s.daoHicIndividualVotes);
export const projectsLocked = derived(contractStateStore, $s => $s.projectsLocked);
export const contractLocked = derived(contractStateStore, $s => $s.contractLocked);
export const voteCounts = derived(contractStateStore, $s => $s.voteCounts);
export const totalCommunityVoters = derived(contractStateStore, $s => $s.totalCommunityVoters);
export const entityVotes = derived(contractStateStore, $s => $s.entityVotes);
export const badges = derived(contractStateStore, $s => $s.badges);
export const communityBadges = derived(contractStateStore, $s => $s.communityBadges);
export const smtVote = derived(contractStateStore, $s => $s.smtVote);
export const daoHicVote = derived(contractStateStore, $s => $s.daoHicVote);
export const winner = derived(contractStateStore, $s => $s.winner);
export const votingMode = derived(contractStateStore, $s => $s.votingMode);
export const projectScores = derived(contractStateStore, $s => $s.projectScores);
export const statusFlags = derived(contractStateStore, $s => $s.statusFlags);
export const iterationTimes = derived(contractStateStore, $s => $s.iterationTimes);
export const loading = derived(contractStateStore, $s => $s.loading);
export const hasLoadError = derived(contractStateStore, $s => $s.hasLoadError);

// ============================================================================
// Actions
// ============================================================================

export function resetContractState(): void {
  contractStateStore.set(initialState);
}

export function setProjects(newProjects: Project[]): void {
  contractStateStore.update(s => ({ ...s, projects: newProjects }));
}

async function loadFromAPI(currentIteration: Iteration): Promise<IterationSnapshot | null> {
  console.log('[loadFromAPI] Fetching iteration data from API...');
  try {
    const snapshot = await iterationsAPI.getIteration(
      currentIteration.chainId,
      currentIteration.iteration
    );

    if (!snapshot) {
      console.log('[loadFromAPI] No snapshot found in API');
      return null;
    }

    console.log('[loadFromAPI] Received snapshot, applying to state...');

    const apiProjects: Project[] = (snapshot.projects || []).map((p, index) => ({
      id: index + 1,
      address: p.address,
      metadata: (p.metadata as unknown as ProjectMetadata) || {
        name: `Project #${index + 1}`,
        account: p.address,
        chainId: snapshot.chainId,
      },
    }));

    const isActive = snapshot.juryState === 'active';
    const votingEnded = snapshot.juryState === 'ended' || snapshot.juryState === 'locked';

    // Translate devRel→smt at the API boundary
    const apiSmtVoters: string[] = (snapshot as any).smtVoters ?? [];
    const devRelAccount = snapshot.devRelAccount;
    const resolvedSmtVoters = apiSmtVoters.length > 0
      ? apiSmtVoters
      : (devRelAccount ? [devRelAccount] : []);

    contractStateStore.update(s => ({
      ...s,
      projects: apiProjects,
      projectsLocked: snapshot.projectsLocked,
      contractLocked: snapshot.contractLocked,
      entityVotes: {
        smt: (snapshot.entityVotes as any).smt ?? snapshot.entityVotes.devRel ?? null,
        daoHic: snapshot.entityVotes.daoHic,
        community: snapshot.entityVotes.community,
      },
      winner: {
        projectAddress: snapshot.winner.projectAddress,
        hasWinner: snapshot.winner.hasWinner,
      },
      votingMode: snapshot.votingMode,
      projectScores: snapshot.projectScores,
      iterationTimes: {
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
      },
      statusFlags: { isActive, votingEnded },
      voteCounts: {
        smt: (snapshot.totals as any).smt ?? snapshot.totals.devRel ?? 0,
        daoHic: snapshot.totals.daoHic,
        community: snapshot.totals.community,
      },
      smtVoters: resolvedSmtVoters,
      smtIndividualVotes: (snapshot as any).smtIndividualVotes ?? {},
      daoHicVoters: snapshot.daoHicVoters,
      daoHicIndividualVotes: snapshot.daoHicIndividualVotes || {},
      totalCommunityVoters: 0,
    }));

    console.log('[loadFromAPI] Complete. State updated from API.');
    return snapshot;
  } catch (error) {
    console.warn('[loadFromAPI] API call failed:', error);
    return null;
  }
}

async function loadProjects(
  adapter: Contract,
  jurySC: string,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number
): Promise<void> {
  console.log('[loadProjects] Starting...');
  const iterationNum = currentIteration.iteration;

  try {
    const [projectsLockedFlag, contractLockedFlag] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:projectsLocked`, promise: adapter.projectsLocked(jurySC).catch(() => false) },
      { key: `iteration:${iterationNum}:locked`, promise: adapter.locked(jurySC).catch(() => false) },
    ]);

    contractStateStore.update(s => ({
      ...s,
      projectsLocked: Boolean(projectsLockedFlag),
      contractLocked: Boolean(contractLockedFlag),
    }));

    const addresses: string[] = await adapter.getProjectAddresses(jurySC).catch(() => [] as string[]);

    if (addresses.length === 0) {
      contractStateStore.update(s => ({ ...s, projects: [] }));
      return;
    }

    const cidMap = await batchGetProjectMetadataCIDs(
      selectedChainId,
      currentIteration.jurySC,
      addresses,
      publicProvider
    );

    const cids = Array.from(cidMap.values()).filter(cid => cid.length > 0);
    const metadataMap = cids.length > 0 ? await metadataAPI.batchGetByCIDs(cids) : {};

    const entries: Project[] = addresses.map((address, index) => {
      const cid = cidMap.get(address);
      const metadata = cid ? metadataMap[cid] : undefined;

      return {
        id: index + 1,
        address: address,
        metadata: metadata || {
          name: `Project #${index + 1}`,
          account: address,
          chainId: selectedChainId,
        } as ProjectMetadata,
      };
    });

    contractStateStore.update(s => ({ ...s, projects: entries }));
    console.log('[loadProjects] Complete. Loaded', entries.length, 'projects');
  } catch (error) {
    console.error('[loadProjects] Failed:', error);
    contractStateStore.update(s => ({ ...s, projects: [] }));
  }
}

async function loadOwnerData(
  adapter: Contract,
  jurySC: string,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number
): Promise<void> {
  console.log('[loadOwnerData] Starting...');
  const iterationNum = currentIteration.iteration;
  try {
    const normalizeVoterArray = (arr: unknown) =>
      (Array.isArray(arr) ? arr : []).filter(
        (addr): addr is string =>
          typeof addr === 'string' && addr.length > 0 && addr !== ethers.ZeroAddress
      );

    // Adapter unifies getSmtVoters/devRelAccount via getEntityVoters(jurySC, entityId)
    const [smtVotersResponse, daoHicVotersResponse] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:getEntityVoters:${ENTITY_SMT}`, promise: adapter.getEntityVoters(jurySC, ENTITY_SMT).catch(() => [] as string[]) },
      { key: `iteration:${iterationNum}:getEntityVoters:${ENTITY_DAO_HIC}`, promise: adapter.getEntityVoters(jurySC, ENTITY_DAO_HIC).catch(() => [] as string[]) },
    ]);

    contractStateStore.update(s => ({
      ...s,
      smtVoters: normalizeVoterArray(smtVotersResponse),
      daoHicVoters: normalizeVoterArray(daoHicVotersResponse),
    }));

    console.log('[loadOwnerData] Complete.');
  } catch (error) {
    console.error('[loadOwnerData] Error:', error);
    contractStateStore.update(s => ({
      ...s,
      smtVoters: [],
      daoHicVoters: [],
      smtIndividualVotes: {},
      daoHicIndividualVotes: {},
    }));
  }
}

async function loadEntityVotes(
  adapter: Contract,
  jurySC: string,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number,
  isActive: boolean,
  votingEnded: boolean
): Promise<void> {
  console.log('[loadEntityVotes] Starting...');
  const iterationNum = currentIteration.iteration;

  try {
    if (!isActive && !votingEnded) {
      contractStateStore.update(s => ({
        ...s,
        entityVotes: { smt: null, daoHic: null, community: null },
        winner: { projectAddress: null, hasWinner: false },
      }));
      return;
    }

    // Adapter handles voting mode uniformly — overrides are resolved on-chain via PoBRegistry
    const detectedMode = Number(await adapter.votingMode(jurySC).catch(() => 0));

    const winnerRaw = detectedMode === 0
      ? await adapter.getWinnerConsensus(jurySC).catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean]
      : await adapter.getWinnerWeighted(jurySC).catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];

    // Entity votes via adapter (unified for all versions)
    const [smtRaw, daoHicRaw, communityRaw] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:getEntityVote:${ENTITY_SMT}`, promise: adapter.getEntityVote(jurySC, ENTITY_SMT).catch(() => ethers.ZeroAddress) },
      { key: `iteration:${iterationNum}:getEntityVote:${ENTITY_DAO_HIC}`, promise: adapter.getEntityVote(jurySC, ENTITY_DAO_HIC).catch(() => ethers.ZeroAddress) },
      { key: `iteration:${iterationNum}:getCommunityEntityVote`, promise: adapter.getCommunityEntityVote(jurySC).catch(() => ethers.ZeroAddress) },
    ]);

    const [winnerAddressRaw, hasWinnerRaw] = Array.isArray(winnerRaw) ? winnerRaw : [ethers.ZeroAddress, false];

    let newProjectScores = null;
    if (votingEnded && detectedMode === 1) {
      try {
        const [addresses, scores, totalPossible] = await adapter.getWinnerWithScores(jurySC);
        newProjectScores = {
          addresses: addresses as string[],
          scores: (scores as bigint[]).map(s => s.toString()),
          totalPossible: (totalPossible as bigint).toString(),
        };
      } catch (error) {
        console.log('[loadEntityVotes] getWinnerWithScores not available');
      }
    }

    contractStateStore.update(s => ({
      ...s,
      votingMode: detectedMode,
      entityVotes: {
        smt: normalizeAddress(smtRaw),
        daoHic: normalizeAddress(daoHicRaw),
        community: normalizeAddress(communityRaw),
      },
      winner: {
        projectAddress: normalizeAddress(winnerAddressRaw),
        hasWinner: Boolean(hasWinnerRaw),
      },
      projectScores: newProjectScores,
    }));

    console.log('[loadEntityVotes] Complete.');
  } catch (error) {
    console.error('[loadEntityVotes] Error:', error);
    contractStateStore.update(s => ({
      ...s,
      entityVotes: { smt: null, daoHic: null, community: null },
      winner: { projectAddress: null, hasWinner: false },
    }));
  }
}

async function loadRoles(
  adapter: Contract,
  jurySC: string,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number,
  address: string
): Promise<void> {
  console.log('[loadRoles] Starting for address:', address);
  contractStateStore.update(s => ({ ...s, rolesLoading: true }));

  try {
    const iterationNum = currentIteration.iteration;

    // Adapter unifies isSmtVoter/isDevRelAccount via isEntityVoter(jurySC, entityId, addr)
    const [isSmt, isDaoHic, isProject, ownerAddr] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:isEntityVoter:${ENTITY_SMT}:${address}`, promise: adapter.isEntityVoter(jurySC, ENTITY_SMT, address) },
      { key: `iteration:${iterationNum}:isEntityVoter:${ENTITY_DAO_HIC}:${address}`, promise: adapter.isEntityVoter(jurySC, ENTITY_DAO_HIC, address) },
      { key: `iteration:${iterationNum}:isRegisteredProject:${address}`, promise: adapter.isRegisteredProject(jurySC, address) },
      { key: `iteration:${iterationNum}:owner`, promise: adapter.owner(jurySC) },
    ]);

    contractStateStore.update(s => ({
      ...s,
      roles: {
        community: false,
        smt: Boolean(isSmt),
        dao_hic: Boolean(isDaoHic),
        project: Boolean(isProject),
      },
      isOwner: ownerAddr.toLowerCase() === address.toLowerCase(),
    }));

    console.log('[loadRoles] Complete.');
  } finally {
    contractStateStore.update(s => ({ ...s, rolesLoading: false }));
  }
}

async function loadUserVotes(
  adapter: Contract,
  jurySC: string,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number,
  address: string | null
): Promise<void> {
  console.log('[loadUserVotes] Starting...');
  const iterationNum = currentIteration.iteration;

  // Adapter unifies smtVoteOf/devRelVote via entityVoteOf(jurySC, entityId, voter)
  // and smtHasVoted/devRelHasVoted via entityHasVoted(jurySC, entityId, voter)
  const [smtVoteValue, smtVoted, daoVote, daoVoted] = await cachedPromiseAll(publicProvider, selectedChainId, [
    { key: `iteration:${iterationNum}:entityVoteOf:${ENTITY_SMT}:${address}`, promise: address ? adapter.entityVoteOf(jurySC, ENTITY_SMT, address) : Promise.resolve(null) },
    { key: `iteration:${iterationNum}:entityHasVoted:${ENTITY_SMT}:${address}`, promise: address ? adapter.entityHasVoted(jurySC, ENTITY_SMT, address) : Promise.resolve(false) },
    { key: `iteration:${iterationNum}:entityVoteOf:${ENTITY_DAO_HIC}:${address}`, promise: address ? adapter.entityVoteOf(jurySC, ENTITY_DAO_HIC, address) : Promise.resolve(null) },
    { key: `iteration:${iterationNum}:entityHasVoted:${ENTITY_DAO_HIC}:${address}`, promise: address ? adapter.entityHasVoted(jurySC, ENTITY_DAO_HIC, address) : Promise.resolve(false) },
  ]);

  contractStateStore.update(s => ({
    ...s,
    smtVote: Boolean(smtVoted) ? normalizeAddress(smtVoteValue) : null,
    daoHicVote: Boolean(daoVoted) ? normalizeAddress(daoVote) : null,
  }));

  console.log('[loadUserVotes] Complete.');
}

async function loadVoteCounts(
  adapter: Contract,
  jurySC: string,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number
): Promise<void> {
  console.log('[loadVoteCounts] Starting...');
  const iterationNum = currentIteration.iteration;

  try {
    const [[firstCount, daoHicCount, communityCount], daoHicVotersResponse] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:getVoteParticipationCounts`, promise: adapter.getVoteParticipationCounts(jurySC) },
      { key: `iteration:${iterationNum}:getEntityVoters:${ENTITY_DAO_HIC}`, promise: adapter.getEntityVoters(jurySC, ENTITY_DAO_HIC).catch(() => [] as string[]) },
    ]);

    const normalizedDaoHic = (Array.isArray(daoHicVotersResponse) ? daoHicVotersResponse : []).filter(
      (addr): addr is string =>
        typeof addr === 'string' && addr.length > 0 && addr !== ethers.ZeroAddress
    );

    contractStateStore.update(s => ({
      ...s,
      voteCounts: {
        smt: Number(firstCount),
        daoHic: Number(daoHicCount),
        community: Number(communityCount),
      },
      daoHicVoters: normalizedDaoHic,
      totalCommunityVoters: 0,
    }));

    console.log('[loadVoteCounts] Complete.');
  } catch (error) {
    console.error('[loadVoteCounts] Error:', error);
    contractStateStore.update(s => ({
      ...s,
      voteCounts: { smt: 0, daoHic: 0, community: 0 },
      daoHicVoters: [],
      daoHicIndividualVotes: {},
      totalCommunityVoters: 0,
    }));
  }
}

async function loadBadgesMinimal(
  address: string,
  rpcProvider: JsonRpcProvider,
  allIterations: Iteration[],
  currentIteration: Iteration | null
): Promise<Badge[]> {
  console.log('[loadBadgesMinimal] Starting for address:', address);

  const allBadgesMap = new Map<string, Badge>();

  const contractsToQuery: Array<{
    iteration: number;
    round?: number;
    pob: string;
    chainId: number;
    deployBlockHint?: number;
  }> = [];

  for (const iteration of allIterations) {
    contractsToQuery.push({
      iteration: iteration.iteration,
      round: iteration.round,
      pob: iteration.pob,
      chainId: iteration.chainId,
      deployBlockHint: iteration.deployBlockHint,
    });

    if (iteration.prev_rounds && iteration.prev_rounds.length > 0) {
      for (const prevRound of iteration.prev_rounds) {
        contractsToQuery.push({
          iteration: iteration.iteration,
          round: prevRound.round,
          pob: prevRound.pob,
          chainId: iteration.chainId,
          deployBlockHint: prevRound.deployBlockHint,
        });
      }
    }
  }

  const contractPromises = contractsToQuery.map(async (contract) => {
    try {
      // Use PoB_01ABI for badge discovery — Transfer, roleOf, claimed are the same across all versions
      const pobABI = PoB_01ABI;
      const iface = new Interface(pobABI);
      const transferTopic = iface.getEvent('Transfer')?.topicHash;
      if (!transferTopic) return [];

      const iterationPobContract = new Contract(contract.pob, pobABI, rpcProvider);
      const fromBlock = contract.deployBlockHint !== undefined ? contract.deployBlockHint : 0;

      const logs = await rpcProvider.getLogs({
        address: contract.pob,
        fromBlock,
        toBlock: 'latest',
        topics: [transferTopic, null, ethers.zeroPadValue(address, 32)],
      });

      if (!logs?.length) return [];

      const tokenIds: string[] = [];
      for (const log of logs) {
        try {
          const parsed = iface.parseLog(log);
          const tokenId = parsed?.args?.tokenId ?? parsed?.args?.[2];
          if (tokenId !== undefined && tokenId !== null) {
            tokenIds.push(tokenId.toString());
          }
        } catch (parseError) {
          console.warn('Failed to parse badge log', parseError);
        }
      }

      if (tokenIds.length === 0) return [];

      const batchedCalls = [
        ...tokenIds.map(id => ({
          key: `roleOf:${contract.pob}:${id}`,
          promise: iterationPobContract.roleOf(id)
        })),
        ...tokenIds.map(id => ({
          key: `claimed:${contract.pob}:${id}`,
          promise: iterationPobContract.claimed(id)
        })),
      ];

      const results = await cachedPromiseAll(rpcProvider, contract.chainId, batchedCalls);

      const roles = results.slice(0, tokenIds.length);
      const claimedStatuses = results.slice(tokenIds.length);

      const badges: Badge[] = [];
      for (let i = 0; i < tokenIds.length; i++) {
        badges.push({
          tokenId: tokenIds[i],
          role: roles[i].toLowerCase() as ParticipantRole,
          iteration: contract.iteration,
          round: contract.round,
          claimed: claimedStatuses[i],
        });
      }

      return badges;
    } catch (iterationError) {
      console.warn(`Failed to load badges from iteration ${contract.iteration}`, iterationError);
      return [];
    }
  });

  const badgeArrays = await Promise.all(contractPromises);

  for (const badges of badgeArrays) {
    for (const badge of badges) {
      const badgeKey = `${badge.iteration}-${badge.round || 'main'}-${badge.tokenId}`;
      allBadgesMap.set(badgeKey, badge);
    }
  }

  const badgeList = Array.from(allBadgesMap.values());

  contractStateStore.update(s => ({
    ...s,
    badges: badgeList,
    roles: {
      ...s.roles,
      community: badgeList.some((badge) =>
        badge.role === 'community' &&
        badge.iteration === currentIteration?.iteration &&
        badge.round === currentIteration?.round
      ),
    },
  }));

  console.log('[loadBadgesMinimal] Complete. Total badges:', badgeList.length);
  return badgeList;
}

async function loadBadgesVotingData(
  adapter: Contract,
  jurySC: string,
  rpcProvider: JsonRpcProvider,
  badgeList: Badge[],
  currentIteration: Iteration
): Promise<void> {
  console.log('[loadBadgesVotingData] Loading voting data...');

  const currentIterationCommunityBadges = badgeList.filter(
    badge =>
      badge.role === 'community' &&
      badge.iteration === currentIteration.iteration &&
      badge.round === currentIteration.round
  );

  if (currentIterationCommunityBadges.length === 0) {
    contractStateStore.update(s => ({ ...s, communityBadges: [] }));
    return;
  }

  try {
    const votingCalls = [
      ...currentIterationCommunityBadges.map(badge => ({
        key: `communityHasVoted:${jurySC}:${badge.tokenId}`,
        promise: adapter.communityHasVoted(jurySC, badge.tokenId)
      })),
      ...currentIterationCommunityBadges.map(badge => ({
        key: `communityVoteOf:${jurySC}:${badge.tokenId}`,
        promise: adapter.communityVoteOf(jurySC, badge.tokenId)
      })),
    ];

    const results = await cachedPromiseAll(rpcProvider, currentIteration.chainId, votingCalls);

    const hasVotedResults = results.slice(0, currentIterationCommunityBadges.length);
    const voteResults = results.slice(currentIterationCommunityBadges.length);

    const communityBadgeStates: CommunityBadgeState[] = currentIterationCommunityBadges.map((badge, i) => ({
      ...badge,
      hasVoted: Boolean(hasVotedResults[i]),
      vote: normalizeAddress(voteResults[i]),
    }));

    contractStateStore.update(s => ({ ...s, communityBadges: communityBadgeStates }));
    console.log('[loadBadgesVotingData] Complete.');
  } catch (error) {
    console.warn('Failed to load voting data for community badges', error);
    contractStateStore.update(s => ({ ...s, communityBadges: [] }));
  }
}

// Main load function
export async function loadIterationState(
  signer: JsonRpcSigner | null,
  walletAddress: string | null,
  currentIteration: Iteration | null,
  publicProvider: JsonRpcProvider | null,
  allIterations: Iteration[],
  currentPage: PageType,
  isOwnerFlag: boolean
): Promise<void> {
  console.log('=== [loadIterationState] Starting ===');

  if (!currentIteration || !publicProvider) {
    console.log('[loadIterationState] Missing required conditions');
    return;
  }

  const selectedChainId = currentIteration.chainId;

  const isValidAddress = (addr: string) => /^0x[0-9a-fA-F]{40}$/.test(addr);
  if (!isValidAddress(currentIteration.jurySC) || !isValidAddress(currentIteration.pob)) {
    throw new Error('Iteration addresses are invalid or not configured.');
  }

  contractStateStore.update(s => ({ ...s, loading: true, hasLoadError: false }));

  try {
    // Resolve adapter for this iteration/round
    const adapterConfig = await getAdapter(currentIteration, publicProvider);
    if (!adapterConfig) {
      throw new Error(`Failed to resolve adapter for iteration ${currentIteration.iteration}`);
    }
    const { adapter, jurySC } = adapterConfig;

    const isIterationLikePage = currentPage === 'iteration' || currentPage === 'project';

    // Phase 1: Try API
    const apiSnapshot = await loadFromAPI(currentIteration);

    // Phase 2: Load user-specific data
    const loadTasks: Promise<unknown>[] = [];

    if (walletAddress) {
      loadTasks.push(loadRoles(adapter, jurySC, currentIteration, publicProvider, selectedChainId, walletAddress));
    }

    if (apiSnapshot) {
      console.log('[loadIterationState] API data loaded');

      if (walletAddress) {
        loadTasks.push(loadUserVotes(adapter, jurySC, currentIteration, publicProvider, selectedChainId, walletAddress));
      }

      if (currentPage === 'badges' && walletAddress) {
        loadTasks.push(loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration));
      } else if (isIterationLikePage && walletAddress) {
        const badgesPromise = loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration).then(badgeList => {
          if (badgeList && badgeList.length > 0) {
            return loadBadgesVotingData(adapter, jurySC, publicProvider, badgeList, currentIteration);
          }
        });
        loadTasks.push(badgesPromise);
      }
    } else {
      console.warn('[loadIterationState] API unavailable for iteration', currentIteration.iteration);
      contractStateStore.update(s => ({ ...s, hasLoadError: true }));

      // Load core state via RPC since API is unavailable
      loadTasks.push(loadProjects(adapter, jurySC, currentIteration, publicProvider, selectedChainId));
      if (isOwnerFlag) {
        loadTasks.push(loadOwnerData(adapter, jurySC, currentIteration, publicProvider, selectedChainId));
      }

      // Load statusFlags + entity votes via RPC
      const iterationNum = currentIteration.iteration;
      const statusPromise = cachedPromiseAll(publicProvider, selectedChainId, [
        { key: `iteration:${iterationNum}:isActive`, promise: adapter.isActive(jurySC).catch(() => false), skipCache: true },
        { key: `iteration:${iterationNum}:votingEnded`, promise: adapter.votingEnded(jurySC).catch(() => false), skipCache: true },
        { key: `iteration:${iterationNum}:startTime`, promise: adapter.startTime(jurySC).catch(() => BigInt(0)) },
        { key: `iteration:${iterationNum}:endTime`, promise: adapter.endTime(jurySC).catch(() => BigInt(0)) },
      ]).then(async ([isActive, votingEndedFlag, startTime, endTime]) => {
        const flags = { isActive: Boolean(isActive), votingEnded: Boolean(votingEndedFlag) };
        contractStateStore.update(s => ({
          ...s,
          statusFlags: flags,
          iterationTimes: { startTime: Number(startTime), endTime: Number(endTime) },
        }));
        await loadEntityVotes(adapter, jurySC, currentIteration, publicProvider, selectedChainId, flags.isActive, flags.votingEnded);
        if (flags.isActive || flags.votingEnded) {
          await loadVoteCounts(adapter, jurySC, currentIteration, publicProvider, selectedChainId);
        }
      });
      loadTasks.push(statusPromise);

      if (walletAddress) {
        loadTasks.push(loadUserVotes(adapter, jurySC, currentIteration, publicProvider, selectedChainId, walletAddress));
      }
      if (currentPage === 'badges' && walletAddress) {
        loadTasks.push(loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration));
      } else if (isIterationLikePage && walletAddress) {
        const badgesPromise = loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration).then(badgeList => {
          if (badgeList && badgeList.length > 0) {
            return loadBadgesVotingData(adapter, jurySC, publicProvider, badgeList, currentIteration);
          }
        });
        loadTasks.push(badgesPromise);
      }
    }

    await Promise.all(loadTasks);
    console.log('=== [loadIterationState] Complete ===');
  } catch (contractError) {
    console.error('[loadIterationState] Error:', contractError);
    contractStateStore.update(s => ({ ...s, hasLoadError: true }));
    throw contractError;
  } finally {
    contractStateStore.update(s => ({ ...s, loading: false }));
  }
}

// Refresh functions
export async function refreshProjects(): Promise<void> {
  const ctx = getTransactionContext();
  if (!ctx.signer || !ctx.selectedIteration) return;
  console.log('[refreshProjects] Refreshing...');
  const provider = ctx.signer.provider as JsonRpcProvider;
  const adapterConfig = await getAdapter(ctx.selectedIteration, provider);
  if (!adapterConfig) return;
  await loadProjects(adapterConfig.adapter, adapterConfig.jurySC, ctx.selectedIteration, provider, ctx.selectedIteration.chainId);
}

export async function refreshOwnerData(): Promise<void> {
  const ctx = getTransactionContext();
  if (!ctx.signer || !ctx.selectedIteration) return;
  console.log('[refreshOwnerData] Refreshing...');
  const provider = ctx.signer.provider as JsonRpcProvider;
  const adapterConfig = await getAdapter(ctx.selectedIteration, provider);
  if (!adapterConfig) return;
  await loadOwnerData(adapterConfig.adapter, adapterConfig.jurySC, ctx.selectedIteration, provider, ctx.selectedIteration.chainId);
}

export async function refreshVotingData(): Promise<void> {
  const ctx = getTransactionContext();
  if (!ctx.signer || !ctx.selectedIteration || !ctx.walletAddress || !ctx.publicProvider) return;
  console.log('[refreshVotingData] Refreshing...');

  const adapterConfig = await getAdapter(ctx.selectedIteration, ctx.publicProvider);
  if (!adapterConfig) return;
  const { adapter, jurySC } = adapterConfig;

  const selectedChainId = ctx.selectedIteration.chainId;
  const iterationNum = ctx.selectedIteration.iteration;

  // All reads through adapter — no version branching
  const [isActive, votingEndedFlag, smtVoteValue, smtVoted, daoVote, daoVoted, startTime, endTime] =
    await cachedPromiseAll(ctx.publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:isActive`, promise: adapter.isActive(jurySC), skipCache: true },
      { key: `iteration:${iterationNum}:votingEnded`, promise: adapter.votingEnded(jurySC), skipCache: true },
      { key: `iteration:${iterationNum}:entityVoteOf:${ENTITY_SMT}:${ctx.walletAddress}`, promise: adapter.entityVoteOf(jurySC, ENTITY_SMT, ctx.walletAddress), skipCache: true },
      { key: `iteration:${iterationNum}:entityHasVoted:${ENTITY_SMT}:${ctx.walletAddress}`, promise: adapter.entityHasVoted(jurySC, ENTITY_SMT, ctx.walletAddress), skipCache: true },
      { key: `iteration:${iterationNum}:entityVoteOf:${ENTITY_DAO_HIC}:${ctx.walletAddress}`, promise: adapter.entityVoteOf(jurySC, ENTITY_DAO_HIC, ctx.walletAddress), skipCache: true },
      { key: `iteration:${iterationNum}:entityHasVoted:${ENTITY_DAO_HIC}:${ctx.walletAddress}`, promise: adapter.entityHasVoted(jurySC, ENTITY_DAO_HIC, ctx.walletAddress), skipCache: true },
      { key: `iteration:${iterationNum}:startTime`, promise: adapter.startTime(jurySC), skipCache: true },
      { key: `iteration:${iterationNum}:endTime`, promise: adapter.endTime(jurySC), skipCache: true },
    ]);

  const flags = { isActive: Boolean(isActive), votingEnded: Boolean(votingEndedFlag) };

  contractStateStore.update(s => ({
    ...s,
    statusFlags: flags,
    smtVote: Boolean(smtVoted) ? normalizeAddress(smtVoteValue) : null,
    daoHicVote: Boolean(daoVoted) ? normalizeAddress(daoVote) : null,
    iterationTimes: { startTime: Number(startTime), endTime: Number(endTime) },
  }));

  await loadEntityVotes(adapter, jurySC, ctx.selectedIteration, ctx.publicProvider, selectedChainId, flags.isActive, flags.votingEnded);

  if (flags.isActive || flags.votingEnded) {
    await loadVoteCounts(adapter, jurySC, ctx.selectedIteration, ctx.publicProvider, selectedChainId);
  }

  const badgeList = await loadBadgesMinimal(ctx.walletAddress, ctx.publicProvider, ctx.allIterations, ctx.selectedIteration);
  if (badgeList && badgeList.length > 0) {
    await loadBadgesVotingData(adapter, jurySC, ctx.publicProvider, badgeList, ctx.selectedIteration);
  }
}

export async function refreshBadges(): Promise<void> {
  const ctx = getTransactionContext();
  if (!ctx.publicProvider || !ctx.selectedIteration || !ctx.walletAddress) return;
  console.log('[refreshBadges] Refreshing...');
  const badgeList = await loadBadgesMinimal(ctx.walletAddress, ctx.publicProvider, ctx.allIterations, ctx.selectedIteration);
  if (badgeList && badgeList.length > 0) {
    const adapterConfig = await getAdapter(ctx.selectedIteration, ctx.publicProvider);
    if (adapterConfig) {
      await loadBadgesVotingData(adapterConfig.adapter, adapterConfig.jurySC, ctx.publicProvider, badgeList, ctx.selectedIteration);
    }
  }
}

export function retryLoadIteration(
  currentPage: PageType,
  isOwnerFlag: boolean
): void {
  const ctx = getTransactionContext();
  contractStateStore.update(s => ({ ...s, hasLoadError: false }));
  loadIterationState(ctx.signer, ctx.walletAddress, ctx.selectedIteration, ctx.publicProvider, ctx.allIterations, currentPage, isOwnerFlag).catch((err) => {
    console.error('[retryLoadIteration] failed:', err);
  });
}
