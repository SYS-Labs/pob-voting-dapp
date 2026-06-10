/**
 * Iteration Indexer
 *
 * Polls blockchain contracts to build snapshots of iteration state.
 * Stores snapshots in the database for fast API access.
 */

import Database from 'better-sqlite3';
import { ethers, Contract, FetchRequest, JsonRpcProvider } from 'ethers';
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
  'function roundVersion(uint256 iterationId, uint256 roundId) external view returns (uint32)',
  'function getProjectMetadata(uint256 chainId, address jurySC, address project) external view returns (string)',
  'function batchGetProjectMetadata(uint256 chainId, address jurySC, address[] projects) external view returns (string[])',
  'function votingModeOverride(address jurySC) external view returns (uint8)'
];

const REGISTRY_EVENT_ABI = [
  'event IterationRegistered(uint256 indexed iterationId, uint256 indexed chainId)',
  'event RoundAdded(uint256 indexed iterationId, uint256 indexed roundId, address indexed jurySC, address pob, uint256 chainId)',
  'event IterationMetadataSet(uint256 indexed chainId, address indexed jurySC, string cid, address indexed setter)',
  'event ProjectMetadataSet(uint256 indexed chainId, address indexed jurySC, address indexed projectAddress, string cid, address setter)',
  'event AdapterSet(uint256 indexed versionId, address indexed adapter)',
  'event RoundVersionSet(uint256 indexed iterationId, uint256 indexed roundId, uint256 indexed versionId)',
  'event VotingModeOverrideSet(address indexed jurySC, uint8 mode)',
  'event ImportedIteration(uint256 indexed iterationId, uint256 indexed chainId, uint256 indexed batchId, string proofCid)',
  'event ImportedRound(uint256 indexed iterationId, uint256 indexed roundId, address indexed jurySC, uint256 batchId, uint256 versionId, string proofCid)',
  'event ImportedIterationMetadata(uint256 indexed iterationId, uint256 indexed roundId, address indexed jurySC, uint256 batchId, string cid, string proofCid)',
  'event ImportedProjectMetadata(uint256 indexed iterationId, uint256 indexed roundId, address indexed projectAddress, uint256 batchId, string cid, string proofCid)'
];

const JURY_EVENT_ABI = [
  'event ProjectRegistered(uint256 indexed projectId, address indexed projectAddress)',
  'event ProjectRemoved(address indexed projectAddress)'
];

const REGISTRY_EVENT_INTERFACE = new ethers.Interface(REGISTRY_EVENT_ABI);
const JURY_EVENT_INTERFACE = new ethers.Interface(JURY_EVENT_ABI);
const EVENT_SCAN_REORG_OVERLAP_BLOCKS = 12;

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
  'function getSmtVoters() external view returns (address[])',
  'function getDaoHicVoters() external view returns (address[])',
  'function daoHicVoteOf(address voter) external view returns (address)',
  'function getDevRelEntityVote() external view returns (address)',
  'function getSmtEntityVote() external view returns (address)',
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

interface RegistryEventRound {
  iterationId: number;
  roundId: number;
  jurySC: string;
  pob: string;
  deployBlockHint: number;
}

interface RegistryEventState {
  syncedToBlock: number;
  jurySyncedToBlock: number;
  iterationIds: Set<number>;
  rounds: Map<string, RegistryEventRound>;
  roundVersions: Map<string, number>;
  votingModeOverrides: Map<string, number>;
  iterationMetadata: Map<string, string>;
  projectMetadata: Map<string, string>;
  projectAddressesByJury: Map<string, Set<string>>;
}

// Poll interval: 5 seconds (configurable via env)
const ITERATION_POLL_INTERVAL_MS = parseInt(process.env.ITERATION_POLL_INTERVAL || '5000', 10);
const ITERATION_RPC_BACKOFF_INITIAL_MS = parseInt(process.env.ITERATION_RPC_BACKOFF_INITIAL_MS || '60000', 10);
const ITERATION_RPC_BACKOFF_MAX_MS = parseInt(process.env.ITERATION_RPC_BACKOFF_MAX_MS || '600000', 10);
const ITERATION_RPC_RETRY_MAX_ATTEMPTS = parseInt(process.env.ITERATION_RPC_RETRY_MAX_ATTEMPTS || '12', 10);
const ITERATION_RPC_RETRY_SLOT_INTERVAL_MS = parseInt(process.env.ITERATION_RPC_RETRY_SLOT_INTERVAL_MS || '250', 10);

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
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIndexedBlock: Map<number, number> = new Map();
  private rpcBackoffUntil: Map<number, number> = new Map();
  private rpcBackoffDelay: Map<number, number> = new Map();
  private registryEventStates: Map<number, RegistryEventState> = new Map();

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
        this.providers.set(id, this.createProvider(id, config.rpcUrl));
      }
    }
  }

  private createProvider(chainId: number, rpcUrl: string): JsonRpcProvider {
    const request = new FetchRequest(rpcUrl);
    request.setThrottleParams({
      maxAttempts: ITERATION_RPC_RETRY_MAX_ATTEMPTS,
      slotInterval: ITERATION_RPC_RETRY_SLOT_INTERVAL_MS
    });

    return new JsonRpcProvider(request, chainId, { staticNetwork: true });
  }

  private isRpcRateLimitError(error: unknown): boolean {
    const details = error as {
      code?: string;
      message?: string;
      info?: { responseBody?: string; responseStatus?: string; requestUrl?: string };
    } | null;
    const text = [
      details?.code,
      details?.message,
      details?.info?.responseBody,
      details?.info?.responseStatus
    ].filter(Boolean).join(' ').toLowerCase();

    return text.includes('429') || text.includes('too many requests') || text.includes('rate limit') || text.includes('1015');
  }

  private applyRpcBackoff(chainId: number): void {
    const delay = this.rpcBackoffDelay.get(chainId) || ITERATION_RPC_BACKOFF_INITIAL_MS;
    const boundedDelay = Math.min(delay, ITERATION_RPC_BACKOFF_MAX_MS);
    const nextRetryAt = Date.now() + boundedDelay;

    this.rpcBackoffUntil.set(chainId, nextRetryAt);
    this.rpcBackoffDelay.set(chainId, Math.min(boundedDelay * 2, ITERATION_RPC_BACKOFF_MAX_MS));

    logger.warn('RPC rate limit detected; backing off iteration indexing', {
      chainId,
      backoffMs: boundedDelay,
      nextRetryAt: new Date(nextRetryAt).toISOString()
    });
  }

  private clearRpcBackoff(chainId: number): void {
    this.rpcBackoffUntil.delete(chainId);
    this.rpcBackoffDelay.delete(chainId);
  }

  private shouldSkipForRpcBackoff(chainId: number): boolean {
    const backoffUntil = this.rpcBackoffUntil.get(chainId) || 0;
    const now = Date.now();
    if (backoffUntil <= now) {
      return false;
    }

    logger.warn('Skipping iteration indexing during RPC backoff', {
      chainId,
      nextRetryAt: new Date(backoffUntil).toISOString(),
      remainingMs: backoffUntil - now
    });
    return true;
  }

  private normalizeAddress(address: string): string {
    return ethers.getAddress(address).toLowerCase();
  }

  private makeRoundKey(iterationId: number, roundId: number): string {
    return `${iterationId}:${roundId}`;
  }

  private makeMetadataKey(jurySC: string, projectAddress: string): string {
    return `${this.normalizeAddress(jurySC)}:${this.normalizeAddress(projectAddress)}`;
  }

  private getOrCreateRegistryEventState(chainId: number): RegistryEventState {
    let state = this.registryEventStates.get(chainId);
    if (!state) {
      state = {
        syncedToBlock: -1,
        jurySyncedToBlock: -1,
        iterationIds: new Set<number>(),
        rounds: new Map<string, RegistryEventRound>(),
        roundVersions: new Map<string, number>(),
        votingModeOverrides: new Map<string, number>(),
        iterationMetadata: new Map<string, string>(),
        projectMetadata: new Map<string, string>(),
        projectAddressesByJury: new Map<string, Set<string>>()
      };
      this.registryEventStates.set(chainId, state);
    }
    return state;
  }

  private getRoundByJury(state: RegistryEventState, jurySC: string): RegistryEventRound | null {
    const juryLower = this.normalizeAddress(jurySC);
    for (const round of state.rounds.values()) {
      if (round.jurySC === juryLower) return round;
    }
    return null;
  }

  private recordConfirmedMetadataUpdate(params: {
    chainId: number;
    currentBlock: number;
    contractAddress: string | null;
    iterationNumber: number | null;
    projectAddress: string | null;
    cid: string;
    txHash: string;
    blockNumber: number;
    logIndex: number;
  }): void {
    this.metadataDb.upsertConfirmedUpdate({
      chainId: params.chainId,
      contractAddress: params.contractAddress,
      iterationNumber: params.iterationNumber,
      projectAddress: params.projectAddress,
      cid: params.cid,
      txHash: params.txHash,
      blockNumber: params.blockNumber,
      logIndex: params.logIndex,
      confirmations: Math.max(0, params.currentBlock - params.blockNumber + 1)
    });
  }

  private async syncRegistryEvents(
    chainId: number,
    provider: JsonRpcProvider,
    currentBlock: number
  ): Promise<RegistryEventState> {
    const config = NETWORKS[chainId];
    const state = this.getOrCreateRegistryEventState(chainId);
    const fromBlock = state.syncedToBlock >= 0
      ? Math.max(0, state.syncedToBlock - EVENT_SCAN_REORG_OVERLAP_BLOCKS + 1)
      : 0;

    if (fromBlock <= currentBlock) {
      const logs = await provider.getLogs({
        address: config.registryAddress,
        fromBlock,
        toBlock: currentBlock
      });

      logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

      for (const log of logs) {
        const parsed = REGISTRY_EVENT_INTERFACE.parseLog(log);
        if (!parsed) continue;

        if (parsed.name === 'IterationRegistered' || parsed.name === 'ImportedIteration') {
          if (Number(parsed.args.chainId) === chainId) {
            state.iterationIds.add(Number(parsed.args.iterationId));
          }
          continue;
        }

        if (parsed.name === 'RoundAdded') {
          if (Number(parsed.args.chainId) !== chainId) continue;
          const iterationId = Number(parsed.args.iterationId);
          const roundId = Number(parsed.args.roundId);
          const key = this.makeRoundKey(iterationId, roundId);
          state.iterationIds.add(iterationId);
          state.rounds.set(key, {
            iterationId,
            roundId,
            jurySC: this.normalizeAddress(parsed.args.jurySC),
            pob: this.normalizeAddress(parsed.args.pob),
            // RoundAdded does not emit deployBlockHint; event block is a safe lower-cost fallback hint.
            deployBlockHint: log.blockNumber
          });
          continue;
        }

        if (parsed.name === 'ImportedRound') {
          const iterationId = Number(parsed.args.iterationId);
          const roundId = Number(parsed.args.roundId);
          const key = this.makeRoundKey(iterationId, roundId);
          const jurySC = this.normalizeAddress(parsed.args.jurySC);
          state.iterationIds.add(iterationId);
          state.rounds.set(key, {
            iterationId,
            roundId,
            jurySC,
            pob: ethers.ZeroAddress,
            deployBlockHint: log.blockNumber
          });
          state.roundVersions.set(key, Number(parsed.args.versionId));
          continue;
        }

        if (parsed.name === 'RoundVersionSet') {
          state.roundVersions.set(
            this.makeRoundKey(Number(parsed.args.iterationId), Number(parsed.args.roundId)),
            Number(parsed.args.versionId)
          );
          continue;
        }

        if (parsed.name === 'VotingModeOverrideSet') {
          state.votingModeOverrides.set(this.normalizeAddress(parsed.args.jurySC), Number(parsed.args.mode));
          continue;
        }

        if (parsed.name === 'IterationMetadataSet') {
          if (Number(parsed.args.chainId) !== chainId) continue;
          const jurySC = this.normalizeAddress(parsed.args.jurySC);
          const cid = String(parsed.args.cid);
          const round = this.getRoundByJury(state, jurySC);
          state.iterationMetadata.set(jurySC, cid);
          this.recordConfirmedMetadataUpdate({
            chainId,
            currentBlock,
            contractAddress: jurySC,
            iterationNumber: round?.iterationId ?? null,
            projectAddress: null,
            cid,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index
          });
          continue;
        }

        if (parsed.name === 'ProjectMetadataSet') {
          if (Number(parsed.args.chainId) !== chainId) continue;
          const jurySC = this.normalizeAddress(parsed.args.jurySC);
          const projectAddress = this.normalizeAddress(parsed.args.projectAddress);
          const cid = String(parsed.args.cid);
          const round = this.getRoundByJury(state, jurySC);
          state.projectMetadata.set(this.makeMetadataKey(jurySC, projectAddress), cid);
          this.recordConfirmedMetadataUpdate({
            chainId,
            currentBlock,
            contractAddress: jurySC,
            iterationNumber: round?.iterationId ?? null,
            projectAddress,
            cid,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index
          });
          continue;
        }

        if (parsed.name === 'ImportedIterationMetadata') {
          const iterationId = Number(parsed.args.iterationId);
          const jurySC = this.normalizeAddress(parsed.args.jurySC);
          const cid = String(parsed.args.cid);
          state.iterationMetadata.set(jurySC, cid);
          this.recordConfirmedMetadataUpdate({
            chainId,
            currentBlock,
            contractAddress: jurySC,
            iterationNumber: iterationId,
            projectAddress: null,
            cid,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index
          });
          continue;
        }

        if (parsed.name === 'ImportedProjectMetadata') {
          const iterationId = Number(parsed.args.iterationId);
          const roundId = Number(parsed.args.roundId);
          const projectAddress = this.normalizeAddress(parsed.args.projectAddress);
          const round = state.rounds.get(this.makeRoundKey(iterationId, roundId));
          if (!round) continue;
          const cid = String(parsed.args.cid);
          state.projectMetadata.set(this.makeMetadataKey(round.jurySC, projectAddress), cid);
          this.recordConfirmedMetadataUpdate({
            chainId,
            currentBlock,
            contractAddress: round.jurySC,
            iterationNumber: iterationId,
            projectAddress,
            cid,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index
          });
        }
      }

      state.syncedToBlock = currentBlock;
    }

    await this.syncJuryProjectEvents(provider, state, currentBlock);
    return state;
  }

  private async syncJuryProjectEvents(
    provider: JsonRpcProvider,
    state: RegistryEventState,
    currentBlock: number
  ): Promise<void> {
    const juryAddresses = Array.from(new Set(Array.from(state.rounds.values()).map(round => round.jurySC)));
    if (juryAddresses.length === 0) {
      state.jurySyncedToBlock = currentBlock;
      return;
    }

    const fromBlock = state.jurySyncedToBlock >= 0
      ? Math.max(0, state.jurySyncedToBlock - EVENT_SCAN_REORG_OVERLAP_BLOCKS + 1)
      : 0;
    if (fromBlock > currentBlock) return;

    const logs = await provider.getLogs({
      address: juryAddresses,
      fromBlock,
      toBlock: currentBlock,
      topics: [[
        ethers.id('ProjectRegistered(uint256,address)'),
        ethers.id('ProjectRemoved(address)')
      ]]
    });

    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

    for (const log of logs) {
      const parsed = JURY_EVENT_INTERFACE.parseLog(log);
      if (!parsed) continue;
      const jurySC = this.normalizeAddress(log.address);
      const projects = state.projectAddressesByJury.get(jurySC) || new Set<string>();

      if (parsed.name === 'ProjectRegistered') {
        projects.add(this.normalizeAddress(parsed.args.projectAddress));
      } else if (parsed.name === 'ProjectRemoved') {
        projects.delete(this.normalizeAddress(parsed.args.projectAddress));
      }

      state.projectAddressesByJury.set(jurySC, projects);
    }

    state.jurySyncedToBlock = currentBlock;
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
  private async getProjectAddresses(
    jurySC: Contract,
    eventState?: RegistryEventState,
    jurySCAddress?: string
  ): Promise<string[]> {
    if (eventState && jurySCAddress) {
      const eventProjects = eventState.projectAddressesByJury.get(this.normalizeAddress(jurySCAddress));
      if (eventProjects && eventProjects.size > 0) {
        return Array.from(eventProjects).map(address => ethers.getAddress(address));
      }
    }

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
    projectAddresses: string[],
    eventState?: RegistryEventState
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    if (projectAddresses.length === 0) return result;

    const missingProjects: string[] = [];
    if (eventState) {
      for (const projectAddress of projectAddresses) {
        const eventCID = eventState.projectMetadata.get(this.makeMetadataKey(jurySCAddress, projectAddress));
        if (eventCID) {
          result.set(projectAddress, eventCID);
        } else {
          missingProjects.push(projectAddress);
        }
      }
    } else {
      missingProjects.push(...projectAddresses);
    }

    if (missingProjects.length === 0) return result;

    try {
      const cids = await registry.batchGetProjectMetadata(chainId, jurySCAddress, missingProjects);

      for (let i = 0; i < missingProjects.length; i++) {
        const cid = cids[i];
        if (cid && cid.length > 0) {
          result.set(missingProjects[i], cid);
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
    provider: JsonRpcProvider,
    currentBlock: number,
    eventState?: RegistryEventState
  ): Promise<void> {
    const jurySC = new Contract(round.jurySC, JURY_ABI, provider);

    try {
      // Check for voting mode override in registry
      const roundKey = this.makeRoundKey(iterationId, round.roundId);
      const normalizedJury = this.normalizeAddress(round.jurySC);
      const votingModeOverrideRaw = eventState
        ? (eventState.votingModeOverrides.get(normalizedJury) || 0)
        : Number(await registry.votingModeOverride(round.jurySC).catch(() => 0));
      const roundVersionRaw = eventState
        ? (eventState.roundVersions.get(roundKey) || 0)
        : Number(await registry.roundVersion(iterationId, round.roundId).catch(() => 0));

      const smtVotersRead = jurySC.getSmtVoters()
        .then((voters: string[]) => ({ supported: true, voters }))
        .catch(() => ({ supported: false, voters: [] as string[] }));

      const smtEntityVoteRead = jurySC.getSmtEntityVote()
        .then((vote: string) => ({ supported: true, vote }))
        .catch(() => ({ supported: false, vote: null as string | null }));

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
        smtVotersReadResult,
        daoHicVoters,
        devRelVote,
        smtEntityVoteReadResult,
        daoHicVote,
        communityVote,
        voteCounts,
        winner
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
        smtVotersRead,
        jurySC.getDaoHicVoters().catch(() => []),
        jurySC.getDevRelEntityVote().catch(() => null),
        smtEntityVoteRead,
        jurySC.getDaoHicEntityVote().catch(() => null),
        jurySC.getCommunityEntityVote().catch(() => null),
        jurySC.getVoteParticipationCounts().catch(() => [BigInt(0), BigInt(0), BigInt(0)]),
        votingModeOverrideRaw === 2 ? jurySC.getWinnerWeighted().catch(() => [null, false]) : jurySC.getWinner().catch(() => [null, false])
      ]);

      const votingMode = Number(votingModeRaw);
      const isV3Round = roundVersionRaw === 3 || smtVotersReadResult.supported;
      const roundVersion = roundVersionRaw > 0 ? roundVersionRaw : (isV3Round ? 3 : 2);
      const smtVoters = isV3Round
        ? smtVotersReadResult.voters.filter((voter) => voter && voter !== ethers.ZeroAddress)
        : [];
      const entityZeroVote = isV3Round
        ? smtEntityVoteReadResult.vote
        : devRelVote;
      const entityZeroAccount = !isV3Round && devRelAccount && devRelAccount !== ethers.ZeroAddress
        ? devRelAccount
        : null;

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
      const projectAddresses = await this.getProjectAddresses(jurySC, eventState, round.jurySC);
      const metadataCIDs = await this.getProjectMetadataCIDs(registry, chainId, round.jurySC, projectAddresses, eventState);

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
        round_version: roundVersion,
        jury_state: juryState,
        start_time: Number(startTime) || null,
        end_time: Number(endTime) || null,
        voting_mode: votingMode,
        projects_locked: projectsLocked ? 1 : 0,
        contract_locked: locked ? 1 : 0,
        winner_address: winner[0] && winner[0] !== ethers.ZeroAddress ? winner[0] : null,
        has_winner: winner[1] ? 1 : 0,
        devrel_vote: entityZeroVote && entityZeroVote !== ethers.ZeroAddress ? entityZeroVote : null,
        daohic_vote: daoHicVote && daoHicVote !== ethers.ZeroAddress ? daoHicVote : null,
        community_vote: communityVote && communityVote !== ethers.ZeroAddress ? communityVote : null,
        project_scores: projectScores ? JSON.stringify(projectScores) : null,
        devrel_count: Number(voteCounts[0]),
        daohic_count: Number(voteCounts[1]),
        community_count: Number(voteCounts[2]),
        devrel_account: entityZeroAccount,
        smt_voters: JSON.stringify(smtVoters),
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
      if (this.isRpcRateLimitError(error)) {
        logger.warn('RPC rate limit while indexing iteration round', {
          chainId,
          iterationId,
          round: round.roundId
        });
        throw error;
      }

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
  private async indexRoundlessIteration(chainId: number, iterationId: number, currentBlock: number): Promise<void> {
    try {
      this.iterationsDb.upsertSnapshot({
        iteration_id: iterationId,
        chain_id: chainId,
        round: 0,
        registry_address: NETWORKS[chainId].registryAddress,
        pob_address: ethers.ZeroAddress,
        jury_address: ethers.ZeroAddress,
        deploy_block_hint: 0,
        round_version: 0,
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
        smt_voters: JSON.stringify([]),
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

    if (this.shouldSkipForRpcBackoff(chainId)) {
      return;
    }

    try {
      const currentBlock = await provider.getBlockNumber();
      if (this.lastIndexedBlock.get(chainId) === currentBlock) {
        logger.debug('Skipping iteration indexing for unchanged block', { chainId, currentBlock });
        return;
      }

      const registry = new Contract(config.registryAddress, REGISTRY_ABI, provider);
      const eventState = await this.syncRegistryEvents(chainId, provider, currentBlock);

      // Prefer registry logs for discovery; fall back to views if logs are unavailable/empty.
      const iterationIds = eventState.iterationIds.size > 0
        ? Array.from(eventState.iterationIds).sort((a, b) => a - b)
        : (await registry.getAllIterationIds()).map((id: bigint) => Number(id));

      for (const iterationId of iterationIds) {
        const eventRounds = Array.from(eventState.rounds.values())
          .filter(round => round.iterationId === iterationId)
          .sort((a, b) => a.roundId - b.roundId);

        // Get all rounds for this iteration
        const rounds = eventRounds.length > 0 ? eventRounds : await registry.getRounds(iterationId);
        if (!rounds || rounds.length === 0) {
          await this.indexRoundlessIteration(chainId, iterationId, currentBlock);
          continue;
        }

        // Index each round (but prioritize latest)
        for (const round of rounds) {
          const roundId = Number(round.roundId);
          const existingSnapshot = this.iterationsDb.getSnapshot(chainId, iterationId, roundId);
          if (existingSnapshot?.contract_locked === 1) {
            logger.debug('Skipping immutable locked round snapshot refresh', {
              chainId,
              iterationId,
              round: roundId,
              lastBlock: existingSnapshot.last_block
            });
            continue;
          }

          await this.indexIterationRound(
            chainId,
            iterationId,
            { roundId, jurySC: round.jurySC, deployBlockHint: Number(round.deployBlockHint) },
            registry,
            provider,
            currentBlock,
            eventState
          );
        }
      }

      this.lastIndexedBlock.set(chainId, currentBlock);
      this.clearRpcBackoff(chainId);

      logger.info('Indexed chain', {
        chainId,
        name: config.name,
        iterationCount: iterationIds.length,
        currentBlock
      });
    } catch (error) {
      if (this.isRpcRateLimitError(error)) {
        this.applyRpcBackoff(chainId);
      }

      logger.error('Failed to index chain', { chainId, error });
    }
  }

  /**
   * Run a single poll cycle
   */
  async poll(): Promise<void> {
    logger.debug('Starting iteration indexer poll');

    const startTime = Date.now();

    // Index chains sequentially to avoid cross-chain RPC bursts.
    const chainIds = Array.from(this.providers.keys());
    for (const chainId of chainIds) {
      await this.indexChain(chainId);
    }

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
      iterationPollInterval: ITERATION_POLL_INTERVAL_MS,
      chains: Array.from(this.providers.keys()),
      singleChainMode: SINGLE_CHAIN_ID !== null ? SINGLE_CHAIN_ID : false
    });

    this.isRunning = true;

    await this.poll().catch(error => {
      logger.error('Iteration indexer poll failed', { error });
    });

    this.scheduleNextPoll();

    logger.info('Iteration indexer started');
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.pollTimer = setTimeout(() => {
      if (!this.isRunning) return;

      this.poll().catch(error => {
        logger.error('Iteration indexer poll failed', { error });
      }).finally(() => {
        this.scheduleNextPoll();
      });
    }, ITERATION_POLL_INTERVAL_MS);
  }

  /**
   * Stop the indexer
   */
  stop(): void {
    logger.info('Stopping iteration indexer');
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.db.close();
    logger.info('Iteration indexer stopped');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const indexer = new IterationIndexer();
  indexer.start().catch(error => {
    logger.error('Iteration indexer failed to start', { error });
    process.exit(1);
  });
}

export { IterationIndexer };
