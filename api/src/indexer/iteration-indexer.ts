/**
 * Iteration Indexer
 *
 * Polls blockchain contracts to build snapshots of iteration state.
 * Stores snapshots in the database for fast API access.
 */

import Database from 'better-sqlite3';
import { ethers, Contract, JsonRpcProvider } from 'ethers';
import { logger } from '../utils/logger.js';
import { initDatabase } from '../db/init.js';
import { createIterationsDatabase, type JuryState, type ProjectSnapshot } from '../db/iterations.js';
import { createMetadataDatabase } from '../db/metadata.js';
import { createRetryTracker } from '../db/retry-tracker.js';
import { IPFSService } from '../services/ipfs.js';
import { NETWORKS } from '../constants/networks.js';

// Minimal ABIs for contract calls
const REGISTRY_ABI = [
  'function getAllIterationIds() external view returns (uint256[])',
  'function getIteration(uint256 iterationId) external view returns (tuple(uint256 iterationId, uint256 chainId, string name, uint256 roundCount))',
  'function getRounds(uint256 iterationId) external view returns (tuple(uint256 iterationId, uint256 roundId, address jurySC, uint256 deployBlockHint, bool exists)[])',
  'function getProjectMetadata(uint256 chainId, address jurySC, address project) external view returns (string)',
  'function batchGetProjectMetadata(uint256 chainId, address jurySC, address[] projects) external view returns (string[])',
  'function votingModeOverride(address jurySC) external view returns (uint8)'
];

const JURY_ABI = [
  'function pob() external view returns (address)',
  'function votingMode() external view returns (uint8)',
  'function isActive() external view returns (bool)',
  'function votingEnded() external view returns (bool)',
  'function startTime() external view returns (uint64)',
  'function endTime() external view returns (uint64)',
  'function projectsLocked() external view returns (bool)',
  'function locked() external view returns (bool)',
  'function devRelAccount() external view returns (address)',
  'function getDaoHicVoters() external view returns (address[])',
  'function daoHicVoteOf(address voter) external view returns (address)',
  'function getDevRelEntityVote() external view returns (address)',
  'function getDaoHicEntityVote() external view returns (address)',
  'function getCommunityEntityVote() external view returns (address)',
  'function getVoteParticipationCounts() external view returns (uint256, uint256, uint256)',
  'function getWinner() external view returns (address, bool)',
  'function getWinnerConsensus() external view returns (address, bool)',
  'function getWinnerWeighted() external view returns (address, bool)',
  'function getWinnerWithScores() external view returns (address[], uint256[], uint256)',
  'function projectCount() external view returns (uint256)',
  'function projectAddress(uint256 index) external view returns (address)'
];

// Poll interval: 37 seconds (configurable via env)
const POLL_INTERVAL = parseInt(process.env.ITERATION_POLL_INTERVAL || '37000', 10);

// Optional: Force single chain mode (if set, only index this chain)
const SINGLE_CHAIN_ID = process.env.CHAIN_ID
  ? parseInt(process.env.CHAIN_ID, 10)
  : null;

class IterationIndexer {
  private db: Database.Database;
  private iterationsDb: ReturnType<typeof createIterationsDatabase>;
  private metadataDb: ReturnType<typeof createMetadataDatabase>;
  private retryTracker: ReturnType<typeof createRetryTracker>;
  private ipfsService: IPFSService;
  private providers: Map<number, JsonRpcProvider> = new Map();
  private isRunning = false;

  constructor(dbPath?: string) {
    const path = dbPath || process.env.DB_PATH || './data/index.db';
    this.db = initDatabase(path);
    this.iterationsDb = createIterationsDatabase(this.db);
    this.metadataDb = createMetadataDatabase(this.db);
    this.retryTracker = createRetryTracker(this.db);
    this.ipfsService = new IPFSService();

    // Initialize providers for each network
    for (const [chainId, config] of Object.entries(NETWORKS)) {
      const id = Number(chainId);
      // Skip if single chain mode is enabled and this isn't the target chain
      if (SINGLE_CHAIN_ID !== null && id !== SINGLE_CHAIN_ID) {
        continue;
      }
      if (config.registryAddress) {
        this.providers.set(id, new JsonRpcProvider(config.rpcUrl));
      }
    }
  }

  /**
   * Fetch metadata from IPFS and cache it, with retry tracking
   * Returns null if fetch fails or retry is not yet allowed
   */
  private async fetchAndCacheMetadata(cid: string): Promise<Record<string, unknown> | null> {
    // Check if we should retry this CID
    if (!this.retryTracker.shouldRetry('ipfs', 'fetch', cid)) {
      return null; // Too soon to retry
    }

    try {
      const data = await this.ipfsService.fetchJSON(cid);

      // Cache the fetched content
      this.metadataDb.cacheIPFSContent(cid, JSON.stringify(data));

      // Clear any failure record on success
      this.retryTracker.recordSuccess('ipfs', 'fetch', cid);

      logger.info('Fetched and cached IPFS metadata', { cid });
      return data as Record<string, unknown>;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.retryTracker.recordFailure('ipfs', 'fetch', cid, errorMsg);

      const record = this.retryTracker.getRecord('ipfs', 'fetch', cid);
      logger.warn('Failed to fetch IPFS metadata', {
        cid,
        error: errorMsg,
        attemptCount: record?.attempt_count,
        nextRetryAt: record?.next_retry_at ? new Date(record.next_retry_at).toISOString() : null
      });

      return null;
    }
  }

  /**
   * Determine jury state from contract flags
   */
  private determineJuryState(
    isActive: boolean,
    votingEnded: boolean,
    locked: boolean,
    startTime: number
  ): JuryState {
    if (locked) return 'locked';
    if (votingEnded) return 'ended';
    if (isActive) return 'active';
    if (startTime > 0) return 'activated';
    return 'deployed';
  }

  /**
   * Get project addresses from JurySC
   */
  private async getProjectAddresses(jurySC: Contract): Promise<string[]> {
    try {
      const count = await jurySC.projectCount();
      const addresses: string[] = [];

      // Contract uses 1-indexed projectAddress mapping
      for (let i = 1; i <= Number(count); i++) {
        const addr = await jurySC.projectAddress(i);
        addresses.push(addr);
      }

      return addresses;
    } catch (error) {
      logger.warn('Failed to get project addresses', { error });
      return [];
    }
  }

  /**
   * Get project metadata CIDs from registry
   */
  private async getProjectMetadataCIDs(
    registry: Contract,
    chainId: number,
    jurySCAddress: string,
    projectAddresses: string[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    if (projectAddresses.length === 0) return result;

    try {
      const cids = await registry.batchGetProjectMetadata(chainId, jurySCAddress, projectAddresses);

      for (let i = 0; i < projectAddresses.length; i++) {
        const cid = cids[i];
        if (cid && cid.length > 0) {
          result.set(projectAddresses[i], cid);
        }
      }
    } catch (error) {
      logger.warn('Failed to batch get project metadata CIDs', { error });
    }

    return result;
  }

  /**
   * Index a single iteration round
   */
  private async indexIterationRound(
    chainId: number,
    iterationId: number,
    round: { roundId: number; jurySC: string; deployBlockHint: number },
    registry: Contract,
    provider: JsonRpcProvider
  ): Promise<void> {
    const jurySC = new Contract(round.jurySC, JURY_ABI, provider);

    try {
      // Check for voting mode override in registry
      const votingModeOverrideRaw: number = await registry.votingModeOverride(round.jurySC).catch(() => 0);

      // Batch fetch all contract state
      const [
        pobAddress,
        votingModeRaw,
        isActive,
        votingEnded,
        startTime,
        endTime,
        projectsLocked,
        locked,
        devRelAccount,
        daoHicVoters,
        devRelVote,
        daoHicVote,
        communityVote,
        voteCounts,
        winner,
        currentBlock
      ] = await Promise.all([
        jurySC.pob().catch(() => ethers.ZeroAddress),
        votingModeOverrideRaw > 0 ? Promise.resolve(votingModeOverrideRaw - 1) : jurySC.votingMode().catch(() => 0),
        jurySC.isActive().catch(() => false),
        jurySC.votingEnded().catch(() => false),
        jurySC.startTime().catch(() => BigInt(0)),
        jurySC.endTime().catch(() => BigInt(0)),
        jurySC.projectsLocked().catch(() => false),
        jurySC.locked().catch(() => false),
        jurySC.devRelAccount().catch(() => null),
        jurySC.getDaoHicVoters().catch(() => []),
        jurySC.getDevRelEntityVote().catch(() => null),
        jurySC.getDaoHicEntityVote().catch(() => null),
        jurySC.getCommunityEntityVote().catch(() => null),
        jurySC.getVoteParticipationCounts().catch(() => [BigInt(0), BigInt(0), BigInt(0)]),
        votingModeOverrideRaw === 2 ? jurySC.getWinnerWeighted().catch(() => [null, false]) : jurySC.getWinner().catch(() => [null, false]),
        provider.getBlockNumber()
      ]);

      const votingMode = Number(votingModeRaw);

      // Get project scores if voting has ended
      let projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null = null;
      if (votingEnded) {
        try {
          const [addresses, scores, totalPossible] = await jurySC.getWinnerWithScores();
          projectScores = {
            addresses: addresses as string[],
            scores: (scores as bigint[]).map((s: bigint) => s.toString()),
            totalPossible: totalPossible.toString()
          };
        } catch {
          // Not all contracts support getWinnerWithScores
        }
      }

      // Fetch individual DAO HIC votes (which project each voter voted for)
      const daoHicIndividualVotes: Record<string, string> = {};
      if (daoHicVoters && daoHicVoters.length > 0) {
        const votePromises = daoHicVoters.map(async (voter: string) => {
          try {
            const vote = await jurySC.daoHicVoteOf(voter);
            if (vote && vote !== ethers.ZeroAddress) {
              daoHicIndividualVotes[voter] = vote;
            }
          } catch {
            // Voter may not have voted yet
          }
        });
        await Promise.all(votePromises);
      }

      // Get project addresses and metadata
      const projectAddresses = await this.getProjectAddresses(jurySC);
      const metadataCIDs = await this.getProjectMetadataCIDs(registry, chainId, round.jurySC, projectAddresses);

      // Build project snapshots with metadata (cached or fetched)
      const projects: ProjectSnapshot[] = [];
      for (const addr of projectAddresses) {
        const cid = metadataCIDs.get(addr) || null;
        let metadata: Record<string, unknown> | null = null;

        if (cid) {
          // First check cache
          const cached = this.metadataDb.getCachedIPFSContent(cid);
          if (cached) {
            try {
              metadata = JSON.parse(cached.content);
            } catch {
              // Invalid JSON in cache
            }
          } else {
            // Not cached - try to fetch if retry is allowed
            metadata = await this.fetchAndCacheMetadata(cid);
          }
        }

        projects.push({ address: addr, metadataCID: cid, metadata });
      }

      // Determine jury state
      const juryState = this.determineJuryState(
        isActive,
        votingEnded,
        locked,
        Number(startTime)
      );

      // Store snapshot
      this.iterationsDb.upsertSnapshot({
        iteration_id: iterationId,
        chain_id: chainId,
        round: round.roundId,
        registry_address: NETWORKS[chainId].registryAddress,
        pob_address: pobAddress,
        jury_address: round.jurySC,
        deploy_block_hint: round.deployBlockHint,
        jury_state: juryState,
        start_time: Number(startTime) || null,
        end_time: Number(endTime) || null,
        voting_mode: votingMode,
        projects_locked: projectsLocked ? 1 : 0,
        contract_locked: locked ? 1 : 0,
        winner_address: winner[0] && winner[0] !== ethers.ZeroAddress ? winner[0] : null,
        has_winner: winner[1] ? 1 : 0,
        devrel_vote: devRelVote && devRelVote !== ethers.ZeroAddress ? devRelVote : null,
        daohic_vote: daoHicVote && daoHicVote !== ethers.ZeroAddress ? daoHicVote : null,
        community_vote: communityVote && communityVote !== ethers.ZeroAddress ? communityVote : null,
        project_scores: projectScores ? JSON.stringify(projectScores) : null,
        devrel_count: Number(voteCounts[0]),
        daohic_count: Number(voteCounts[1]),
        community_count: Number(voteCounts[2]),
        devrel_account: devRelAccount && devRelAccount !== ethers.ZeroAddress ? devRelAccount : null,
        daohic_voters: JSON.stringify(daoHicVoters),
        daohic_individual_votes: JSON.stringify(daoHicIndividualVotes),
        projects: JSON.stringify(projects),
        last_block: currentBlock,
        last_updated_at: Date.now()
      });

      logger.debug('Indexed iteration round', {
        chainId,
        iterationId,
        round: round.roundId,
        juryState,
        projectCount: projects.length
      });
    } catch (error) {
      logger.error('Failed to index iteration round', {
        chainId,
        iterationId,
        round: round.roundId,
        error
      });
    }
  }

  /**
   * Store a placeholder snapshot for iterations that are registered but do not
   * have any rounds yet. This allows the admin UI to surface the iteration and
   * attach the first round.
   */
  private async indexRoundlessIteration(chainId: number, iterationId: number, provider: JsonRpcProvider): Promise<void> {
    try {
      const currentBlock = await provider.getBlockNumber();

      this.iterationsDb.upsertSnapshot({
        iteration_id: iterationId,
        chain_id: chainId,
        round: 0,
        registry_address: NETWORKS[chainId].registryAddress,
        pob_address: ethers.ZeroAddress,
        jury_address: ethers.ZeroAddress,
        deploy_block_hint: 0,
        jury_state: 'deployed',
        start_time: null,
        end_time: null,
        voting_mode: 0,
        projects_locked: 0,
        contract_locked: 0,
        winner_address: null,
        has_winner: 0,
        devrel_vote: null,
        daohic_vote: null,
        community_vote: null,
        project_scores: null,
        devrel_count: 0,
        daohic_count: 0,
        community_count: 0,
        devrel_account: null,
        daohic_voters: JSON.stringify([]),
        daohic_individual_votes: JSON.stringify({}),
        projects: JSON.stringify([]),
        last_block: currentBlock,
        last_updated_at: Date.now()
      });

      logger.debug('Indexed roundless iteration placeholder', { chainId, iterationId });
    } catch (error) {
      logger.error('Failed to index roundless iteration placeholder', { chainId, iterationId, error });
    }
  }

  /**
   * Index all iterations for a chain
   */
  private async indexChain(chainId: number): Promise<void> {
    const config = NETWORKS[chainId];
    if (!config.registryAddress) {
      return;
    }

    const provider = this.providers.get(chainId);
    if (!provider) {
      return;
    }

    const registry = new Contract(config.registryAddress, REGISTRY_ABI, provider);

    try {
      // Get all iteration IDs
      const iterationIds = await registry.getAllIterationIds();

      for (const id of iterationIds) {
        const iterationId = Number(id);

        // Get all rounds for this iteration
        const rounds = await registry.getRounds(iterationId);
        if (!rounds || rounds.length === 0) {
          await this.indexRoundlessIteration(chainId, iterationId, provider);
          continue;
        }

        // Index each round (but prioritize latest)
        for (const round of rounds) {
          await this.indexIterationRound(
            chainId,
            iterationId,
            { roundId: Number(round.roundId), jurySC: round.jurySC, deployBlockHint: Number(round.deployBlockHint) },
            registry,
            provider
          );
        }
      }

      logger.info('Indexed chain', {
        chainId,
        name: config.name,
        iterationCount: iterationIds.length
      });
    } catch (error) {
      logger.error('Failed to index chain', { chainId, error });
    }
  }

  /**
   * Run a single poll cycle
   */
  async poll(): Promise<void> {
    logger.debug('Starting iteration indexer poll');

    const startTime = Date.now();

    // Index all chains in parallel
    const chainIds = Array.from(this.providers.keys());
    await Promise.all(chainIds.map(chainId => this.indexChain(chainId)));

    logger.info('Iteration indexer poll complete', {
      duration: Date.now() - startTime,
      chains: chainIds.length
    });
  }

  /**
   * Start the indexer with continuous polling
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Iteration indexer is already running');
      return;
    }

    logger.info('Starting iteration indexer', {
      pollInterval: POLL_INTERVAL,
      chains: Array.from(this.providers.keys()),
      singleChainMode: SINGLE_CHAIN_ID !== null ? SINGLE_CHAIN_ID : false
    });

    // Initial poll
    await this.poll();

    this.isRunning = true;

    // Set up polling interval
    setInterval(() => {
      if (!this.isRunning) return;

      this.poll().catch(error => {
        logger.error('Iteration indexer poll failed', { error });
      });
    }, POLL_INTERVAL);

    logger.info('Iteration indexer started');
  }

  /**
   * Stop the indexer
   */
  stop(): void {
    logger.info('Stopping iteration indexer');
    this.isRunning = false;
    this.db.close();
    logger.info('Iteration indexer stopped');
  }
}

// Start the indexer when this file is executed directly
const indexer = new IterationIndexer();
indexer.start().catch(error => {
  logger.error('Iteration indexer failed to start', { error });
  process.exit(1);
});

export { IterationIndexer };
