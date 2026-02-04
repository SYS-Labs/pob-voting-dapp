import { writable, derived, get } from 'svelte/store';
import { Contract, Interface, JsonRpcProvider, type JsonRpcSigner, ethers } from 'ethers';
import { PoB_01ABI, PoB_02ABI } from '~/abis';
import JurySC_01_v001_ABI from '~/abis/JurySC_01_v001.json';
import JurySC_01_v002_ABI from '~/abis/JurySC_01_v002.json';
import JurySC_02_v001_ABI from '~/abis/JurySC_02_v001.json';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';
import { batchGetProjectMetadataCIDs, VOTING_MODE_OVERRIDES } from '~/utils/registry';
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
  devRel: string | null;
  daoHic: string | null;
  community: string | null;
}

interface RoleStatuses {
  community: boolean;
  devrel: boolean;
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
  devRelAccount: string | null;
  daoHicVoters: string[];
  daoHicIndividualVotes: Record<string, string>;
  projectsLocked: boolean;
  contractLocked: boolean;
  voteCounts: { devRel: number; daoHic: number; community: number };
  totalCommunityVoters: number;
  entityVotes: EntityVotes;
  badges: Badge[];
  communityBadges: CommunityBadgeState[];
  devRelVote: string | null;
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

function getJurySCABI(iteration: Iteration | null) {
  if (!iteration) return JurySC_02_v001_ABI;
  if (iteration.version === '001') return JurySC_01_v001_ABI;
  if (iteration.version === '002') return JurySC_01_v002_ABI;
  return JurySC_02_v001_ABI;
}

function getPoBContractABI(version: string | undefined) {
  if (version === '001' || version === '002') return PoB_01ABI;
  return PoB_02ABI;
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value) return null;
  if (value === ethers.ZeroAddress) return null;
  return value;
}

// ============================================================================
// Store
// ============================================================================

const initialState: ContractState = {
  roles: { community: false, devrel: false, dao_hic: false, project: false },
  rolesLoading: false,
  isOwner: false,
  projects: [],
  devRelAccount: null,
  daoHicVoters: [],
  daoHicIndividualVotes: {},
  projectsLocked: false,
  contractLocked: false,
  voteCounts: { devRel: 0, daoHic: 0, community: 0 },
  totalCommunityVoters: 0,
  entityVotes: { devRel: null, daoHic: null, community: null },
  badges: [],
  communityBadges: [],
  devRelVote: null,
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
export const devRelAccount = derived(contractStateStore, $s => $s.devRelAccount);
export const daoHicVoters = derived(contractStateStore, $s => $s.daoHicVoters);
export const daoHicIndividualVotes = derived(contractStateStore, $s => $s.daoHicIndividualVotes);
export const projectsLocked = derived(contractStateStore, $s => $s.projectsLocked);
export const contractLocked = derived(contractStateStore, $s => $s.contractLocked);
export const voteCounts = derived(contractStateStore, $s => $s.voteCounts);
export const totalCommunityVoters = derived(contractStateStore, $s => $s.totalCommunityVoters);
export const entityVotes = derived(contractStateStore, $s => $s.entityVotes);
export const badges = derived(contractStateStore, $s => $s.badges);
export const communityBadges = derived(contractStateStore, $s => $s.communityBadges);
export const devRelVote = derived(contractStateStore, $s => $s.devRelVote);
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

    contractStateStore.update(s => ({
      ...s,
      projects: apiProjects,
      projectsLocked: snapshot.projectsLocked,
      contractLocked: snapshot.contractLocked,
      entityVotes: {
        devRel: snapshot.entityVotes.devRel,
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
        devRel: snapshot.totals.devRel,
        daoHic: snapshot.totals.daoHic,
        community: snapshot.totals.community,
      },
      devRelAccount: snapshot.devRelAccount,
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
  contract: Contract,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number
): Promise<void> {
  console.log('[loadProjects] Starting...');
  const iterationNum = currentIteration.iteration;

  try {
    const [projectsLockedFlag, contractLockedFlag] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:projectsLocked`, promise: contract.projectsLocked().catch(() => false) },
      { key: `iteration:${iterationNum}:locked`, promise: contract.locked().catch(() => false) },
    ]);

    contractStateStore.update(s => ({
      ...s,
      projectsLocked: Boolean(projectsLockedFlag),
      contractLocked: Boolean(contractLockedFlag),
    }));

    let addresses: string[] = [];
    try {
      addresses = await contract.getProjectAddresses();
    } catch (err) {
      const countRaw = await contract.projectCount();
      const count = Number(countRaw);
      const projectAddressCalls = [];
      for (let index = 1; index <= count; index += 1) {
        projectAddressCalls.push({
          key: `iteration:${iterationNum}:projectAddress:${index}`,
          promise: contract.projectAddress(index),
        });
      }
      addresses = await cachedPromiseAll(publicProvider, selectedChainId, projectAddressCalls);
    }

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
  contract: Contract,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number
): Promise<void> {
  console.log('[loadOwnerData] Starting...');
  const iterationNum = currentIteration.iteration;
  try {
    const [devRelAddress, daoHicAddressesResponse] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:devRelAccount`, promise: contract.devRelAccount().catch(() => ethers.ZeroAddress) },
      { key: `iteration:${iterationNum}:getDaoHicVoters`, promise: contract.getDaoHicVoters().catch(() => [] as string[]) },
    ]);

    const normalizedDevRel =
      typeof devRelAddress === 'string' && devRelAddress !== ethers.ZeroAddress ? devRelAddress : null;
    const normalizedDaoHic = (Array.isArray(daoHicAddressesResponse) ? daoHicAddressesResponse : []).filter(
      (addr): addr is string =>
        typeof addr === 'string' && addr.length > 0 && addr !== ethers.ZeroAddress
    );

    contractStateStore.update(s => ({
      ...s,
      devRelAccount: normalizedDevRel,
      daoHicVoters: normalizedDaoHic,
    }));

    console.log('[loadOwnerData] Complete.');
  } catch (error) {
    console.error('[loadOwnerData] Error:', error);
    contractStateStore.update(s => ({
      ...s,
      devRelAccount: null,
      daoHicVoters: [],
      daoHicIndividualVotes: {},
    }));
  }
}

async function loadEntityVotes(
  contract: Contract,
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
        entityVotes: { devRel: null, daoHic: null, community: null },
        winner: { projectAddress: null, hasWinner: false },
      }));
      return;
    }

    const jurySCAddress = currentIteration.jurySC?.toLowerCase() || '';
    const votingModeOverride = VOTING_MODE_OVERRIDES[jurySCAddress];

    const version = currentIteration.version || '003';
    let detectedMode = 0;
    let winnerRaw: [string, boolean] = [ethers.ZeroAddress, false];

    if (votingModeOverride !== undefined) {
      detectedMode = votingModeOverride;
      winnerRaw = detectedMode === 0
        ? await contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean]
        : await contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
    } else if (version === '001') {
      detectedMode = 0;
      winnerRaw = await contract.getWinner().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
    } else if (version === '002') {
      const [consensusWinner, weightedWinner] = await Promise.all([
        contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean]),
        contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]),
      ]) as [[string, boolean], [string, boolean]];

      if (weightedWinner[1] && !consensusWinner[1]) {
        detectedMode = 1;
        winnerRaw = weightedWinner;
      } else {
        detectedMode = 0;
        winnerRaw = consensusWinner;
      }
    } else {
      detectedMode = Number(await contract.votingMode().catch(() => 0));
      winnerRaw = detectedMode === 0
        ? await contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean]
        : await contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
    }

    const [devRelRaw, daoHicRaw, communityRaw] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:getDevRelEntityVote`, promise: contract.getDevRelEntityVote().catch(() => ethers.ZeroAddress) },
      { key: `iteration:${iterationNum}:getDaoHicEntityVote`, promise: contract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress) },
      { key: `iteration:${iterationNum}:getCommunityEntityVote`, promise: contract.getCommunityEntityVote().catch(() => ethers.ZeroAddress) },
    ]);

    const [winnerAddressRaw, hasWinnerRaw] = Array.isArray(winnerRaw) ? winnerRaw : [ethers.ZeroAddress, false];

    let newProjectScores = null;
    if (votingEnded && detectedMode === 1) {
      try {
        const [addresses, scores, totalPossible] = await contract.getWinnerWithScores();
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
        devRel: normalizeAddress(devRelRaw),
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
      entityVotes: { devRel: null, daoHic: null, community: null },
      winner: { projectAddress: null, hasWinner: false },
    }));
  }
}

async function loadRoles(
  contract: Contract,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number,
  address: string
): Promise<void> {
  console.log('[loadRoles] Starting for address:', address);
  contractStateStore.update(s => ({ ...s, rolesLoading: true }));

  try {
    const iterationNum = currentIteration.iteration;
    const [isDevRel, isDaoHic, isProject, owner] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:isDevRelAccount:${address}`, promise: contract.isDevRelAccount(address) },
      { key: `iteration:${iterationNum}:isDaoHicVoter:${address}`, promise: contract.isDaoHicVoter(address) },
      { key: `iteration:${iterationNum}:isRegisteredProject:${address}`, promise: contract.isRegisteredProject(address) },
      { key: `iteration:${iterationNum}:owner`, promise: contract.owner() },
    ]);

    const ownerStatus = owner.toLowerCase() === address.toLowerCase();

    contractStateStore.update(s => ({
      ...s,
      roles: {
        community: false,
        devrel: Boolean(isDevRel),
        dao_hic: Boolean(isDaoHic),
        project: Boolean(isProject),
      },
      isOwner: ownerStatus,
    }));

    console.log('[loadRoles] Complete.');
  } finally {
    contractStateStore.update(s => ({ ...s, rolesLoading: false }));
  }
}

async function loadUserVotes(
  contract: Contract,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number,
  address: string | null
): Promise<void> {
  console.log('[loadUserVotes] Starting...');
  const iterationNum = currentIteration.iteration;

  const [devRelVoted, devRelVoteValue, daoVote, daoVoted] = await cachedPromiseAll(publicProvider, selectedChainId, [
    { key: `iteration:${iterationNum}:devRelHasVoted`, promise: contract.devRelHasVoted() },
    { key: `iteration:${iterationNum}:devRelVote`, promise: contract.devRelVote() },
    { key: `iteration:${iterationNum}:daoHicVoteOf:${address}`, promise: address ? contract.daoHicVoteOf(address) : Promise.resolve(null) },
    { key: `iteration:${iterationNum}:daoHicHasVoted:${address}`, promise: address ? contract.daoHicHasVoted(address) : Promise.resolve(false) },
  ]);

  contractStateStore.update(s => ({
    ...s,
    devRelVote: Boolean(devRelVoted) ? normalizeAddress(devRelVoteValue) : null,
    daoHicVote: Boolean(daoVoted) ? normalizeAddress(daoVote) : null,
  }));

  console.log('[loadUserVotes] Complete.');
}

async function loadVotingStatus(
  contract: Contract,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number,
  address: string | null
): Promise<{ isActive: boolean; votingEnded: boolean }> {
  console.log('[loadVotingStatus] Starting...');
  const iterationNum = currentIteration.iteration;

  const [isActive, votingEnded, devRelVoted, devRelVoteValue, daoVote, daoVoted, startTime, endTime] =
    await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:isActive`, promise: contract.isActive() },
      { key: `iteration:${iterationNum}:votingEnded`, promise: contract.votingEnded() },
      { key: `iteration:${iterationNum}:devRelHasVoted`, promise: contract.devRelHasVoted() },
      { key: `iteration:${iterationNum}:devRelVote`, promise: contract.devRelVote() },
      { key: `iteration:${iterationNum}:daoHicVoteOf:${address}`, promise: address ? contract.daoHicVoteOf(address) : Promise.resolve(null) },
      { key: `iteration:${iterationNum}:daoHicHasVoted:${address}`, promise: address ? contract.daoHicHasVoted(address) : Promise.resolve(false) },
      { key: `iteration:${iterationNum}:startTime`, promise: contract.startTime() },
      { key: `iteration:${iterationNum}:endTime`, promise: contract.endTime() },
    ]);

  const flags = {
    isActive: Boolean(isActive),
    votingEnded: Boolean(votingEnded),
  };

  contractStateStore.update(s => ({
    ...s,
    statusFlags: flags,
    devRelVote: Boolean(devRelVoted) ? normalizeAddress(devRelVoteValue) : null,
    daoHicVote: Boolean(daoVoted) ? normalizeAddress(daoVote) : null,
    iterationTimes: { startTime: Number(startTime), endTime: Number(endTime) },
  }));

  console.log('[loadVotingStatus] Complete.');
  return flags;
}

async function loadVoteCounts(
  juryContract: Contract,
  currentIteration: Iteration,
  publicProvider: JsonRpcProvider,
  selectedChainId: number
): Promise<void> {
  console.log('[loadVoteCounts] Starting...');
  const iterationNum = currentIteration.iteration;

  try {
    const [[devRelCount, daoHicCount, communityCount], daoHicAddressesResponse] = await cachedPromiseAll(publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:getVoteParticipationCounts`, promise: juryContract.getVoteParticipationCounts() },
      { key: `iteration:${iterationNum}:getDaoHicVoters`, promise: juryContract.getDaoHicVoters().catch(() => [] as string[]) },
    ]);

    const normalizedDaoHic = (Array.isArray(daoHicAddressesResponse) ? daoHicAddressesResponse : []).filter(
      (addr): addr is string =>
        typeof addr === 'string' && addr.length > 0 && addr !== ethers.ZeroAddress
    );

    contractStateStore.update(s => ({
      ...s,
      voteCounts: {
        devRel: Number(devRelCount),
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
      voteCounts: { devRel: 0, daoHic: 0, community: 0 },
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
    version?: string;
  }> = [];

  for (const iteration of allIterations) {
    contractsToQuery.push({
      iteration: iteration.iteration,
      round: iteration.round,
      pob: iteration.pob,
      chainId: iteration.chainId,
      deployBlockHint: iteration.deployBlockHint,
      version: iteration.version,
    });

    if (iteration.prev_rounds && iteration.prev_rounds.length > 0) {
      for (const prevRound of iteration.prev_rounds) {
        contractsToQuery.push({
          iteration: iteration.iteration,
          round: prevRound.round,
          pob: prevRound.pob,
          chainId: iteration.chainId,
          deployBlockHint: prevRound.deployBlockHint,
          version: prevRound.version,
        });
      }
    }
  }

  const contractPromises = contractsToQuery.map(async (contract) => {
    try {
      const pobABI = getPoBContractABI(contract.version);
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
    const iterationJuryContract = new Contract(
      currentIteration.jurySC,
      getJurySCABI(currentIteration),
      rpcProvider
    );

    const votingCalls = [
      ...currentIterationCommunityBadges.map(badge => ({
        key: `communityHasVoted:${currentIteration.jurySC}:${badge.tokenId}`,
        promise: iterationJuryContract.communityHasVoted(badge.tokenId)
      })),
      ...currentIterationCommunityBadges.map(badge => ({
        key: `communityVoteOf:${currentIteration.jurySC}:${badge.tokenId}`,
        promise: iterationJuryContract.communityVoteOf(badge.tokenId)
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
    const juryContract = new Contract(currentIteration.jurySC, getJurySCABI(currentIteration), publicProvider);
    const isIterationLikePage = currentPage === 'iteration' || currentPage === 'project';

    // Phase 1: Try API
    const apiSnapshot = await loadFromAPI(currentIteration);

    // Phase 2: Load user-specific data
    const loadTasks: Promise<unknown>[] = [];

    if (walletAddress) {
      loadTasks.push(loadRoles(juryContract, currentIteration, publicProvider, selectedChainId, walletAddress));
    }

    if (apiSnapshot) {
      console.log('[loadIterationState] API data loaded');

      if (walletAddress) {
        loadTasks.push(loadUserVotes(juryContract, currentIteration, publicProvider, selectedChainId, walletAddress));
      }

      if (currentPage === 'badges' && walletAddress) {
        loadTasks.push(loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration));
      } else if (isIterationLikePage && walletAddress) {
        const badgesPromise = loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration).then(badgeList => {
          if (badgeList && badgeList.length > 0) {
            return loadBadgesVotingData(publicProvider, badgeList, currentIteration);
          }
        });
        loadTasks.push(badgesPromise);
      }
    } else {
      console.log('[loadIterationState] API unavailable - falling back to RPC');

      const statusResult = await loadVotingStatus(juryContract, currentIteration, publicProvider, selectedChainId, walletAddress);

      loadTasks.push(
        loadEntityVotes(juryContract, currentIteration, publicProvider, selectedChainId, statusResult.isActive, statusResult.votingEnded)
      );

      if (isIterationLikePage) {
        loadTasks.push(loadProjects(juryContract, currentIteration, publicProvider, selectedChainId));
      }

      if (currentPage === 'iteration' && walletAddress && isOwnerFlag) {
        loadTasks.push(loadOwnerData(juryContract, currentIteration, publicProvider, selectedChainId));
      }

      if (currentPage === 'badges' && walletAddress) {
        loadTasks.push(loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration));
      } else if (isIterationLikePage && walletAddress) {
        const badgesPromise = loadBadgesMinimal(walletAddress, publicProvider, allIterations, currentIteration).then(badgeList => {
          if (badgeList && badgeList.length > 0) {
            return loadBadgesVotingData(publicProvider, badgeList, currentIteration);
          }
        });
        loadTasks.push(badgesPromise);
      }

      if (currentPage === 'iteration' && (statusResult.isActive || statusResult.votingEnded)) {
        loadTasks.push(loadVoteCounts(juryContract, currentIteration, publicProvider, selectedChainId));
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
  const contract = new Contract(ctx.selectedIteration.jurySC, getJurySCABI(ctx.selectedIteration), ctx.signer);
  const provider = ctx.signer.provider as JsonRpcProvider;
  await loadProjects(contract, ctx.selectedIteration, provider, ctx.selectedIteration.chainId);
}

export async function refreshOwnerData(): Promise<void> {
  const ctx = getTransactionContext();
  if (!ctx.signer || !ctx.selectedIteration) return;
  console.log('[refreshOwnerData] Refreshing...');
  const contract = new Contract(ctx.selectedIteration.jurySC, getJurySCABI(ctx.selectedIteration), ctx.signer);
  const provider = ctx.signer.provider as JsonRpcProvider;
  await loadOwnerData(contract, ctx.selectedIteration, provider, ctx.selectedIteration.chainId);
}

export async function refreshVotingData(): Promise<void> {
  const ctx = getTransactionContext();
  if (!ctx.signer || !ctx.selectedIteration || !ctx.walletAddress || !ctx.publicProvider) return;
  console.log('[refreshVotingData] Refreshing...');

  const juryContract = new Contract(ctx.selectedIteration.jurySC, getJurySCABI(ctx.selectedIteration), ctx.signer);
  const selectedChainId = ctx.selectedIteration.chainId;
  const iterationNum = ctx.selectedIteration.iteration;

  const [isActive, votingEnded, devRelVoted, devRelVoteValue, daoVote, daoVoted, startTime, endTime] =
    await cachedPromiseAll(ctx.publicProvider, selectedChainId, [
      { key: `iteration:${iterationNum}:isActive`, promise: juryContract.isActive(), skipCache: true },
      { key: `iteration:${iterationNum}:votingEnded`, promise: juryContract.votingEnded(), skipCache: true },
      { key: `iteration:${iterationNum}:devRelHasVoted`, promise: juryContract.devRelHasVoted(), skipCache: true },
      { key: `iteration:${iterationNum}:devRelVote`, promise: juryContract.devRelVote(), skipCache: true },
      { key: `iteration:${iterationNum}:daoHicVoteOf:${ctx.walletAddress}`, promise: juryContract.daoHicVoteOf(ctx.walletAddress), skipCache: true },
      { key: `iteration:${iterationNum}:daoHicHasVoted:${ctx.walletAddress}`, promise: juryContract.daoHicHasVoted(ctx.walletAddress), skipCache: true },
      { key: `iteration:${iterationNum}:startTime`, promise: juryContract.startTime(), skipCache: true },
      { key: `iteration:${iterationNum}:endTime`, promise: juryContract.endTime(), skipCache: true },
    ]);

  const flags = { isActive: Boolean(isActive), votingEnded: Boolean(votingEnded) };

  contractStateStore.update(s => ({
    ...s,
    statusFlags: flags,
    devRelVote: Boolean(devRelVoted) ? normalizeAddress(devRelVoteValue) : null,
    daoHicVote: Boolean(daoVoted) ? normalizeAddress(daoVote) : null,
    iterationTimes: { startTime: Number(startTime), endTime: Number(endTime) },
  }));

  await loadEntityVotes(juryContract, ctx.selectedIteration, ctx.publicProvider, selectedChainId, flags.isActive, flags.votingEnded);

  if (flags.isActive || flags.votingEnded) {
    await loadVoteCounts(juryContract, ctx.selectedIteration, ctx.publicProvider, selectedChainId);
  }

  const badgeList = await loadBadgesMinimal(ctx.walletAddress, ctx.publicProvider, ctx.allIterations, ctx.selectedIteration);
  if (badgeList && badgeList.length > 0) {
    await loadBadgesVotingData(ctx.publicProvider, badgeList, ctx.selectedIteration);
  }
}

export async function refreshBadges(): Promise<void> {
  const ctx = getTransactionContext();
  if (!ctx.publicProvider || !ctx.selectedIteration || !ctx.walletAddress) return;
  console.log('[refreshBadges] Refreshing...');
  const badgeList = await loadBadgesMinimal(ctx.walletAddress, ctx.publicProvider, ctx.allIterations, ctx.selectedIteration);
  if (badgeList && badgeList.length > 0) {
    await loadBadgesVotingData(ctx.publicProvider, badgeList, ctx.selectedIteration);
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
