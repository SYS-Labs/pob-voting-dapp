import { useCallback, useEffect, useState } from 'react';
import { Contract, Interface, JsonRpcProvider, JsonRpcSigner, ethers } from 'ethers';
import { PoB_01ABI, PoB_02ABI } from '~/abis';
import JurySC_01_v001_ABI from '~/abis/JurySC_01_v001.json';
import JurySC_01_v002_ABI from '~/abis/JurySC_01_v002.json';
import JurySC_02_v001_ABI from '~/abis/JurySC_02_v001.json';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';
import { batchGetProjectMetadataCIDs, VOTING_MODE_OVERRIDES } from '~/utils/registry';
import { metadataAPI } from '~/utils/metadata-api';
import { iterationsAPI, type IterationSnapshot } from '~/utils/iterations-api';
import type {
  Badge,
  Iteration,
  PageType,
  ParticipantRole,
  Project,
  ProjectMetadata,
} from '~/interfaces';

// Helper to select ABI based on iteration version
function getJurySCABI(iteration: Iteration | null) {
  if (!iteration) return JurySC_02_v001_ABI; // Default to latest (v02)
  if (iteration.version === '001') return JurySC_01_v001_ABI;
  if (iteration.version === '002') return JurySC_01_v002_ABI;
  return JurySC_02_v001_ABI; // Default to v02 for "003" and future versions
}

// Helper to select PoB ABI based on version
function getPoBContractABI(version: string | undefined) {
  if (version === '001' || version === '002') return PoB_01ABI;
  return PoB_02ABI; // Default to v02 for "003" and future versions
}

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

interface CommunityBadgeState extends Badge {
  hasVoted: boolean;
  vote: string | null;
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value) return null;
  if (value === ethers.ZeroAddress) return null;
  return value;
}

export function useContractState(
  signer: JsonRpcSigner | null,
  walletAddress: string | null,
  currentIteration: Iteration | null,
  correctNetwork: boolean,
  publicProvider: JsonRpcProvider | null,
  chainId: number | null,
  allIterations: Iteration[],
  currentPage: PageType,
) {
  const [roles, setRoles] = useState<RoleStatuses>({
    community: false,
    devrel: false,
    dao_hic: false,
    project: false,
  });
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [devRelAccount, setDevRelAccount] = useState<string | null>(null);
  const [daoHicVoters, setDaoHicVoters] = useState<string[]>([]);
  const [daoHicIndividualVotes, setDaoHicIndividualVotes] = useState<Record<string, string>>({});
  const [projectsLocked, setProjectsLocked] = useState<boolean>(false);
  const [contractLocked, setContractLocked] = useState<boolean>(false);
  const [voteCounts, setVoteCounts] = useState<{ devRel: number; daoHic: number; community: number }>({
    devRel: 0,
    daoHic: 0,
    community: 0
  });
  const [totalCommunityVoters, setTotalCommunityVoters] = useState<number>(0);
  const [entityVotes, setEntityVotes] = useState<EntityVotes>({
    devRel: null,
    daoHic: null,
    community: null,
  });
  const [badges, setBadges] = useState<Badge[]>([]);
  const [communityBadges, setCommunityBadges] = useState<CommunityBadgeState[]>([]);
  const [devRelVote, setDevRelVote] = useState<string | null>(null);
  const [daoHicVote, setDaoHicVote] = useState<string | null>(null);
  const [winner, setWinner] = useState<{ projectAddress: string | null; hasWinner: boolean }>({
    projectAddress: null,
    hasWinner: false,
  });
  const [votingMode, setVotingMode] = useState<number>(0); // 0 = CONSENSUS, 1 = WEIGHTED
  const [projectScores, setProjectScores] = useState<{
    addresses: string[];
    scores: string[];
    totalPossible: string;
  } | null>(null);
  const [statusFlags, setStatusFlags] = useState<{ isActive: boolean; votingEnded: boolean }>({
    isActive: false,
    votingEnded: false,
  });
  const [iterationTimes, setIterationTimes] = useState<{ startTime: number | null; endTime: number | null }>({
    startTime: null,
    endTime: null,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [hasLoadError, setHasLoadError] = useState<boolean>(false);

  const selectedChainId = currentIteration?.chainId ?? null;

  const resetState = useCallback(() => {
    setRoles({
      community: false,
      devrel: false,
      dao_hic: false,
      project: false,
    });
    setIsOwner(false);
    setBadges([]);
    setCommunityBadges([]);
    setProjects([]);
    setEntityVotes({ devRel: null, daoHic: null, community: null });
    setDevRelVote(null);
    setDaoHicVote(null);
    setWinner({ projectAddress: null, hasWinner: false });
    setStatusFlags({ isActive: false, votingEnded: false });
    setIterationTimes({ startTime: null, endTime: null });
    setHasLoadError(false);
    setDevRelAccount(null);
    setDaoHicVoters([]);
    setDaoHicIndividualVotes({});
    setProjectsLocked(false);
    setContractLocked(false);
    setVoteCounts({ devRel: 0, daoHic: 0, community: 0 });
  }, []);

  /**
   * Load iteration data from the API indexer.
   * This provides a faster alternative to direct RPC calls for display data.
   * Returns the snapshot if successful, null if API unavailable (fallback to RPC).
   */
  const loadFromAPI = useCallback(
    async (): Promise<IterationSnapshot | null> => {
      if (!currentIteration) return null;

      console.log('[loadFromAPI] Fetching iteration data from API...');
      try {
        const snapshot = await iterationsAPI.getIteration(
          currentIteration.chainId,
          currentIteration.iteration
        );

        if (!snapshot) {
          console.log('[loadFromAPI] No snapshot found in API (iteration may not be indexed yet)');
          return null;
        }

        console.log('[loadFromAPI] Received snapshot, applying to state...');

        // Apply API data to state

        // Projects - always set, even if empty (to clear previous iteration's projects)
        const apiProjects: Project[] = (snapshot.projects || []).map((p, index) => ({
          id: index + 1,
          address: p.address,
          metadata: (p.metadata as unknown as ProjectMetadata) || {
            name: `Project #${index + 1}`,
            account: p.address,
            chainId: snapshot.chainId,
          },
        }));
        setProjects(apiProjects);
        console.log(`[loadFromAPI] Loaded ${apiProjects.length} projects from API`);

        // Flags
        setProjectsLocked(snapshot.projectsLocked);
        setContractLocked(snapshot.contractLocked);

        // Entity votes
        setEntityVotes({
          devRel: snapshot.entityVotes.devRel,
          daoHic: snapshot.entityVotes.daoHic,
          community: snapshot.entityVotes.community,
        });

        // Winner
        setWinner({
          projectAddress: snapshot.winner.projectAddress,
          hasWinner: snapshot.winner.hasWinner,
        });

        // Voting mode and scores
        setVotingMode(snapshot.votingMode);
        setProjectScores(snapshot.projectScores);

        // Times - derive status flags from juryState
        if (snapshot.startTime !== null && snapshot.endTime !== null) {
          setIterationTimes({
            startTime: snapshot.startTime,
            endTime: snapshot.endTime,
          });
        }

        // Derive status flags from juryState
        const isActive = snapshot.juryState === 'active';
        const votingEnded = snapshot.juryState === 'ended' || snapshot.juryState === 'locked';
        setStatusFlags({ isActive, votingEnded });

        // Vote counts
        setVoteCounts({
          devRel: snapshot.totals.devRel,
          daoHic: snapshot.totals.daoHic,
          community: snapshot.totals.community,
        });

        // Owner data
        setDevRelAccount(snapshot.devRelAccount);
        setDaoHicVoters(snapshot.daoHicVoters);
        setDaoHicIndividualVotes(snapshot.daoHicIndividualVotes || {});

        // Community voting is unlimited
        setTotalCommunityVoters(0);

        console.log('[loadFromAPI] Complete. State updated from API.');
        return snapshot;
      } catch (error) {
        console.warn('[loadFromAPI] API call failed, will fall back to RPC:', error);
        return null;
      }
    },
    [currentIteration]
  );

  const loadProjects = useCallback(
    async (contract: Contract) => {
      if (!currentIteration || !publicProvider || selectedChainId === null) {
        setProjects([]);
        return;
      }

      console.log('[loadProjects] Starting...');
      const iterationNum = currentIteration.iteration;

      try {
        // Load flags from contract
        const [projectsLockedFlag, contractLockedFlag] = await cachedPromiseAll(publicProvider, selectedChainId, [
          { key: `iteration:${iterationNum}:projectsLocked`, promise: contract.projectsLocked().catch(() => false) },
          { key: `iteration:${iterationNum}:locked`, promise: contract.locked().catch(() => false) },
        ]);

        setProjectsLocked(Boolean(projectsLockedFlag));
        setContractLocked(Boolean(contractLockedFlag));

        // Get project addresses from JurySC contract using getProjectAddresses()
        let addresses: string[] = [];
        try {
          addresses = await contract.getProjectAddresses();
          console.log(`[loadProjects] Found ${addresses.length} projects via getProjectAddresses()`);
        } catch (err) {
          console.warn('[loadProjects] getProjectAddresses() not available, falling back to projectAddress(i)');
          // Fallback for older contracts without getProjectAddresses()
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
          setProjects([]);
          console.log('[loadProjects] No projects found');
          return;
        }

        // Get project metadata CIDs from PoBRegistry
        const cidMap = await batchGetProjectMetadataCIDs(
          selectedChainId,
          currentIteration.jurySC,
          addresses,
          publicProvider
        );

        // Fetch metadata from API using batch endpoint
        const cids = Array.from(cidMap.values()).filter(cid => cid.length > 0);
        const metadataMap = cids.length > 0
          ? await metadataAPI.batchGetByCIDs(cids)
          : {};

        // Build projects array
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

        setProjects(entries);
        console.log('[loadProjects] Complete. Loaded', entries.length, 'projects', '| projectsLocked:', projectsLockedFlag, '| contractLocked:', contractLockedFlag);
      } catch (error) {
        console.error('[loadProjects] Failed to load projects:', error);
        setProjects([]);
      }
    },
    [publicProvider, selectedChainId, currentIteration],
  );


  const loadOwnerData = useCallback(
    async (contract: Contract) => {
      console.log('[loadOwnerData] Starting...');
      const iterationNum = currentIteration?.iteration;
      try {
        const [devRelAddress, daoHicAddressesResponse] = await cachedPromiseAll(publicProvider, selectedChainId, [
          { key: `iteration:${iterationNum}:devRelAccount`, promise: contract.devRelAccount().catch(() => ethers.ZeroAddress) },
          { key: `iteration:${iterationNum}:getDaoHicVoters`, promise: contract.getDaoHicVoters().catch(() => [] as string[]) },
        ]);

        const normalizedDevRel =
          typeof devRelAddress === 'string' && devRelAddress !== ethers.ZeroAddress ? devRelAddress : null;
        const normalizedDaoHic = (Array.isArray(daoHicAddressesResponse) ? daoHicAddressesResponse : []).filter(
          (addr): addr is string =>
            typeof addr === 'string' && addr.length > 0 && addr !== ethers.ZeroAddress,
        );

        setDevRelAccount(normalizedDevRel);
        setDaoHicVoters(normalizedDaoHic);
        console.log(
          '[loadOwnerData] Complete. DevRel:',
          normalizedDevRel ?? 'Not set',
          'DaoHic voters:',
          normalizedDaoHic.length,
        );
      } catch (error) {
        console.error('[loadOwnerData] Error:', error);
        setDevRelAccount(null);
        setDaoHicVoters([]);
        setDaoHicIndividualVotes({});
      }
    },
    [publicProvider, selectedChainId, currentIteration],
  );

  const loadEntityVotes = useCallback(async (contract: Contract, isActive: boolean, votingEnded: boolean) => {
    console.log('[loadEntityVotes] Starting... isActive:', isActive, 'votingEnded:', votingEnded);

    try {
      const iterationNum = currentIteration?.iteration;

      // Only load entity votes if contract is active or voting has ended
      if (!isActive && !votingEnded) {
        console.log('[loadEntityVotes] Skipping entity votes - contract not active and voting not ended');
        setEntityVotes({ devRel: null, daoHic: null, community: null });
        setWinner({ projectAddress: null, hasWinner: false });
        return;
      }

      console.log('[loadEntityVotes] Loading entity votes from contract...');

      // Detect voting mode based on contract version
      // v001: Always CONSENSUS, use getWinner()
      // v002: Dual mode - detect by checking which winner function returns a result
      // v003+: Trust votingMode() from contract
      const version = currentIteration?.version || '003';
      let detectedMode = 0;
      let winnerRaw: [string, boolean] = [ethers.ZeroAddress, false];

      if (version === '001') {
        // v001: Always CONSENSUS
        detectedMode = 0;
        winnerRaw = await contract.getWinner().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
        console.log('[loadEntityVotes] v001 contract - CONSENSUS mode');
      } else if (version === '002') {
        // v002: Dual mode - detect by checking which has a winner
        const [consensusWinner, weightedWinner] = await Promise.all([
          contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean]),
          contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]),
        ]) as [[string, boolean], [string, boolean]];

        if (weightedWinner[1] && !consensusWinner[1]) {
          detectedMode = 1;
          winnerRaw = weightedWinner;
          console.log('[loadEntityVotes] v002 dual - detected WEIGHTED mode');
        } else {
          detectedMode = 0;
          winnerRaw = consensusWinner;
          console.log('[loadEntityVotes] v002 dual - detected CONSENSUS mode');
        }
      } else {
        // v003+: Trust votingMode() from contract, but apply override if needed
        const contractMode = Number(await contract.votingMode().catch(() => 0));
        const jurySCAddress = currentIteration?.jurySC?.toLowerCase() || '';
        detectedMode = VOTING_MODE_OVERRIDES[jurySCAddress] ?? contractMode;
        winnerRaw = detectedMode === 0
          ? await contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean]
          : await contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
        console.log('[loadEntityVotes] v003+ contract - using votingMode():', detectedMode, jurySCAddress in VOTING_MODE_OVERRIDES ? '(overridden)' : '');
      }

      setVotingMode(detectedMode);

      const [devRelRaw, daoHicRaw, communityRaw] = await cachedPromiseAll(publicProvider, selectedChainId, [
        { key: `iteration:${iterationNum}:getDevRelEntityVote`, promise: contract.getDevRelEntityVote().catch(() => ethers.ZeroAddress) },
        { key: `iteration:${iterationNum}:getDaoHicEntityVote`, promise: contract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress) },
        { key: `iteration:${iterationNum}:getCommunityEntityVote`, promise: contract.getCommunityEntityVote().catch(() => ethers.ZeroAddress) },
      ]);

      const devRelAddress = normalizeAddress(devRelRaw);
      const daoHicAddress = normalizeAddress(daoHicRaw);
      const communityAddress = normalizeAddress(communityRaw);
      const [winnerAddressRaw, hasWinnerRaw] = Array.isArray(winnerRaw)
        ? winnerRaw
        : [ethers.ZeroAddress, false];

      setEntityVotes({
        devRel: devRelAddress,
        daoHic: daoHicAddress,
        community: communityAddress,
      });

      setWinner({
        projectAddress: normalizeAddress(winnerAddressRaw),
        hasWinner: Boolean(hasWinnerRaw),
      });

      // Load project scores if voting ended and in weighted mode
      if (votingEnded && detectedMode === 1) {
        try {
          const [addresses, scores, totalPossible] = await contract.getWinnerWithScores();
          setProjectScores({
            addresses: addresses as string[],
            scores: (scores as bigint[]).map(s => s.toString()),
            totalPossible: (totalPossible as bigint).toString(),
          });
        } catch (error) {
          console.log('[loadEntityVotes] getWinnerWithScores not available or failed:', error);
          setProjectScores(null);
        }
      } else {
        setProjectScores(null);
      }

      console.log(
        '[loadEntityVotes] Complete. DevRel:',
        devRelAddress ?? 'None',
        'DaoHic:',
        daoHicAddress ?? 'None',
        'Community:',
        communityAddress ?? 'None',
        'VotingMode:',
        detectedMode === 0 ? 'CONSENSUS' : 'WEIGHTED',
      );
    } catch (error) {
      console.error('[loadEntityVotes] Error:', error);
      // If entity votes fail, just set defaults
      setEntityVotes({ devRel: null, daoHic: null, community: null });
      setWinner({ projectAddress: null, hasWinner: false });
    }
  }, [publicProvider, selectedChainId, currentIteration]);

  const loadRoles = useCallback(
    async (contract: Contract, address: string) => {
      console.log('[loadRoles] Starting for address:', address);
      const iterationNum = currentIteration?.iteration;
      const [isDevRel, isDaoHic, isProject, owner] = await cachedPromiseAll(publicProvider, selectedChainId, [
        { key: `iteration:${iterationNum}:isDevRelAccount:${address}`, promise: contract.isDevRelAccount(address) },
        { key: `iteration:${iterationNum}:isDaoHicVoter:${address}`, promise: contract.isDaoHicVoter(address) },
        { key: `iteration:${iterationNum}:isRegisteredProject:${address}`, promise: contract.isRegisteredProject(address) },
        { key: `iteration:${iterationNum}:owner`, promise: contract.owner() },
      ]);
      console.log('[loadRoles] Contract owner:', owner);
      console.log('[loadRoles] Connected address:', address);
      setRoles({
        community: false,
        devrel: Boolean(isDevRel),
        dao_hic: Boolean(isDaoHic),
        project: Boolean(isProject),
      });
      const ownerStatus = owner.toLowerCase() === address.toLowerCase();
      setIsOwner(ownerStatus);
      console.log('[loadRoles] Complete. DevRel:', Boolean(isDevRel), 'DaoHic:', Boolean(isDaoHic), 'Project:', Boolean(isProject), 'IS OWNER:', ownerStatus);
    },
    [publicProvider, selectedChainId, currentIteration],
  );

  /**
   * Load user-specific vote data only (for DevRel/DAO HIC individual votes)
   * Used when API data is available (status flags already set)
   */
  const loadUserVotes = useCallback(
    async (contract: Contract, address: string | null) => {
      console.log('[loadUserVotes] Starting for address:', address);
      const iterationNum = currentIteration?.iteration;
      const [devRelVoted, devRelVoteValue, daoVote, daoVoted] =
        await cachedPromiseAll(publicProvider, selectedChainId, [
          { key: `iteration:${iterationNum}:devRelHasVoted`, promise: contract.devRelHasVoted() },
          { key: `iteration:${iterationNum}:devRelVote`, promise: contract.devRelVote() },
          { key: `iteration:${iterationNum}:daoHicVoteOf:${address}`, promise: address ? contract.daoHicVoteOf(address) : Promise.resolve(null) },
          { key: `iteration:${iterationNum}:daoHicHasVoted:${address}`, promise: address ? contract.daoHicHasVoted(address) : Promise.resolve(false) },
        ]);

      const normalizedDevRelVote = Boolean(devRelVoted) ? normalizeAddress(devRelVoteValue) : null;
      const normalizedDaoVote = Boolean(daoVoted) ? normalizeAddress(daoVote) : null;

      setDevRelVote(normalizedDevRelVote);
      setDaoHicVote(normalizedDaoVote);

      console.log('[loadUserVotes] Complete. DevRel vote:', normalizedDevRelVote ?? 'Not cast');
      console.log('[loadUserVotes] DAO HIC vote:', normalizedDaoVote ?? 'Not cast');
    },
    [publicProvider, selectedChainId, currentIteration],
  );

  /**
   * Load full voting status including state flags (for RPC fallback path)
   */
  const loadVotingStatus = useCallback(
    async (contract: Contract, address: string | null) => {
      console.log('[loadVotingStatus] Starting for address:', address);
      const iterationNum = currentIteration?.iteration;
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

      const statusFlags = {
        isActive: Boolean(isActive),
        votingEnded: Boolean(votingEnded),
      };

      setStatusFlags(statusFlags);

      const normalizedDevRelVote = Boolean(devRelVoted) ? normalizeAddress(devRelVoteValue) : null;
      const normalizedDaoVote = Boolean(daoVoted) ? normalizeAddress(daoVote) : null;

      setDevRelVote(normalizedDevRelVote);
      setDaoHicVote(normalizedDaoVote);

      const times = {
        startTime: Number(startTime),
        endTime: Number(endTime),
      };
      setIterationTimes(times);

      console.log('[loadVotingStatus] Complete. isActive:', statusFlags.isActive, 'votingEnded:', statusFlags.votingEnded);
      console.log('[loadVotingStatus] DevRel vote:', normalizedDevRelVote ?? 'Not cast');
      console.log('[loadVotingStatus] DAO HIC vote:', normalizedDaoVote ?? 'Not cast');
      console.log('[loadVotingStatus] Times - start:', times.startTime, 'end:', times.endTime);
      return statusFlags;
    },
    [publicProvider, selectedChainId, currentIteration],
  );

  const loadVoteCounts = useCallback(
    async (juryContract: Contract) => {
      console.log('[loadVoteCounts] Starting...');
      const iterationNum = currentIteration?.iteration;
      try {
        const [[devRelCount, daoHicCount, communityCount], daoHicAddressesResponse] = await cachedPromiseAll(publicProvider, selectedChainId, [
          { key: `iteration:${iterationNum}:getVoteParticipationCounts`, promise: juryContract.getVoteParticipationCounts() },
          { key: `iteration:${iterationNum}:getDaoHicVoters`, promise: juryContract.getDaoHicVoters().catch(() => [] as string[]) },
        ]);

        setVoteCounts({
          devRel: Number(devRelCount),
          daoHic: Number(daoHicCount),
          community: Number(communityCount),
        });

        // Update daoHicVoters array for progress display
        const normalizedDaoHic = (Array.isArray(daoHicAddressesResponse) ? daoHicAddressesResponse : []).filter(
          (addr): addr is string =>
            typeof addr === 'string' && addr.length > 0 && addr !== ethers.ZeroAddress,
        );
        setDaoHicVoters(normalizedDaoHic);

        // Community voting is unlimited (anyone can mint with deposit during voting, amount varies by network)
        // So we set totalCommunityVoters to 0 which will display as ∞ in the UI
        setTotalCommunityVoters(0);

        console.log('[loadVoteCounts] Complete. DevRel:', devRelCount.toString(), '/ 1, DAO HIC:', daoHicCount.toString(), '/', normalizedDaoHic.length, 'Community:', communityCount.toString(), '/ ∞');
      } catch (error) {
        console.error('[loadVoteCounts] Error:', error);
        setVoteCounts({ devRel: 0, daoHic: 0, community: 0 });
        setDaoHicVoters([]);
        setDaoHicIndividualVotes({});
        setTotalCommunityVoters(0);
      }
    },
    [publicProvider, selectedChainId, currentIteration],
  );

  /**
   * Load minimal badge metadata (tokenId, role, claimed) for display
   * This is optimized for the badges page and uses batched RPC calls
   */
  const loadBadgesMinimal = useCallback(
    async (
      address: string,
      rpcProvider: JsonRpcProvider,
      allIterations: Iteration[],
    ) => {
      console.log('[loadBadgesMinimal] Starting for address:', address);
      console.log('[loadBadgesMinimal] Loading badges from', allIterations.length, 'iterations');

      const allBadgesMap = new Map<string, Badge>();

      // Build list of all PoB contracts to query (main rounds + previous rounds)
      const contractsToQuery: Array<{ iteration: number; round?: number; pob: string; chainId: number; deployBlockHint?: number; version?: string }> = [];

      for (const iteration of allIterations) {
        // Add current/main round
        contractsToQuery.push({
          iteration: iteration.iteration,
          round: iteration.round,
          pob: iteration.pob,
          chainId: iteration.chainId,
          deployBlockHint: iteration.deployBlockHint,
          version: iteration.version,
        });

        // Add previous rounds if they exist
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

      console.log(`[loadBadgesMinimal] Querying ${contractsToQuery.length} PoB contracts (main rounds + prev rounds) in PARALLEL`);

      // OPTIMIZATION: Query ALL contracts in parallel instead of sequentially
      const contractPromises = contractsToQuery.map(async (contract) => {
        const roundLabel = contract.round ? ` Round #${contract.round}` : '';
        try {
          // Select ABI based on version (PoB follows same versioning as JurySC)
          const pobABI = getPoBContractABI(contract.version);
          const iface = new Interface(pobABI);
          const transferTopic = iface.getEvent('Transfer')?.topicHash;
          if (!transferTopic) return [];

          const iterationPobContract = new Contract(contract.pob, pobABI, rpcProvider);
          const fromBlock = contract.deployBlockHint !== undefined ? contract.deployBlockHint : 0;

          console.log(`[loadBadgesMinimal] Querying iteration ${contract.iteration}${roundLabel} from block:`, fromBlock);

          // Fetch Transfer logs for this user
          const logs = await rpcProvider.getLogs({
            address: contract.pob,
            fromBlock,
            toBlock: 'latest',
            topics: [transferTopic, null, ethers.zeroPadValue(address, 32)],
          });

          console.log(`[loadBadgesMinimal] Found ${logs?.length || 0} transfer logs for iteration ${contract.iteration}${roundLabel}`);

          if (!logs?.length) return [];

          // Parse all tokenIds from logs
          const tokenIds: string[] = [];
          for (const log of logs) {
            try {
              const parsed = iface.parseLog(log);
              // Transfer event: Transfer(address from, address to, uint256 tokenId)
              // Access tokenId by name or by index [2] for compatibility
              const tokenId = parsed?.args?.tokenId ?? parsed?.args?.[2];
              if (tokenId !== undefined && tokenId !== null) {
                tokenIds.push(tokenId.toString());
              }
            } catch (parseError) {
              console.warn('Failed to parse badge log', parseError);
            }
          }

          if (tokenIds.length === 0) {
            console.warn('[loadBadgesMinimal] No tokenIds parsed from logs');
            return [];
          }

          console.log(`[loadBadgesMinimal] Parsed ${tokenIds.length} tokenIds, batching RPC calls...`);

          // OPTIMIZATION: Batch all RPC calls for this contract
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

          // Split results: first half is roles, second half is claimed statuses
          const roles = results.slice(0, tokenIds.length);
          const claimedStatuses = results.slice(tokenIds.length);

          // Build badge objects
          const badges: Badge[] = [];
          for (let i = 0; i < tokenIds.length; i++) {
            badges.push({
              tokenId: tokenIds[i],
              role: roles[i].toLowerCase() as ParticipantRole,
              iteration: contract.iteration, // Use iteration from JSON, not RPC
              round: contract.round,
              claimed: claimedStatuses[i],
            });
          }

          console.log(`[loadBadgesMinimal] Loaded ${tokenIds.length} badges for iteration ${contract.iteration}${roundLabel}`);
          return badges;
        } catch (iterationError) {
          console.warn(`Failed to load badges from iteration ${contract.iteration}${roundLabel}`, iterationError);
          return [];
        }
      });

      // Wait for all contracts to be processed in parallel
      const badgeArrays = await Promise.all(contractPromises);

      // Flatten and deduplicate badges
      for (const badges of badgeArrays) {
        for (const badge of badges) {
          const badgeKey = `${badge.iteration}-${badge.round || 'main'}-${badge.tokenId}`;
          allBadgesMap.set(badgeKey, badge);
        }
      }

      const badgeList = Array.from(allBadgesMap.values());
      setBadges(badgeList);

      // Update community role flag (must match current iteration AND round)
      setRoles((current) => ({
        ...current,
        community: badgeList.some((badge) =>
          badge.role === 'community' &&
          badge.iteration === currentIteration?.iteration &&
          badge.round === currentIteration?.round
        ),
      }));

      console.log('[loadBadgesMinimal] Complete. Total badges across all iterations:', badgeList.length);
      return badgeList;
    },
    [currentIteration],
  );

  /**
   * Load voting data for community badges in the current iteration
   * This is only needed on the iteration page for displaying voting status
   */
  const loadBadgesVotingData = useCallback(
    async (
      rpcProvider: JsonRpcProvider,
      badgeList: Badge[],
    ) => {
      if (!currentIteration) return;

      console.log('[loadBadgesVotingData] Loading voting data for community badges in current iteration');

      const communityMap = new Map<string, CommunityBadgeState>();

      // Filter to only community badges in current iteration
      const currentIterationCommunityBadges = badgeList.filter(
        badge =>
          badge.role === 'community' &&
          badge.iteration === currentIteration.iteration &&
          badge.round === currentIteration.round
      );

      if (currentIterationCommunityBadges.length === 0) {
        console.log('[loadBadgesVotingData] No community badges in current iteration');
        setCommunityBadges([]);
        return;
      }

      console.log(`[loadBadgesVotingData] Loading voting data for ${currentIterationCommunityBadges.length} community badges`);

      try {
        const iterationJuryContract = new Contract(
          currentIteration.jurySC,
          getJurySCABI(currentIteration),
          rpcProvider
        );

        // OPTIMIZATION: Batch all voting data calls
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

        // Split results: first half is hasVoted, second half is votes
        const hasVotedResults = results.slice(0, currentIterationCommunityBadges.length);
        const voteResults = results.slice(currentIterationCommunityBadges.length);

        // Build community badge state objects
        for (let i = 0; i < currentIterationCommunityBadges.length; i++) {
          const badge = currentIterationCommunityBadges[i];
          const badgeKey = `${badge.iteration}-${badge.round || 'main'}-${badge.tokenId}`;

          communityMap.set(badgeKey, {
            ...badge,
            hasVoted: Boolean(hasVotedResults[i]),
            vote: normalizeAddress(voteResults[i]),
          });
        }

        setCommunityBadges(Array.from(communityMap.values()));
        console.log('[loadBadgesVotingData] Complete. Loaded voting data for', communityMap.size, 'badges');
      } catch (error) {
        console.warn('Failed to load voting data for community badges', error);
        setCommunityBadges([]);
      }
    },
    [currentIteration],
  );

  const refreshProjects = useCallback(async () => {
    if (!signer || !currentIteration) return;
    console.log('[refreshProjects] Refreshing projects list...');
    const contract = new Contract(currentIteration.jurySC, getJurySCABI(currentIteration), signer);
    await loadProjects(contract);
  }, [signer, currentIteration, loadProjects]);

  const refreshOwnerData = useCallback(async () => {
    if (!signer || !currentIteration) return;
    console.log('[refreshOwnerData] Refreshing owner data...');
    const contract = new Contract(currentIteration.jurySC, getJurySCABI(currentIteration), signer);
    await loadOwnerData(contract);
  }, [signer, currentIteration, loadOwnerData]);

  const refreshVotingData = useCallback(async () => {
    if (!signer || !currentIteration || !walletAddress) return;
    console.log('[refreshVotingData] Refreshing voting data (bypassing cache)...');
    const juryContract = new Contract(currentIteration.jurySC, getJurySCABI(currentIteration), signer);

    // Bypass cache for fresh data after transaction
    const iterationNum = currentIteration?.iteration;
    const [isActive, votingEnded, devRelVoted, devRelVoteValue, daoVote, daoVoted, startTime, endTime] =
      await cachedPromiseAll(publicProvider, selectedChainId, [
        { key: `iteration:${iterationNum}:isActive`, promise: juryContract.isActive(), skipCache: true },
        { key: `iteration:${iterationNum}:votingEnded`, promise: juryContract.votingEnded(), skipCache: true },
        { key: `iteration:${iterationNum}:devRelHasVoted`, promise: juryContract.devRelHasVoted(), skipCache: true },
        { key: `iteration:${iterationNum}:devRelVote`, promise: juryContract.devRelVote(), skipCache: true },
        { key: `iteration:${iterationNum}:daoHicVoteOf:${walletAddress}`, promise: juryContract.daoHicVoteOf(walletAddress), skipCache: true },
        { key: `iteration:${iterationNum}:daoHicHasVoted:${walletAddress}`, promise: juryContract.daoHicHasVoted(walletAddress), skipCache: true },
        { key: `iteration:${iterationNum}:startTime`, promise: juryContract.startTime(), skipCache: true },
        { key: `iteration:${iterationNum}:endTime`, promise: juryContract.endTime(), skipCache: true },
      ]);

    const statusFlags = {
      isActive: Boolean(isActive),
      votingEnded: Boolean(votingEnded),
    };
    setStatusFlags(statusFlags);

    const normalizedDevRelVote = Boolean(devRelVoted) ? normalizeAddress(devRelVoteValue) : null;
    const normalizedDaoVote = Boolean(daoVoted) ? normalizeAddress(daoVote) : null;

    setDevRelVote(normalizedDevRelVote);
    setDaoHicVote(normalizedDaoVote);

    const times = {
      startTime: Number(startTime),
      endTime: Number(endTime),
    };
    setIterationTimes(times);

    console.log('[refreshVotingData] DevRel vote:', normalizedDevRelVote ?? 'Not cast');
    console.log('[refreshVotingData] DAO HIC vote:', normalizedDaoVote ?? 'Not cast');

    await loadEntityVotes(juryContract, statusFlags.isActive, statusFlags.votingEnded);
    if (statusFlags.isActive || statusFlags.votingEnded) {
      console.log('[refreshVotingData] Calling loadVoteCounts...');
      await loadVoteCounts(juryContract);
    } else {
      console.log('[refreshVotingData] Skipping loadVoteCounts - not active/ended');
    }

    // Also refresh badges for community voters (reloads community votes)
    if (publicProvider && walletAddress) {
      const badgeList = await loadBadgesMinimal(walletAddress, publicProvider, allIterations);
      if (badgeList && badgeList.length > 0) {
        await loadBadgesVotingData(publicProvider, badgeList);
      }
    }
  }, [signer, currentIteration, walletAddress, publicProvider, selectedChainId, loadEntityVotes, loadVoteCounts, loadBadgesMinimal, loadBadgesVotingData, allIterations]);

  const refreshBadges = useCallback(async () => {
    if (!publicProvider || !currentIteration || !walletAddress) return;
    console.log('[refreshBadges] Refreshing badges...');
    const badgeList = await loadBadgesMinimal(walletAddress, publicProvider, allIterations);
    if (badgeList && badgeList.length > 0) {
      await loadBadgesVotingData(publicProvider, badgeList);
    }
  }, [currentIteration, walletAddress, publicProvider, allIterations, loadBadgesMinimal, loadBadgesVotingData]);

  const loadIterationState = useCallback(async () => {
    console.log('=== [loadIterationState] Starting ===');
    console.log('[loadIterationState] Checking conditions...');
    console.log('  - signer:', !!signer);
    console.log('  - walletAddress:', walletAddress);
    console.log('  - currentIteration:', currentIteration?.name);
    console.log('  - correctNetwork:', correctNetwork);
    console.log('  - publicProvider:', !!publicProvider);
    console.log('  - false:', false);
    console.log('  - hasLoadError:', hasLoadError);

    // Only require publicProvider and currentIteration for read-only data
    // Wallet/signer only needed for write operations (which will be disabled in UI)
    if (!currentIteration || !correctNetwork || !publicProvider) {
      console.log('[loadIterationState] Skipping - missing required conditions');
      return;
    }
    if (false) {
      console.log('[loadIterationState] Skipping - project metadata still loading');
      return;
    }
    if (hasLoadError) {
      console.log('[loadIterationState] Skipping - has load error');
      return;
    }
    if (chainId !== null && currentIteration?.chainId !== chainId) {
      console.log('[loadIterationState] Skipping - chain mismatch. Expected:', currentIteration?.chainId, 'Got:', chainId);
      return;
    }

    // Validate addresses are valid hex (not ENS or placeholders)
    const isValidAddress = (addr: string) => /^0x[0-9a-fA-F]{40}$/.test(addr);
    if (!isValidAddress(currentIteration?.jurySC) || !isValidAddress(currentIteration?.pob)) {
      console.error('[loadIterationState] Invalid contract addresses');
      throw new Error('Iteration addresses are invalid or not configured. Please check iterations.json');
    }

    console.log('[loadIterationState] All conditions met - proceeding with load');
    setLoading(true);
    setHasLoadError(false);
    try {
      // Use publicProvider for read-only operations, signer for write operations (if available)
      const juryContract = new Contract(currentIteration.jurySC, getJurySCABI(currentIteration), publicProvider);

      const isIterationLikePage = currentPage === 'iteration' || currentPage === 'project';

      // Phase 1: Try to load display data from API (faster, cached)
      console.log('[loadIterationState] Phase 1: Trying API for display data...');
      const apiSnapshot = await loadFromAPI();

      // Phase 2: Load user-specific data via RPC (always needed for wallet interactions)
      console.log('[loadIterationState] Phase 2: Loading user-specific data via RPC...');
      console.log('[loadIterationState] Current page:', currentPage);

      // Build loading tasks for user-specific data
      const loadTasks: Promise<unknown>[] = [];

      // Always load roles if wallet connected (needed to determine panels)
      if (walletAddress) {
        loadTasks.push(loadRoles(juryContract, walletAddress));
      }

      // If API succeeded, we only need user-specific data
      // If API failed, we need to load everything via RPC
      if (apiSnapshot) {
        console.log('[loadIterationState] API data loaded - only loading user-specific data via RPC');

        // Load user's vote data only (status flags already set from API)
        if (walletAddress) {
          loadTasks.push(loadUserVotes(juryContract, walletAddress));
        }

        // Load badges - only on badges page OR if on iteration/project page with wallet
        if (currentPage === 'badges' && walletAddress) {
          console.log('[loadIterationState] Loading badges (badges page) - minimal data only');
          loadTasks.push(
            loadBadgesMinimal(walletAddress, publicProvider, allIterations).then(() => {})
          );
        } else if (isIterationLikePage && walletAddress) {
          console.log('[loadIterationState] Loading badges (iteration/project page) - with voting data');
          const badgesPromise = loadBadgesMinimal(walletAddress, publicProvider, allIterations).then(badgeList => {
            if (badgeList && badgeList.length > 0) {
              return loadBadgesVotingData(publicProvider, badgeList);
            }
          });
          loadTasks.push(badgesPromise);
        }
      } else {
        // API failed - fall back to full RPC loading
        console.log('[loadIterationState] API unavailable - falling back to full RPC loading');

        // First, load voting status to get state flags
        const statusResult = await loadVotingStatus(juryContract, walletAddress);

        // Add remaining RPC tasks
        loadTasks.push(
          // Load entity votes
          loadEntityVotes(juryContract, statusResult.isActive, statusResult.votingEnded)
        );

        // Lazy load projects - only on iteration and project pages
        if (isIterationLikePage) {
          console.log('[loadIterationState] Loading projects (iteration/project page)');
          loadTasks.push(loadProjects(juryContract));
        }

        // Lazy load owner data - only on iteration page AND if owner
        if (currentPage === 'iteration' && walletAddress && isOwner) {
          console.log('[loadIterationState] Loading owner data (owner on iteration page)');
          loadTasks.push(loadOwnerData(juryContract));
        }

        // Lazy load badges
        if (currentPage === 'badges' && walletAddress) {
          console.log('[loadIterationState] Loading badges (badges page) - minimal data only');
          loadTasks.push(
            loadBadgesMinimal(walletAddress, publicProvider, allIterations).then(() => {})
          );
        } else if (isIterationLikePage && walletAddress) {
          console.log('[loadIterationState] Loading badges (iteration/project page) - with voting data');
          const badgesPromise = loadBadgesMinimal(walletAddress, publicProvider, allIterations).then(badgeList => {
            if (badgeList && badgeList.length > 0) {
              return loadBadgesVotingData(publicProvider, badgeList);
            }
          });
          loadTasks.push(badgesPromise);
        }

        // Lazy load vote counts - only on iteration page AND if active/ended
        if (currentPage === 'iteration' && (statusResult.isActive || statusResult.votingEnded)) {
          console.log('[loadIterationState] Loading vote counts (active/ended on iteration page)');
          loadTasks.push(loadVoteCounts(juryContract));
        }
      }

      await Promise.all(loadTasks);
      console.log('=== [loadIterationState] Complete ===');
    } catch (contractError) {
      console.error('[loadIterationState] Error:', contractError);
      setHasLoadError(true);
      throw contractError;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    signer,
    walletAddress,
    currentIteration,
    correctNetwork,
    publicProvider,
    false,
    hasLoadError,
    chainId,
    allIterations,
    currentPage,
    isOwner,
  ]);

  // Load iteration when iteration is selected (wallet optional for read-only viewing)
  useEffect(() => {
    // Skip loading on iterations page (front page) - only iteration statuses are needed there
    if (currentPage === 'iterations') {
      console.log('[useEffect] Skipping loadIterationState - on iterations page (only statuses needed)');
      return;
    }

    if (currentIteration && publicProvider && correctNetwork && !hasLoadError && !false) {
      console.log('[useEffect] Triggering loadIterationState - iteration selected, publicProvider available, metadata loaded');
      loadIterationState().catch((err) => {
        console.error('[useEffect] loadIterationState failed:', err);
      });
    } else if (false) {
      console.log('[useEffect] Waiting for project metadata to load...');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIteration?.iteration, currentIteration?.jurySC, walletAddress, publicProvider, correctNetwork, hasLoadError, false, currentPage]);

  const retryLoadIteration = useCallback(() => {
    setHasLoadError(false);
    loadIterationState().catch((err) => {
      console.error('[retryLoadIteration] failed:', err);
    });
  }, [loadIterationState]);

  return {
    roles,
    isOwner,
    projects,
    setProjects,
    devRelAccount,
    daoHicVoters,
    daoHicIndividualVotes,
    projectsLocked,
    contractLocked,
    voteCounts,
    totalCommunityVoters,
    badges,
    communityBadges,
    devRelVote,
    daoHicVote,
    entityVotes,
    winner,
    votingMode,
    projectScores,
    statusFlags,
    iterationTimes,
    loading,
    hasLoadError,
    resetState,
    loadIterationState,
    refreshProjects,
    refreshOwnerData,
    refreshVotingData,
    refreshBadges,
    retryLoadIteration,
  };
}
