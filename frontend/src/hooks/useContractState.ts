import { useCallback, useEffect, useState } from 'react';
import { Contract, Interface, JsonRpcProvider, JsonRpcSigner, ethers } from 'ethers';
import { JurySC_01ABI, PoB_01ABI } from '~/abis';
import JurySC_01_v001_ABI from '~/abis/JurySC_01_v001.json';
import JurySC_01_v002_ABI from '~/abis/JurySC_01_v002.json';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';
import type {
  Badge,
  Iteration,
  ParticipantRole,
  Project,
  ProjectMetadata,
} from '~/interfaces';

// Helper to select ABI based on iteration version
function getJurySCABI(iteration: Iteration | null) {
  if (!iteration) return JurySC_01ABI; // Default to latest
  if (iteration.version === '001') return JurySC_01_v001_ABI;
  return JurySC_01_v002_ABI; // Default to v002 for "002" and any future versions
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
  projectMetadata: Record<string, ProjectMetadata>,
  projectMetadataLoading: boolean,
  allIterations: Iteration[],
  currentPage: 'iterations' | 'iteration' | 'badges' | 'faq',
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
    scores: bigint[];
    totalPossible: bigint;
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
    setProjectsLocked(false);
    setContractLocked(false);
    setVoteCounts({ devRel: 0, daoHic: 0, community: 0 });
  }, []);

  const loadProjects = useCallback(
    async (contract: Contract) => {
      console.log('[loadProjects] Starting...');
      const iterationNum = currentIteration?.iteration;
      const [countRaw, projectsLockedFlag, contractLockedFlag] = await cachedPromiseAll(publicProvider, selectedChainId, [
        { key: `iteration:${iterationNum}:projectCount`, promise: contract.projectCount() },
        { key: `iteration:${iterationNum}:projectsLocked`, promise: contract.projectsLocked().catch(() => false) },
        { key: `iteration:${iterationNum}:locked`, promise: contract.locked().catch(() => false) },
      ]);
      const count = Number(countRaw);
      console.log('[loadProjects] Project count:', count);
      setProjectsLocked(Boolean(projectsLockedFlag));
      setContractLocked(Boolean(contractLockedFlag));

      // Load all project addresses in parallel
      const projectAddressCalls = [];
      for (let index = 1; index <= count; index += 1) {
        projectAddressCalls.push({
          key: `iteration:${iterationNum}:projectAddress:${index}`,
          promise: contract.projectAddress(index),
        });
      }
      const addresses = await cachedPromiseAll(publicProvider, selectedChainId, projectAddressCalls);

      // Build project entries
      const entries: Project[] = addresses.map((address, idx) => {
        const index = idx + 1; // project IDs are 1-indexed
        const metadataKey = selectedChainId !== null ? `${selectedChainId}:${address.toLowerCase()}` : null;
        return {
          id: index,
          address,
          metadata: metadataKey ? projectMetadata[metadataKey] : undefined,
        };
      });

      setProjects(entries);
      console.log('[loadProjects] Complete. Loaded', entries.length, 'projects', '| projectsLocked:', projectsLockedFlag, '| contractLocked:', contractLockedFlag);
    },
    [publicProvider, selectedChainId, currentIteration, projectMetadata],
  );

  useEffect(() => {
    if (selectedChainId === null) return;
    setProjects((current) =>
      current.map((project) => {
        const key = `${selectedChainId}:${project.address.toLowerCase()}`;
        const metadata = projectMetadata[key];
        if (project.metadata === metadata) {
          return project;
        }
        return {
          ...project,
          metadata,
        };
      }),
    );
  }, [projectMetadata, selectedChainId]);

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
      }
    },
    [publicProvider, selectedChainId, currentIteration],
  );

  const loadEntityVotes = useCallback(async (contract: Contract, isActive: boolean, votingEnded: boolean) => {
    console.log('[loadEntityVotes] Starting... isActive:', isActive, 'votingEnded:', votingEnded);

    try {
      const iterationNum = currentIteration?.iteration;

      // Always load voting mode (regardless of voting status)
      const forcedVotingMode = currentIteration?.votingMode;

      console.log('[loadEntityVotes] currentIteration:', currentIteration);
      console.log('[loadEntityVotes] forcedVotingMode:', forcedVotingMode, 'type:', typeof forcedVotingMode);

      if (forcedVotingMode !== undefined) {
        console.log('[loadEntityVotes] ✅ Using forced voting mode from JSON:', forcedVotingMode);
        setVotingMode(forcedVotingMode);
      } else {
        console.log('[loadEntityVotes] ❌ No forced voting mode, will query contract');
        // Load from contract
        const votingModeFromContract = await contract.votingMode().catch(() => 0);
        setVotingMode(Number(votingModeFromContract));
      }

      // Only load entity votes if contract is active or voting has ended
      if (!isActive && !votingEnded) {
        console.log('[loadEntityVotes] Skipping entity votes - contract not active and voting not ended');
        setEntityVotes({ devRel: null, daoHic: null, community: null });
        setWinner({ projectAddress: null, hasWinner: false });
        return;
      }

      console.log('[loadEntityVotes] Loading entity votes from contract...');

      // Determine which winner function to call based on voting mode
      const currentMode = forcedVotingMode !== undefined ? forcedVotingMode : await contract.votingMode().catch(() => 0);
      const winnerPromise = Number(currentMode) === 0
        ? contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean])
        : contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]);

      const [devRelRaw, daoHicRaw, communityRaw, winnerRaw] = await cachedPromiseAll(publicProvider, selectedChainId, [
        { key: `iteration:${iterationNum}:getDevRelEntityVote`, promise: contract.getDevRelEntityVote().catch(() => ethers.ZeroAddress) },
        { key: `iteration:${iterationNum}:getDaoHicEntityVote`, promise: contract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress) },
        { key: `iteration:${iterationNum}:getCommunityEntityVote`, promise: contract.getCommunityEntityVote().catch(() => ethers.ZeroAddress) },
        { key: `iteration:${iterationNum}:getWinner:${currentMode}`, promise: winnerPromise },
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
      // Note: currentMode was already determined above
      if (votingEnded && Number(currentMode) === 1) {
        try {
          const [addresses, scores, totalPossible] = await contract.getWinnerWithScores();
          setProjectScores({
            addresses: addresses as string[],
            scores: scores as bigint[],
            totalPossible: totalPossible as bigint,
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
        currentMode === 0 ? 'CONSENSUS' : 'WEIGHTED',
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
        setTotalCommunityVoters(0);
      }
    },
    [publicProvider, selectedChainId, currentIteration],
  );

  const loadBadges = useCallback(
    async (
      address: string,
      rpcProvider: JsonRpcProvider,
      allIterations: Iteration[],
    ) => {
      console.log('[loadBadges] Starting for address:', address);
      console.log('[loadBadges] Loading badges from', allIterations.length, 'iterations');

      const iface = new Interface(PoB_01ABI);
      const transferTopic = iface.getEvent('Transfer')?.topicHash;
      if (!transferTopic) return;

      const allBadgesMap = new Map<string, Badge>();
      const communityMap = new Map<string, CommunityBadgeState>();

      // Build list of all PoB contracts to query (main rounds + previous rounds)
      const contractsToQuery: Array<{ iteration: number; round?: number; pob: string; jurySC: string; chainId: number; deployBlockHint?: number }> = [];

      for (const iteration of allIterations) {
        // Add current/main round
        contractsToQuery.push({
          iteration: iteration.iteration,
          round: iteration.round,
          pob: iteration.pob,
          jurySC: iteration.jurySC,
          chainId: iteration.chainId,
          deployBlockHint: iteration.deployBlockHint,
        });

        // Add previous rounds if they exist
        if (iteration.prev_rounds && iteration.prev_rounds.length > 0) {
          for (const prevRound of iteration.prev_rounds) {
            contractsToQuery.push({
              iteration: iteration.iteration,
              round: prevRound.round,
              pob: prevRound.pob,
              jurySC: prevRound.jurySC,
              chainId: iteration.chainId,
              deployBlockHint: prevRound.deployBlockHint,
            });
          }
        }
      }

      console.log(`[loadBadges] Querying ${contractsToQuery.length} PoB contracts (main rounds + prev rounds)`);

      // Query badges from ALL contracts
      for (const contract of contractsToQuery) {
        const roundLabel = contract.round ? ` Round #${contract.round}` : '';
        try {
          const iterationPobContract = new Contract(contract.pob, PoB_01ABI, rpcProvider);
          const fromBlock = contract.deployBlockHint !== undefined ? contract.deployBlockHint : 0;

          console.log(`[loadBadges] Querying iteration ${contract.iteration}${roundLabel} from block:`, fromBlock);

          const [logs, iterationValue] = await Promise.all([
            rpcProvider.getLogs({
              address: contract.pob,
              fromBlock,
              toBlock: 'latest',
              topics: [transferTopic, null, ethers.zeroPadValue(address, 32)],
            }),
            iterationPobContract.iteration(),
          ]);

          const iterationNumber = Number(iterationValue);
          console.log(`[loadBadges] Found ${logs?.length || 0} transfer logs for iteration ${contract.iteration}${roundLabel}`);

          if (!logs?.length) continue;

          for (const log of logs) {
            try {
              const parsed = iface.parseLog(log);
              if (!parsed) continue;
              const tokenId = parsed.args?.tokenId?.toString();
              if (!tokenId) continue;

              const [owner, role, claimed] = await cachedPromiseAll(rpcProvider, contract.chainId, [
                { key: `ownerOf:${contract.pob}:${tokenId}`, promise: iterationPobContract.ownerOf(tokenId) },
                { key: `roleOf:${contract.pob}:${tokenId}`, promise: iterationPobContract.roleOf(tokenId) },
                { key: `claimed:${contract.pob}:${tokenId}`, promise: iterationPobContract.claimed(tokenId) },
              ]);

              if (owner.toLowerCase() !== address.toLowerCase()) continue;

              const badge: Badge = {
                tokenId, // Keep original tokenId for contract calls
                role: role.toLowerCase() as ParticipantRole,
                iteration: iterationNumber,
                round: contract.round, // Round number from the contract being queried
                claimed,
              };
              // Use composite key for uniqueness across iterations and rounds
              const badgeKey = `${contract.iteration}-${contract.round || 'main'}-${tokenId}`;
              allBadgesMap.set(badgeKey, badge);

              // Load community badge voting info if this is a community badge in the current iteration
              if (
                badge.role === 'community' &&
                currentIteration &&
                contract.iteration === currentIteration.iteration &&
                contract.round === currentIteration.round
              ) {
                try {
                  const iterationJuryContract = new Contract(contract.jurySC, getJurySCABI(currentIteration), rpcProvider);
                  const [hasVoted, vote] = await cachedPromiseAll(rpcProvider, contract.chainId, [
                    { key: `communityHasVoted:${contract.jurySC}:${tokenId}`, promise: iterationJuryContract.communityHasVoted(tokenId) },
                    { key: `communityVoteOf:${contract.jurySC}:${tokenId}`, promise: iterationJuryContract.communityVoteOf(tokenId) },
                  ]);
                  communityMap.set(badgeKey, {
                    ...badge,
                    hasVoted: Boolean(hasVoted),
                    vote: normalizeAddress(vote),
                  });
                } catch (voteError) {
                  console.warn(`Failed to load vote for community badge ${tokenId}`, voteError);
                }
              }
            } catch (parseError) {
              console.warn('Failed to parse or process badge log', parseError);
            }
          }
        } catch (iterationError) {
          console.warn(`Failed to load badges from iteration ${contract.iteration}${roundLabel}`, iterationError);
        }
      }

      const badgeList = Array.from(allBadgesMap.values());
      setBadges(badgeList);
      setCommunityBadges(Array.from(communityMap.values()));
      setRoles((current) => ({
        ...current,
        community: badgeList.some((badge) => badge.role === 'community' && badge.iteration === currentIteration?.iteration),
      }));
      console.log('[loadBadges] Complete. Total badges across all iterations:', badgeList.length, 'Current iteration community badges:', communityMap.size);
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
      await loadBadges(walletAddress, publicProvider, allIterations);
    }
  }, [signer, currentIteration, walletAddress, publicProvider, selectedChainId, loadEntityVotes, loadVoteCounts, loadBadges, allIterations]);

  const refreshBadges = useCallback(async () => {
    if (!publicProvider || !currentIteration || !walletAddress) return;
    console.log('[refreshBadges] Refreshing badges...');
    await loadBadges(walletAddress, publicProvider, allIterations);
  }, [currentIteration, walletAddress, publicProvider, allIterations, loadBadges]);

  const loadIterationState = useCallback(async () => {
    console.log('=== [loadIterationState] Starting ===');
    console.log('[loadIterationState] Checking conditions...');
    console.log('  - signer:', !!signer);
    console.log('  - walletAddress:', walletAddress);
    console.log('  - currentIteration:', currentIteration?.name);
    console.log('  - correctNetwork:', correctNetwork);
    console.log('  - publicProvider:', !!publicProvider);
    console.log('  - projectMetadataLoading:', projectMetadataLoading);
    console.log('  - hasLoadError:', hasLoadError);

    // Only require publicProvider and currentIteration for read-only data
    // Wallet/signer only needed for write operations (which will be disabled in UI)
    if (!currentIteration || !correctNetwork || !publicProvider) {
      console.log('[loadIterationState] Skipping - missing required conditions');
      return;
    }
    if (projectMetadataLoading) {
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

      console.log('[loadIterationState] Phase 1: Loading voting status...');
      // First, load voting status to get state flags
      const statusFlags = await loadVotingStatus(juryContract, walletAddress);

      console.log('[loadIterationState] Phase 2: Loading data based on current page...');
      console.log('[loadIterationState] Current page:', currentPage);

      // Build conditional loading array based on current page
      const loadTasks = [
        // Always load entity votes (needed for iteration header)
        loadEntityVotes(juryContract, statusFlags.isActive, statusFlags.votingEnded),
        // Always load roles if wallet connected (needed to determine panels)
        walletAddress ? loadRoles(juryContract, walletAddress) : Promise.resolve(),
      ];

      // Lazy load projects - only on iteration page
      if (currentPage === 'iteration') {
        console.log('[loadIterationState] Loading projects (iteration page)');
        loadTasks.push(loadProjects(juryContract));
      } else {
        console.log('[loadIterationState] Skipping projects (not on iteration page)');
      }

      // Lazy load owner data - only on iteration page AND if owner
      if (currentPage === 'iteration' && walletAddress && isOwner) {
        console.log('[loadIterationState] Loading owner data (owner on iteration page)');
        loadTasks.push(loadOwnerData(juryContract));
      } else {
        console.log('[loadIterationState] Skipping owner data');
      }

      // Lazy load badges - only on badges page OR if on iteration page with wallet
      if (currentPage === 'badges' || (currentPage === 'iteration' && walletAddress)) {
        console.log('[loadIterationState] Loading badges');
        loadTasks.push(loadBadges(walletAddress!, publicProvider, allIterations));
      } else {
        console.log('[loadIterationState] Skipping badges');
      }

      // Lazy load vote counts - only on iteration page AND if active/ended
      if (currentPage === 'iteration' && (statusFlags.isActive || statusFlags.votingEnded)) {
        console.log('[loadIterationState] Loading vote counts (active/ended on iteration page)');
        loadTasks.push(loadVoteCounts(juryContract));
      } else {
        console.log('[loadIterationState] Skipping vote counts');
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
    projectMetadataLoading,
    hasLoadError,
    chainId,
    allIterations,
    currentPage,
    isOwner,
  ]);

  // Load iteration when iteration is selected (wallet optional for read-only viewing)
  useEffect(() => {
    if (currentIteration && publicProvider && correctNetwork && !hasLoadError && !projectMetadataLoading) {
      console.log('[useEffect] Triggering loadIterationState - iteration selected, publicProvider available, metadata loaded');
      loadIterationState().catch((err) => {
        console.error('[useEffect] loadIterationState failed:', err);
      });
    } else if (projectMetadataLoading) {
      console.log('[useEffect] Waiting for project metadata to load...');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIteration?.iteration, currentIteration?.jurySC, walletAddress, publicProvider, correctNetwork, hasLoadError, projectMetadataLoading, currentPage]);

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
