#!/usr/bin/env tsx

/**
 * Export a reusable legacy migration batch from testnet chain state plus
 * optional SQLite metadata history.
 *
 * Supported env inputs:
 * - SOURCE_CHAIN_ID=5700
 * - SOURCE_RPC_URL=https://rpc.tanenbaum.io
 * - SOURCE_REGISTRY_ADDRESS=0x...
 * - SOURCE_DB_PATH=/sandbox/api/data/index.db
 * - MIGRATION_BATCH_ID=20260409T120000Z
 * - MIGRATION_OUTPUT_DIR=/sandbox/migration-artifacts/<batch>
 * - MIGRATION_ITERATIONS=1,2,3
 * - MIGRATION_ROUNDS=1:1,1:2,2:1
 */

import Database from 'better-sqlite3';
import { ethers } from 'ethers';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NETWORKS } from '../src/constants/networks.js';

type JuryState = 'deployed' | 'activated' | 'active' | 'ended' | 'locked';

interface ExportedRound {
  iterationId: number;
  roundId: number;
  versionId: number;
  chainId: number;
  juryAddress: string;
  pobAddress: string;
  deployBlockHint: number;
  entity0Label: 'SMT';
  juryState: JuryState;
  roundState: {
    startTime: number;
    endTime: number;
    manuallyClosed: boolean;
    manualEndTime: number;
    projectsLocked: boolean;
    locked: boolean;
    votingMode: number;
    votingEnded: boolean;
  };
  projects: string[];
  entity0Voters: string[];
  entity1Voters: string[];
  entity0Votes: Array<{ voter: string; project: string }>;
  entity1Votes: Array<{ voter: string; project: string }>;
  communityVotes: Array<{ tokenId: number; project: string }>;
  counts: {
    projects: number;
    entity0Voters: number;
    entity1Voters: number;
    entity0Votes: number;
    entity1Votes: number;
    communityVotes: number;
    badges: number;
  };
}

interface ExportedResult {
  iterationId: number;
  roundId: number;
  versionId: number;
  juryAddress: string;
  votingMode: number;
  entityVotes: {
    entity0: string | null;
    entity1: string | null;
    community: string | null;
  };
  voteCounts: {
    entity0: number;
    entity1: number;
    community: number;
  };
  winner: {
    projectAddress: string | null;
    hasWinner: boolean;
  };
  projectScores: {
    addresses: string[];
    scores: string[];
    totalPossible: string;
  } | null;
}

interface MetadataRevision {
  cid: string;
  txHash: string;
  txSentHeight: number | null;
  confirmations: number;
  createdAt: number;
  updatedAt: number;
  source: 'sqlite';
}

interface IterationMetadataEntry {
  iterationId: number;
  anchorRoundId: number;
  juryAddress: string;
  currentCid: string | null;
  history: MetadataRevision[];
}

interface ProjectMetadataEntry {
  iterationId: number;
  roundId: number;
  juryAddress: string;
  projectAddress: string;
  currentCid: string | null;
  history: MetadataRevision[];
}

interface ArchivedProjectMetadataEntry {
  iterationId: number;
  roundId: number;
  juryAddress: string;
  projectAddress: string;
  archiveReason: 'removed_from_final_state';
  lastKnownCid: string | null;
  history: MetadataRevision[];
}

interface BadgeSnapshot {
  tokenId: number;
  owner: string;
  role: string;
  claimed: boolean;
  communityVote: string | null;
}

interface BadgeGroup {
  iterationId: number;
  roundId: number;
  juryAddress: string;
  pobAddress: string;
  total: number;
  roleCounts: Record<string, number>;
  badges: BadgeSnapshot[];
}

interface ProofRecord {
  subjectType: 'round' | 'iteration_metadata' | 'project_metadata' | 'badge';
  subjectKey: string;
  iterationId: number;
  roundId: number;
  projectAddress: string | null;
  tokenId: number | null;
  proofChainId: number;
  txHash: string;
  blockNumber: number | null;
  logIndex: number | null;
  proofCid: null;
  source: 'jury_event' | 'badge_event' | 'sqlite_metadata';
  eventName: string;
  cid: string | null;
}

interface ManifestCounts {
  iterations: number;
  rounds: number;
  results: number;
  iterationMetadataEntries: number;
  iterationMetadataHistory: number;
  projectMetadataEntries: number;
  projectMetadataHistory: number;
  removedProjectMetadataEntries: number;
  removedProjectMetadataHistory: number;
  badgeGroups: number;
  badges: number;
  proofs: number;
  rawTransactions: number;
  rawReceipts: number;
  rawMetadata: number;
}

interface BatchManifest {
  batchId: string;
  sourceChainId: number;
  sourceRpcUrl: string;
  sourceRegistryAddress: string;
  sourceDbPath: string | null;
  sourceDbPresent: boolean;
  exportTimestamp: string;
  exportToolVersion: string;
  artifactFiles: string[];
  contentHashes: Record<string, string>;
  counts: ManifestCounts;
  rounds: Array<{
    iterationId: number;
    roundId: number;
    versionId: number;
    juryAddress: string;
    pobAddress: string;
    badgeTotals: {
      total: number;
      byRole: Record<string, number>;
    };
  }>;
  warnings: string[];
}

interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: ManifestCounts;
}

interface MetadataRow {
  chain_id: number;
  contract_address: string | null;
  iteration_number: number | null;
  project_address: string | null;
  cid: string;
  tx_hash: string;
  tx_sent_height: number | null;
  confirmations: number;
  confirmed: number;
  created_at: number;
  updated_at: number;
}

interface CachedMetadataRow {
  cid: string;
  content: string;
}

interface ExportContext {
  sourceChainId: number;
  provider: ethers.JsonRpcProvider;
  registry: ethers.Contract;
  warnings: string[];
}

const TOOL_VERSION = '1';
const ZERO_ADDRESS = ethers.ZeroAddress;
const DEFAULT_METADATA_API_BASE_URL = 'https://pob-api.syscoin.org/api';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiRoot = resolve(__dirname, '..');
const workspaceRoot = resolve(apiRoot, '..');

const REGISTRY_ABI = [
  'function getAllIterationIds() external view returns (uint256[])',
  'function getRounds(uint256 iterationId) external view returns (tuple(uint256 iterationId, uint256 roundId, address jurySC, uint256 deployBlockHint, bool exists)[])',
  'function roundVersion(uint256 iterationId, uint256 roundId) external view returns (uint256)',
  'function getAdapterConfig(uint256 iterationId, uint256 roundId) external view returns (address jurySC, address adapter)',
  'function getIterationMetadata(uint256 chainId, address jurySC) external view returns (string)',
  'function batchGetProjectMetadata(uint256 chainId, address jurySC, address[] projectAddresses) external view returns (string[])'
];

const ADAPTER_ABI = [
  'function isActive(address jurySC) external view returns (bool)',
  'function votingEnded(address jurySC) external view returns (bool)',
  'function locked(address jurySC) external view returns (bool)',
  'function projectsLocked(address jurySC) external view returns (bool)',
  'function votingMode(address jurySC) external view returns (uint8)',
  'function getProjectAddresses(address jurySC) external view returns (address[])',
  'function getEntityVoters(address jurySC, uint8 entityId) external view returns (address[])',
  'function entityVoteOf(address jurySC, uint8 entityId, address voter) external view returns (address)',
  'function getEntityVote(address jurySC, uint8 entityId) external view returns (address)',
  'function communityVoteOf(address jurySC, uint256 tokenId) external view returns (address)',
  'function getCommunityEntityVote(address jurySC) external view returns (address)',
  'function getVoteParticipationCounts(address jurySC) external view returns (uint256, uint256, uint256)',
  'function getWinner(address jurySC) external view returns (address, bool)',
  'function getWinnerWithScores(address jurySC) external view returns (address[], uint256[], uint256)',
  'function pobAddress(address jurySC) external view returns (address)',
  'function getRoleOf(address jurySC, uint256 tokenId) external view returns (string)',
  'function claimed(address jurySC, uint256 tokenId) external view returns (bool)',
  'function ownerOfToken(address jurySC, uint256 tokenId) external view returns (address)',
  'function startTime(address jurySC) external view returns (uint64)',
  'function endTime(address jurySC) external view returns (uint64)'
];

const JURY_STATE_ABI = [
  'function manuallyClosed() external view returns (bool)',
  'function manualEndTime() external view returns (uint64)'
];

const POB_STATE_ABI = [
  'function nextId() external view returns (uint256)'
];

const JURY_V1_V2_EVENT_ABI = [
  'event ProjectRegistered(uint256 indexed projectId, address indexed projectAddress)',
  'event ProjectRemoved(address indexed projectAddress)',
  'event DevRelAccountSet(address indexed account)',
  'event DaoHicVoterAdded(address indexed voter)',
  'event DaoHicVoterRemoved(address indexed voter)',
  'event Activated(uint64 startTime, uint64 endTime)',
  'event VotedDevRel(uint256 indexed projectId)',
  'event VotedDaoHic(address indexed voter, uint256 indexed projectId)',
  'event VotedCommunity(uint256 indexed tokenId, address indexed voter, uint256 indexed projectId)',
  'event ContractLockedForHistory(address indexed winningProject)',
  'event ClosedManually(uint64 timestamp)',
  'event VotingModeChanged(uint8 indexed oldMode, uint8 indexed newMode)'
];

const JURY_V3_EVENT_ABI = [
  'event ProjectRegistered(uint256 indexed projectId, address indexed projectAddress)',
  'event ProjectRemoved(address indexed projectAddress)',
  'event SmtVoterAdded(address indexed voter)',
  'event SmtVoterRemoved(address indexed voter)',
  'event DaoHicVoterAdded(address indexed voter)',
  'event DaoHicVoterRemoved(address indexed voter)',
  'event Activated(uint64 startTime, uint64 endTime)',
  'event VotedSmt(address indexed voter, uint256 indexed projectId)',
  'event VotedDaoHic(address indexed voter, uint256 indexed projectId)',
  'event VotedCommunity(uint256 indexed tokenId, address indexed voter, uint256 indexed projectId)',
  'event ContractLockedForHistory(address indexed winningProject)',
  'event ClosedManually(uint64 timestamp)',
  'event VotingModeChanged(uint8 indexed oldMode, uint8 indexed newMode)'
];

const POB_EVENT_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Claimed(uint256 indexed tokenId, address indexed participant)'
];

function envString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function normalizeAddress(address: string): string {
  return ethers.getAddress(address);
}

function normalizeNullableAddress(address: string | null | undefined): string | null {
  if (!address || address === ZERO_ADDRESS) return null;
  return normalizeAddress(address);
}

function normalizeAddressList(addresses: string[]): string[] {
  return addresses.map((address) => normalizeAddress(address));
}

function normalizeMigratedRole(role: string): string {
  return role === 'DevRel' ? 'SMT' : role;
}

function normalizeMetadataApiBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function parseIterationFilter(): Set<number> | null {
  const raw = envString('MIGRATION_ITERATIONS');
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
}

function parseRoundFilter(): Set<string> | null {
  const raw = envString('MIGRATION_ROUNDS');
  if (!raw) return null;
  const result = new Set<string>();
  for (const part of raw.split(',')) {
    const [iteration, round] = part.trim().split(':').map((value) => Number(value.trim()));
    if (Number.isInteger(iteration) && iteration > 0 && Number.isInteger(round) && round > 0) {
      result.add(`${iteration}:${round}`);
    }
  }
  return result;
}

function shouldIncludeRound(
  iterationId: number,
  roundId: number,
  iterationFilter: Set<number> | null,
  roundFilter: Set<string> | null
): boolean {
  if (iterationFilter && !iterationFilter.has(iterationId)) return false;
  if (roundFilter && !roundFilter.has(`${iterationId}:${roundId}`)) return false;
  return true;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function collectReferencedMetadataCids(
  iterationMetadata: IterationMetadataEntry[],
  projectMetadata: ProjectMetadataEntry[],
  removedProjectMetadata: ArchivedProjectMetadataEntry[]
): string[] {
  return [...new Set([
    ...iterationMetadata.flatMap((entry) => [entry.currentCid, ...entry.history.map((revision) => revision.cid)]),
    ...projectMetadata.flatMap((entry) => [entry.currentCid, ...entry.history.map((revision) => revision.cid)]),
    ...removedProjectMetadata.flatMap((entry) => [entry.lastKnownCid, ...entry.history.map((revision) => revision.cid)])
  ].filter((cid): cid is string => Boolean(cid)))].sort();
}

function listFilesRecursively(root: string): string[] {
  const result: string[] = [];

  function visit(current: string): void {
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        visit(fullPath);
      } else {
        result.push(relative(root, fullPath));
      }
    }
  }

  visit(root);
  return result.sort();
}

function isValidTxHash(value: string | null | undefined): boolean {
  return Boolean(value && ethers.isHexString(value, 32));
}

function isValidCid(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0 && !/\s/.test(value));
}

function roundSubjectKey(chainId: number, juryAddress: string): string {
  return `${chainId}:round:${juryAddress.toLowerCase()}`;
}

function iterationMetadataSubjectKey(chainId: number, juryAddress: string): string {
  return `${chainId}:iteration-metadata:${juryAddress.toLowerCase()}`;
}

function projectMetadataSubjectKey(chainId: number, juryAddress: string, projectAddress: string): string {
  return `${chainId}:project-metadata:${juryAddress.toLowerCase()}:${projectAddress.toLowerCase()}`;
}

function badgeSubjectKey(chainId: number, pobAddress: string, tokenId: number): string {
  return `${chainId}:badge:${pobAddress.toLowerCase()}:${tokenId}`;
}

function determineJuryState(
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

function serializeEventLog(log: ethers.EventLog): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (let index = 0; index < log.fragment.inputs.length; index++) {
    const input = log.fragment.inputs[index];
    const rawValue = log.args[index];
    if (typeof rawValue === 'bigint') {
      args[input.name || String(index)] = rawValue.toString();
    } else {
      args[input.name || String(index)] = rawValue;
    }
  }

  return {
    eventName: log.fragment.name,
    address: normalizeAddress(log.address),
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.index,
    topics: log.topics,
    args
  };
}

function serializeTransaction(tx: ethers.TransactionResponse | null): Record<string, unknown> | null {
  if (!tx) return null;
  return {
    hash: tx.hash,
    blockHash: tx.blockHash,
    blockNumber: tx.blockNumber,
    index: tx.index,
    type: tx.type,
    from: tx.from,
    to: tx.to ? normalizeAddress(tx.to) : null,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit.toString(),
    gasPrice: tx.gasPrice ? tx.gasPrice.toString() : null,
    maxFeePerGas: tx.maxFeePerGas ? tx.maxFeePerGas.toString() : null,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? tx.maxPriorityFeePerGas.toString() : null,
    data: tx.data,
    value: tx.value.toString(),
    chainId: Number(tx.chainId),
    signature: tx.signature,
    accessList: tx.accessList ?? []
  };
}

function serializeReceipt(receipt: ethers.TransactionReceipt | null): Record<string, unknown> | null {
  if (!receipt) return null;
  return {
    hash: receipt.hash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    index: receipt.index,
    from: receipt.from,
    to: receipt.to ? normalizeAddress(receipt.to) : null,
    contractAddress: receipt.contractAddress ? normalizeAddress(receipt.contractAddress) : null,
    gasUsed: receipt.gasUsed.toString(),
    cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : null,
    status: receipt.status,
    type: receipt.type,
    logs: receipt.logs.map((log) => ({
      address: normalizeAddress(log.address),
      topics: log.topics,
      data: log.data,
      index: log.index,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      transactionIndex: log.transactionIndex
    }))
  };
}

async function queryEventLogs(
  contract: ethers.Contract,
  eventNames: string[],
  fromBlock: number
): Promise<ethers.EventLog[]> {
  const all: ethers.EventLog[] = [];
  for (const eventName of eventNames) {
    const filterFactory = (contract.filters as Record<string, () => ethers.DeferredTopicFilter | undefined>)[eventName];
    if (!filterFactory) continue;
    const logs = await contract.queryFilter(filterFactory(), fromBlock, 'latest');
    for (const log of logs) {
      if (log instanceof ethers.EventLog) {
        all.push(log);
      }
    }
  }

  all.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber;
    return left.index - right.index;
  });
  return all;
}

async function exportRound(
  ctx: ExportContext,
  iterationId: number,
  roundId: number,
  juryAddress: string,
  deployBlockHint: number,
  versionId: number,
  adapterAddress: string,
  rawLogsDir: string
): Promise<{
  round: ExportedRound;
  result: ExportedResult;
  projectMetadata: ProjectMetadataEntry[];
  badges: BadgeGroup;
  proofs: ProofRecord[];
}> {
  const adapter = new ethers.Contract(adapterAddress, ADAPTER_ABI, ctx.provider);
  const juryStateContract = new ethers.Contract(juryAddress, JURY_STATE_ABI, ctx.provider);

  const [
    isActive,
    votingEnded,
    locked,
    projectsLocked,
    votingModeRaw,
    startTimeRaw,
    endTimeRaw,
    manuallyClosed,
    manualEndTimeRaw,
    projectsRaw,
    entity0VotersRaw,
    entity1VotersRaw,
    entity0EntityVoteRaw,
    entity1EntityVoteRaw,
    communityEntityVoteRaw,
    voteCountsRaw,
    winnerRaw,
    projectScoresRaw,
    pobAddressRaw
  ] = await Promise.all([
    adapter.isActive(juryAddress),
    adapter.votingEnded(juryAddress),
    adapter.locked(juryAddress),
    adapter.projectsLocked(juryAddress),
    adapter.votingMode(juryAddress),
    adapter.startTime(juryAddress),
    adapter.endTime(juryAddress),
    juryStateContract.manuallyClosed().catch(() => false),
    juryStateContract.manualEndTime().catch(() => BigInt(0)),
    adapter.getProjectAddresses(juryAddress),
    adapter.getEntityVoters(juryAddress, 0),
    adapter.getEntityVoters(juryAddress, 1),
    adapter.getEntityVote(juryAddress, 0),
    adapter.getEntityVote(juryAddress, 1),
    adapter.getCommunityEntityVote(juryAddress),
    adapter.getVoteParticipationCounts(juryAddress),
    adapter.getWinner(juryAddress),
    adapter.getWinnerWithScores(juryAddress).catch(() => [[], [], BigInt(0)]),
    adapter.pobAddress(juryAddress)
  ]);

  const projects = normalizeAddressList(projectsRaw as string[]);
  const entity0Voters = normalizeAddressList(entity0VotersRaw as string[]);
  const entity1Voters = normalizeAddressList(entity1VotersRaw as string[]);
  const pobAddress = normalizeAddress(pobAddressRaw as string);
  const entity0Label = 'SMT';
  const startTime = Number(startTimeRaw);
  const endTime = Number(endTimeRaw);
  const manualEndTime = Number(manualEndTimeRaw);
  const votingMode = Number(votingModeRaw);
  const juryState = determineJuryState(isActive, votingEnded, locked, startTime);

  const entity0Votes = (
    await Promise.all(
      entity0Voters.map(async (voter) => {
        const vote = normalizeNullableAddress(await adapter.entityVoteOf(juryAddress, 0, voter));
        return vote ? { voter, project: vote } : null;
      })
    )
  ).filter((entry): entry is { voter: string; project: string } => entry !== null);

  const entity1Votes = (
    await Promise.all(
      entity1Voters.map(async (voter) => {
        const vote = normalizeNullableAddress(await adapter.entityVoteOf(juryAddress, 1, voter));
        return vote ? { voter, project: vote } : null;
      })
    )
  ).filter((entry): entry is { voter: string; project: string } => entry !== null);

  const projectMetadataEntries: ProjectMetadataEntry[] = [];
  if (projects.length > 0) {
    const projectCidMap = new Map<string, string>();
    for (const projectBatch of chunk(projects, 50)) {
      const cids = await ctx.registry.batchGetProjectMetadata(ctx.sourceChainId, juryAddress, projectBatch);
      for (let index = 0; index < projectBatch.length; index++) {
        const cid = String(cids[index] || '');
        projectCidMap.set(projectBatch[index], cid);
      }
    }

    for (const projectAddress of projects) {
      projectMetadataEntries.push({
        iterationId,
        roundId,
        juryAddress,
        projectAddress,
        currentCid: projectCidMap.get(projectAddress) || null,
        history: []
      });
    }
  }

  const proofs: ProofRecord[] = [];
  const juryLogContract = new ethers.Contract(
    juryAddress,
    versionId >= 3 ? JURY_V3_EVENT_ABI : JURY_V1_V2_EVENT_ABI,
    ctx.provider
  );
  const pobLogContract = new ethers.Contract(pobAddress, POB_EVENT_ABI, ctx.provider);
  const fromBlock = Math.max(0, Number(deployBlockHint || 0));

  const juryEventNames = versionId >= 3
    ? ['ProjectRegistered', 'ProjectRemoved', 'SmtVoterAdded', 'SmtVoterRemoved', 'DaoHicVoterAdded', 'DaoHicVoterRemoved', 'Activated', 'VotedSmt', 'VotedDaoHic', 'VotedCommunity', 'ContractLockedForHistory', 'ClosedManually', 'VotingModeChanged']
    : ['ProjectRegistered', 'ProjectRemoved', 'DevRelAccountSet', 'DaoHicVoterAdded', 'DaoHicVoterRemoved', 'Activated', 'VotedDevRel', 'VotedDaoHic', 'VotedCommunity', 'ContractLockedForHistory', 'ClosedManually', 'VotingModeChanged'];

  const [juryLogs, pobLogs] = await Promise.all([
    queryEventLogs(juryLogContract, juryEventNames, fromBlock),
    queryEventLogs(pobLogContract, ['Transfer', 'Claimed'], fromBlock)
  ]);

  writeJson(join(rawLogsDir, `iteration-${iterationId}-round-${roundId}-jury.json`), juryLogs.map(serializeEventLog));
  writeJson(join(rawLogsDir, `iteration-${iterationId}-round-${roundId}-pob.json`), pobLogs.map(serializeEventLog));

  const ownerByToken = new Map<number, string>();
  const claimedTokens = new Set<number>();
  const communityVoteByToken = new Map<number, string>();

  for (const log of juryLogs) {
    if (log.fragment.name !== 'VotedCommunity') continue;
    const tokenId = Number(log.args[0]);
    const projectId = Number(log.args[2]);
    const projectAddress = projects[projectId - 1];
    if (projectAddress) {
      communityVoteByToken.set(tokenId, projectAddress);
    }
  }

  for (const log of pobLogs) {
    if (log.fragment.name === 'Transfer') {
      const tokenId = Number(log.args[2]);
      const owner = normalizeNullableAddress(String(log.args[1]));
      if (owner) {
        ownerByToken.set(tokenId, owner);
      }
      continue;
    }

    claimedTokens.add(Number(log.args[0]));
  }

  const pobState = new ethers.Contract(pobAddress, POB_STATE_ABI, ctx.provider);
  const nextId = Number(await pobState.nextId());
  const badgeSnapshots: BadgeSnapshot[] = [];
  const roleCounts: Record<string, number> = {};
  const communityVotes: Array<{ tokenId: number; project: string }> = [];

  for (const tokenBatch of chunk(Array.from({ length: nextId }, (_, index) => index), 10)) {
    const batchResults = await Promise.all(
      tokenBatch.map(async (tokenId) => {
        const role = normalizeMigratedRole(String(await adapter.getRoleOf(juryAddress, tokenId)));
        const owner = ownerByToken.get(tokenId)
          || normalizeAddress(await adapter.ownerOfToken(juryAddress, tokenId));
        const communityVote = communityVoteByToken.get(tokenId) || null;

        return {
          tokenId,
          owner,
          role,
          claimed: claimedTokens.has(tokenId),
          communityVote
        } satisfies BadgeSnapshot;
      })
    );

    for (const badge of batchResults) {
      badgeSnapshots.push(badge);
      roleCounts[badge.role] = (roleCounts[badge.role] || 0) + 1;
      if (badge.communityVote) {
        communityVotes.push({ tokenId: badge.tokenId, project: badge.communityVote });
      }
    }

    await sleep(150);
  }

  const round: ExportedRound = {
    iterationId,
    roundId,
    versionId,
    chainId: ctx.sourceChainId,
    juryAddress,
    pobAddress,
    deployBlockHint,
    entity0Label,
    juryState,
    roundState: {
      startTime,
      endTime,
      manuallyClosed: Boolean(manuallyClosed),
      manualEndTime,
      projectsLocked: Boolean(projectsLocked),
      locked: Boolean(locked),
      votingMode,
      votingEnded: Boolean(votingEnded)
    },
    projects,
    entity0Voters,
    entity1Voters,
    entity0Votes,
    entity1Votes,
    communityVotes,
    counts: {
      projects: projects.length,
      entity0Voters: entity0Voters.length,
      entity1Voters: entity1Voters.length,
      entity0Votes: entity0Votes.length,
      entity1Votes: entity1Votes.length,
      communityVotes: communityVotes.length,
      badges: badgeSnapshots.length
    }
  };

  const result: ExportedResult = {
    iterationId,
    roundId,
    versionId,
    juryAddress,
    votingMode,
    entityVotes: {
      entity0: normalizeNullableAddress(entity0EntityVoteRaw as string),
      entity1: normalizeNullableAddress(entity1EntityVoteRaw as string),
      community: normalizeNullableAddress(communityEntityVoteRaw as string)
    },
    voteCounts: {
      entity0: Number(voteCountsRaw[0]),
      entity1: Number(voteCountsRaw[1]),
      community: Number(voteCountsRaw[2])
    },
    winner: {
      projectAddress: normalizeNullableAddress(winnerRaw[0] as string),
      hasWinner: Boolean(winnerRaw[1])
    },
    projectScores: Array.isArray(projectScoresRaw[0]) && projectScoresRaw[0].length > 0
      ? {
          addresses: normalizeAddressList(projectScoresRaw[0] as string[]),
          scores: (projectScoresRaw[1] as bigint[]).map((score) => score.toString()),
          totalPossible: (projectScoresRaw[2] as bigint).toString()
        }
      : null
  };

  const badges: BadgeGroup = {
    iterationId,
    roundId,
    juryAddress,
    pobAddress,
    total: badgeSnapshots.length,
    roleCounts,
    badges: badgeSnapshots
  };

  for (const log of juryLogs) {
    proofs.push({
      subjectType: 'round',
      subjectKey: roundSubjectKey(ctx.sourceChainId, juryAddress),
      iterationId,
      roundId,
      projectAddress: null,
      tokenId: null,
      proofChainId: ctx.sourceChainId,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      proofCid: null,
      source: 'jury_event',
      eventName: log.fragment.name,
      cid: null
    });
  }

  for (const log of pobLogs) {
    const tokenId = log.fragment.name === 'Transfer'
      ? Number(log.args[2])
      : Number(log.args[0]);
    proofs.push({
      subjectType: 'badge',
      subjectKey: badgeSubjectKey(ctx.sourceChainId, pobAddress, tokenId),
      iterationId,
      roundId,
      projectAddress: null,
      tokenId,
      proofChainId: ctx.sourceChainId,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      proofCid: null,
      source: 'badge_event',
      eventName: log.fragment.name,
      cid: null
    });
  }

  return {
    round,
    result,
    projectMetadata: projectMetadataEntries,
    badges,
    proofs
  };
}

async function buildIterationMetadataEntries(
  ctx: ExportContext,
  rounds: ExportedRound[]
): Promise<IterationMetadataEntry[]> {
  const latestRoundByIteration = new Map<number, ExportedRound>();

  for (const round of rounds) {
    const current = latestRoundByIteration.get(round.iterationId);
    if (!current || round.roundId > current.roundId) {
      latestRoundByIteration.set(round.iterationId, round);
    }
  }

  const entries = await Promise.all(
    [...latestRoundByIteration.values()]
      .sort((left, right) => left.iterationId - right.iterationId)
      .map(async (round) => {
        const cidRaw = await ctx.registry.getIterationMetadata(ctx.sourceChainId, round.juryAddress);
        return {
          iterationId: round.iterationId,
          anchorRoundId: round.roundId,
          juryAddress: round.juryAddress,
          currentCid: String(cidRaw || '') || null,
          history: []
        } satisfies IterationMetadataEntry;
      })
  );

  return entries;
}

function mapMetadataRows(
  rows: MetadataRow[],
  rounds: ExportedRound[],
  iterationMetadata: IterationMetadataEntry[],
  projectMetadata: ProjectMetadataEntry[],
  removedProjectMetadata: ArchivedProjectMetadataEntry[],
  proofs: ProofRecord[],
  warnings: string[],
  sourceChainId: number
): void {
  const roundByJury = new Map<string, ExportedRound>();
  const roundsByIteration = new Map<number, ExportedRound[]>();
  const iterationMetadataByIteration = new Map<number, IterationMetadataEntry>();
  const projectMetadataByKey = new Map<string, ProjectMetadataEntry>();
  const removedProjectMetadataByKey = new Map<string, ArchivedProjectMetadataEntry>();

  for (const round of rounds) {
    roundByJury.set(round.juryAddress.toLowerCase(), round);
    const group = roundsByIteration.get(round.iterationId) || [];
    group.push(round);
    roundsByIteration.set(round.iterationId, group);
  }

  for (const entry of iterationMetadata) {
    iterationMetadataByIteration.set(entry.iterationId, entry);
  }

  for (const entry of projectMetadata) {
    projectMetadataByKey.set(`${entry.juryAddress.toLowerCase()}:${entry.projectAddress.toLowerCase()}`, entry);
  }

  for (const entry of removedProjectMetadata) {
    removedProjectMetadataByKey.set(`${entry.juryAddress.toLowerCase()}:${entry.projectAddress.toLowerCase()}`, entry);
  }

  for (const row of rows) {
    let mappedRound: ExportedRound | null = null;
    const contractAddress = normalizeNullableAddress(row.contract_address);
    const projectAddress = normalizeNullableAddress(row.project_address);

    if (contractAddress) {
      mappedRound = roundByJury.get(contractAddress.toLowerCase()) || null;
    }

    if (!mappedRound && row.iteration_number) {
      const candidates = roundsByIteration.get(row.iteration_number) || [];
      if (projectAddress) {
        const matchingRounds = candidates.filter((round) =>
          round.projects.some((project) => project.toLowerCase() === projectAddress.toLowerCase())
        );
        if (matchingRounds.length === 1) {
          mappedRound = matchingRounds[0];
        }
      } else if (candidates.length === 1) {
        mappedRound = candidates[0];
      }
    }

    if (!mappedRound) {
      warnings.push(`Skipped unmapped metadata history row ${row.tx_hash}`);
      continue;
    }

    const revision: MetadataRevision = {
      cid: row.cid,
      txHash: row.tx_hash,
      txSentHeight: row.tx_sent_height,
      confirmations: row.confirmations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'sqlite'
    };

    if (!projectAddress) {
      const entry = iterationMetadataByIteration.get(mappedRound.iterationId);
      if (!entry) {
        warnings.push(`Missing iteration metadata entry for iteration ${mappedRound.iterationId}`);
        continue;
      }
      entry.history.push(revision);
      proofs.push({
        subjectType: 'iteration_metadata',
        subjectKey: iterationMetadataSubjectKey(sourceChainId, entry.juryAddress),
        iterationId: entry.iterationId,
        roundId: entry.anchorRoundId,
        projectAddress: null,
        tokenId: null,
        proofChainId: sourceChainId,
        txHash: row.tx_hash,
        blockNumber: row.tx_sent_height,
        logIndex: null,
        proofCid: null,
        source: 'sqlite_metadata',
        eventName: 'MetadataUpdate',
        cid: row.cid
      });
      continue;
    }

    const entry = projectMetadataByKey.get(`${mappedRound.juryAddress.toLowerCase()}:${projectAddress.toLowerCase()}`);
    if (!entry) {
      const archiveKey = `${mappedRound.juryAddress.toLowerCase()}:${projectAddress.toLowerCase()}`;
      let archivedEntry = removedProjectMetadataByKey.get(archiveKey);
      if (!archivedEntry) {
        archivedEntry = {
          iterationId: mappedRound.iterationId,
          roundId: mappedRound.roundId,
          juryAddress: mappedRound.juryAddress,
          projectAddress,
          archiveReason: 'removed_from_final_state',
          lastKnownCid: null,
          history: []
        };
        removedProjectMetadata.push(archivedEntry);
        removedProjectMetadataByKey.set(archiveKey, archivedEntry);
      }

      archivedEntry.history.push(revision);
      archivedEntry.lastKnownCid = revision.cid;
      proofs.push({
        subjectType: 'project_metadata',
        subjectKey: projectMetadataSubjectKey(sourceChainId, mappedRound.juryAddress, projectAddress),
        iterationId: mappedRound.iterationId,
        roundId: mappedRound.roundId,
        projectAddress,
        tokenId: null,
        proofChainId: sourceChainId,
        txHash: row.tx_hash,
        blockNumber: row.tx_sent_height,
        logIndex: null,
        proofCid: null,
        source: 'sqlite_metadata',
        eventName: 'MetadataUpdate',
        cid: row.cid
      });
      continue;
    }

    entry.history.push(revision);
    proofs.push({
      subjectType: 'project_metadata',
      subjectKey: projectMetadataSubjectKey(sourceChainId, mappedRound.juryAddress, projectAddress),
      iterationId: mappedRound.iterationId,
      roundId: mappedRound.roundId,
      projectAddress,
      tokenId: null,
      proofChainId: sourceChainId,
      txHash: row.tx_hash,
      blockNumber: row.tx_sent_height,
      logIndex: null,
      proofCid: null,
      source: 'sqlite_metadata',
      eventName: 'MetadataUpdate',
      cid: row.cid
    });
  }

  for (const entry of iterationMetadata) {
    entry.history.sort((left, right) => left.createdAt - right.createdAt);
  }
  for (const entry of projectMetadata) {
    entry.history.sort((left, right) => left.createdAt - right.createdAt);
  }
  for (const entry of removedProjectMetadata) {
    entry.history.sort((left, right) => left.createdAt - right.createdAt);
    entry.lastKnownCid = entry.history.length > 0 ? entry.history[entry.history.length - 1].cid : null;
  }
}

function loadMetadataRows(dbPath: string, sourceChainId: number): MetadataRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`
      SELECT chain_id, contract_address, iteration_number, project_address, cid, tx_hash,
             tx_sent_height, confirmations, confirmed, created_at, updated_at
      FROM pob_metadata_history
      WHERE chain_id = ? AND confirmed = 1
      ORDER BY created_at ASC, tx_hash ASC
    `).all(sourceChainId) as MetadataRow[];
  } finally {
    db.close();
  }
}

function loadCachedMetadataRows(dbPath: string, cids: string[]): CachedMetadataRow[] {
  if (cids.length === 0) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows: CachedMetadataRow[] = [];
    for (const cidBatch of chunk([...new Set(cids)], 200)) {
      const placeholders = cidBatch.map(() => '?').join(',');
      rows.push(
        ...(db.prepare(`SELECT cid, content FROM pob_ipfs_cache WHERE cid IN (${placeholders})`).all(...cidBatch) as CachedMetadataRow[])
      );
    }
    return rows;
  } finally {
    db.close();
  }
}

async function fetchMissingMetadataRows(
  metadataApiBaseUrl: string,
  cids: string[],
  warnings: string[]
): Promise<CachedMetadataRow[]> {
  const rows: CachedMetadataRow[] = [];
  const normalizedBaseUrl = normalizeMetadataApiBaseUrl(metadataApiBaseUrl);

  for (const cid of cids) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/metadata/cid/${cid}`);
      if (!response.ok) {
        warnings.push(`Failed to fetch metadata body for CID ${cid} from ${normalizedBaseUrl} (${response.status})`);
        continue;
      }

      const payload = await response.json() as { success?: boolean; metadata?: unknown };
      if (!payload.success || payload.metadata === undefined) {
        warnings.push(`Metadata API returned empty payload for CID ${cid}`);
        continue;
      }

      rows.push({
        cid,
        content: JSON.stringify(payload.metadata)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to fetch metadata body for CID ${cid}: ${message}`);
    }

    await sleep(100);
  }

  return rows;
}

function collectCounts(
  rounds: ExportedRound[],
  results: ExportedResult[],
  iterationMetadata: IterationMetadataEntry[],
  projectMetadata: ProjectMetadataEntry[],
  removedProjectMetadata: ArchivedProjectMetadataEntry[],
  badges: BadgeGroup[],
  proofs: ProofRecord[],
  rawTransactionCount: number,
  rawReceiptCount: number,
  rawMetadataCount: number
): ManifestCounts {
  const iterationIds = new Set(rounds.map((round) => round.iterationId));
  return {
    iterations: iterationIds.size,
    rounds: rounds.length,
    results: results.length,
    iterationMetadataEntries: iterationMetadata.length,
    iterationMetadataHistory: iterationMetadata.reduce((total, entry) => total + entry.history.length, 0),
    projectMetadataEntries: projectMetadata.length,
    projectMetadataHistory: projectMetadata.reduce((total, entry) => total + entry.history.length, 0),
    removedProjectMetadataEntries: removedProjectMetadata.length,
    removedProjectMetadataHistory: removedProjectMetadata.reduce((total, entry) => total + entry.history.length, 0),
    badgeGroups: badges.length,
    badges: badges.reduce((total, group) => total + group.badges.length, 0),
    proofs: proofs.length,
    rawTransactions: rawTransactionCount,
    rawReceipts: rawReceiptCount,
    rawMetadata: rawMetadataCount
  };
}

function validateBatch(
  manifest: BatchManifest,
  checksums: Record<string, string>,
  rounds: ExportedRound[],
  results: ExportedResult[],
  iterationMetadata: IterationMetadataEntry[],
  projectMetadata: ProjectMetadataEntry[],
  removedProjectMetadata: ArchivedProjectMetadataEntry[],
  badges: BadgeGroup[],
  proofs: ProofRecord[],
  outputDir: string
): ValidationReport {
  const errors: string[] = [];
  const warnings = [...manifest.warnings];
  const roundMap = new Map<string, ExportedRound>();
  const badgeSubjectKeys = new Set<string>();
  const validSubjectKeys = new Set<string>();
  const activeProjectMetadataKeys = new Set<string>();

  for (const round of rounds) {
    const key = `${round.iterationId}:${round.roundId}`;
    if (roundMap.has(key)) {
      errors.push(`Duplicate round ${key}`);
      continue;
    }
    roundMap.set(key, round);
    validSubjectKeys.add(roundSubjectKey(manifest.sourceChainId, round.juryAddress));

    if (round.chainId !== manifest.sourceChainId) {
      errors.push(`Round ${key} has unexpected chain id ${round.chainId}`);
    }
    if (round.entity0Label !== 'SMT') {
      errors.push(`Round ${key} has non-standardized entity0 label ${round.entity0Label}`);
    }
    if (!ethers.isAddress(round.juryAddress) || normalizeAddress(round.juryAddress) !== round.juryAddress) {
      errors.push(`Round ${key} has invalid jury address ${round.juryAddress}`);
    }
    if (!ethers.isAddress(round.pobAddress) || normalizeAddress(round.pobAddress) !== round.pobAddress) {
      errors.push(`Round ${key} has invalid pob address ${round.pobAddress}`);
    }
  }

  if (results.length !== rounds.length) {
    errors.push(`results.json count ${results.length} does not match rounds count ${rounds.length}`);
  }

  for (const result of results) {
    const key = `${result.iterationId}:${result.roundId}`;
    if (!roundMap.has(key)) {
      errors.push(`Result ${key} does not match an exported round`);
    }
  }

  for (const entry of iterationMetadata) {
    const key = `${entry.iterationId}`;
    const roundKey = `${entry.iterationId}:${entry.anchorRoundId}`;
    if (!roundMap.has(roundKey)) {
      errors.push(`Iteration metadata ${key} does not match anchor round ${roundKey}`);
      continue;
    }
    validSubjectKeys.add(iterationMetadataSubjectKey(manifest.sourceChainId, entry.juryAddress));
    if (entry.currentCid && !isValidCid(entry.currentCid)) {
      errors.push(`Iteration metadata ${key} has invalid current CID ${entry.currentCid}`);
    }
    if (!entry.currentCid) {
      warnings.push(`Iteration ${key} has no current iteration metadata CID on anchor round ${entry.anchorRoundId}`);
    }
    for (const revision of entry.history) {
      if (!isValidCid(revision.cid)) errors.push(`Iteration metadata ${key} history has invalid CID ${revision.cid}`);
      if (!isValidTxHash(revision.txHash)) errors.push(`Iteration metadata ${key} history has invalid tx hash ${revision.txHash}`);
    }
  }

  for (const entry of projectMetadata) {
    const key = `${entry.iterationId}:${entry.roundId}`;
    const round = roundMap.get(key);
    if (!round) {
      errors.push(`Project metadata ${key} ${entry.projectAddress} does not match an exported round`);
      continue;
    }
    if (!round.projects.some((project) => project.toLowerCase() === entry.projectAddress.toLowerCase())) {
      errors.push(`Project metadata ${key} points to unknown project ${entry.projectAddress}`);
    }
    validSubjectKeys.add(projectMetadataSubjectKey(manifest.sourceChainId, entry.juryAddress, entry.projectAddress));
    activeProjectMetadataKeys.add(`${entry.juryAddress.toLowerCase()}:${entry.projectAddress.toLowerCase()}`);
    if (entry.currentCid && !isValidCid(entry.currentCid)) {
      errors.push(`Project metadata ${key} ${entry.projectAddress} has invalid current CID ${entry.currentCid}`);
    }
    if (!entry.currentCid) {
      warnings.push(`Project ${key} ${entry.projectAddress} has no current metadata CID`);
    }
    for (const revision of entry.history) {
      if (!isValidCid(revision.cid)) errors.push(`Project metadata ${key} ${entry.projectAddress} history has invalid CID ${revision.cid}`);
      if (!isValidTxHash(revision.txHash)) errors.push(`Project metadata ${key} ${entry.projectAddress} history has invalid tx hash ${revision.txHash}`);
    }
  }

  for (const entry of removedProjectMetadata) {
    const key = `${entry.iterationId}:${entry.roundId}`;
    const round = roundMap.get(key);
    if (!round) {
      errors.push(`Archived project metadata ${key} ${entry.projectAddress} does not match an exported round`);
      continue;
    }
    if (round.projects.some((project) => project.toLowerCase() === entry.projectAddress.toLowerCase())) {
      errors.push(`Archived project metadata ${key} ${entry.projectAddress} still exists in active project list`);
    }
    const metadataKey = `${entry.juryAddress.toLowerCase()}:${entry.projectAddress.toLowerCase()}`;
    if (activeProjectMetadataKeys.has(metadataKey)) {
      errors.push(`Project metadata ${key} ${entry.projectAddress} appears in both active and archived metadata sets`);
    }
    validSubjectKeys.add(projectMetadataSubjectKey(manifest.sourceChainId, entry.juryAddress, entry.projectAddress));
    if (entry.lastKnownCid && !isValidCid(entry.lastKnownCid)) {
      errors.push(`Archived project metadata ${key} ${entry.projectAddress} has invalid last known CID ${entry.lastKnownCid}`);
    }
    for (const revision of entry.history) {
      if (!isValidCid(revision.cid)) errors.push(`Archived project metadata ${key} ${entry.projectAddress} history has invalid CID ${revision.cid}`);
      if (!isValidTxHash(revision.txHash)) errors.push(`Archived project metadata ${key} ${entry.projectAddress} history has invalid tx hash ${revision.txHash}`);
    }
  }

  for (const group of badges) {
    const key = `${group.iterationId}:${group.roundId}`;
    const round = roundMap.get(key);
    if (!round) {
      errors.push(`Badge group ${key} does not match an exported round`);
      continue;
    }
    if (group.total !== group.badges.length) {
      errors.push(`Badge group ${key} total ${group.total} does not match badge count ${group.badges.length}`);
    }
    const roleTotal = Object.values(group.roleCounts).reduce((sum, count) => sum + count, 0);
    if (roleTotal !== group.total) {
      errors.push(`Badge group ${key} role totals ${roleTotal} do not match badge total ${group.total}`);
    }
    const seenTokenIds = new Set<number>();
    for (const badge of group.badges) {
      if (seenTokenIds.has(badge.tokenId)) {
        errors.push(`Badge group ${key} has duplicate token ${badge.tokenId}`);
      }
      seenTokenIds.add(badge.tokenId);
      if (!ethers.isAddress(badge.owner) || normalizeAddress(badge.owner) !== badge.owner) {
        errors.push(`Badge group ${key} token ${badge.tokenId} has invalid owner ${badge.owner}`);
      }
      if (badge.role === 'DevRel') {
        errors.push(`Badge group ${key} token ${badge.tokenId} still uses legacy DevRel role`);
      }
      if (badge.communityVote && !badge.role.includes('Community')) {
        warnings.push(`Badge group ${key} token ${badge.tokenId} has community vote with non-community role ${badge.role}`);
      }
      const subjectKey = badgeSubjectKey(manifest.sourceChainId, group.pobAddress, badge.tokenId);
      badgeSubjectKeys.add(subjectKey);
      validSubjectKeys.add(subjectKey);
    }
    if (group.total !== round.counts.badges) {
      errors.push(`Badge group ${key} total ${group.total} does not match round badge count ${round.counts.badges}`);
    }
  }

  for (const proof of proofs) {
    if (proof.proofChainId !== manifest.sourceChainId) {
      errors.push(`Proof ${proof.txHash} has unexpected chain id ${proof.proofChainId}`);
    }
    if (!isValidTxHash(proof.txHash)) {
      errors.push(`Proof has invalid tx hash ${proof.txHash}`);
    }
    if (!validSubjectKeys.has(proof.subjectKey)) {
      errors.push(`Proof ${proof.txHash} points to missing subject ${proof.subjectKey}`);
    }
  }

  const actualCounts = collectCounts(
    rounds,
    results,
    iterationMetadata,
    projectMetadata,
    removedProjectMetadata,
    badges,
    proofs,
    manifest.counts.rawTransactions,
    manifest.counts.rawReceipts,
    manifest.counts.rawMetadata
  );

  if (JSON.stringify(actualCounts) !== JSON.stringify(manifest.counts)) {
    errors.push('Manifest counts do not match exported data counts');
  }

  for (const [relativePath, expectedHash] of Object.entries(checksums)) {
    const filePath = join(outputDir, relativePath);
    if (!existsSync(filePath)) {
      errors.push(`Missing checksum file ${relativePath}`);
      continue;
    }
    const actualHash = hashFile(filePath);
    if (actualHash !== expectedHash) {
      errors.push(`Checksum mismatch for ${relativePath}`);
    }
  }

  for (const [relativePath, expectedHash] of Object.entries(manifest.contentHashes)) {
    const filePath = join(outputDir, relativePath);
    if (!existsSync(filePath)) {
      errors.push(`Missing manifest file ${relativePath}`);
      continue;
    }
    const actualHash = hashFile(filePath);
    if (actualHash !== expectedHash) {
      errors.push(`Manifest content hash mismatch for ${relativePath}`);
    }
  }

  const referencedMetadataCids = collectReferencedMetadataCids(iterationMetadata, projectMetadata, removedProjectMetadata);
  for (const cid of referencedMetadataCids) {
    const filePath = join(outputDir, 'raw', 'metadata', `${cid}.json`);
    if (!existsSync(filePath)) {
      errors.push(`Missing raw metadata body for referenced CID ${cid}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: actualCounts
  };
}

async function writeRawTransactions(
  provider: ethers.JsonRpcProvider,
  outputDir: string,
  txHashes: string[],
  warnings: string[]
): Promise<{ transactions: number; receipts: number }> {
  const txDir = join(outputDir, 'raw', 'tx');
  const receiptDir = join(outputDir, 'raw', 'receipts');
  ensureDir(txDir);
  ensureDir(receiptDir);

  let transactionCount = 0;
  let receiptCount = 0;
  for (const txHash of [...new Set(txHashes)].sort()) {
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash)
    ]);

    const serializedTx = serializeTransaction(tx);
    if (serializedTx) {
      writeJson(join(txDir, `${txHash}.json`), serializedTx);
      transactionCount++;
    } else {
      warnings.push(`Transaction not available from RPC: ${txHash}`);
    }

    const serializedReceipt = serializeReceipt(receipt);
    if (serializedReceipt) {
      writeJson(join(receiptDir, `${txHash}.json`), serializedReceipt);
      receiptCount++;
    } else {
      warnings.push(`Receipt not available from RPC: ${txHash}`);
    }

    await sleep(100);
  }

  return { transactions: transactionCount, receipts: receiptCount };
}

function writeRawMetadata(outputDir: string, rows: CachedMetadataRow[]): number {
  const metadataDir = join(outputDir, 'raw', 'metadata');
  ensureDir(metadataDir);
  let count = 0;
  for (const row of rows) {
    writeFileSync(join(metadataDir, `${row.cid}.json`), `${row.content.trim()}\n`);
    count++;
  }
  return count;
}

async function main(): Promise<void> {
  const sourceChainId = Number(envString('SOURCE_CHAIN_ID') || '5700');
  const networkConfig = NETWORKS[sourceChainId];
  if (!networkConfig) {
    throw new Error(`Unsupported SOURCE_CHAIN_ID ${sourceChainId}`);
  }

  const sourceRpcUrl = envString('SOURCE_RPC_URL') || networkConfig.rpcUrl;
  const sourceRegistryAddress = normalizeAddress(
    envString('SOURCE_REGISTRY_ADDRESS') || networkConfig.registryAddress
  );
  const defaultDbPath = resolve(apiRoot, 'data', 'index.db');
  const sourceDbPath = envString('SOURCE_DB_PATH') ? resolve(envString('SOURCE_DB_PATH') as string) : defaultDbPath;
  const sourceDbPresent = existsSync(sourceDbPath);
  const batchId = envString('MIGRATION_BATCH_ID') || new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-');
  const outputDir = envString('MIGRATION_OUTPUT_DIR')
    ? resolve(envString('MIGRATION_OUTPUT_DIR') as string)
    : resolve(workspaceRoot, 'migration-artifacts', batchId);

  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    throw new Error(`Output directory already exists and is not empty: ${outputDir}`);
  }

  ensureDir(outputDir);
  ensureDir(join(outputDir, 'raw'));
  ensureDir(join(outputDir, 'raw', 'logs'));

  const provider = new ethers.JsonRpcProvider(sourceRpcUrl, undefined, { batchMaxCount: 1 });
  const registry = new ethers.Contract(sourceRegistryAddress, REGISTRY_ABI, provider);
  const ctx: ExportContext = {
    sourceChainId,
    provider,
    registry,
    warnings: []
  };

  const iterationFilter = parseIterationFilter();
  const roundFilter = parseRoundFilter();

  console.log(`Exporting migration batch ${batchId}`);
  console.log(`Source chain: ${sourceChainId}`);
  console.log(`Source registry: ${sourceRegistryAddress}`);
  console.log(`Output directory: ${outputDir}`);
  if (!sourceDbPresent) {
    console.log(`SQLite DB not found at ${sourceDbPath}; continuing with chain-only export`);
    ctx.warnings.push(`SQLite DB not found at ${sourceDbPath}; metadata history export skipped`);
  }

  const iterationIdsRaw = (await registry.getAllIterationIds()) as bigint[];
  const iterationIds = iterationIdsRaw.map((value) => Number(value)).filter((value) => !iterationFilter || iterationFilter.has(value));

  const rounds: ExportedRound[] = [];
  const results: ExportedResult[] = [];
  const projectMetadata: ProjectMetadataEntry[] = [];
  const removedProjectMetadata: ArchivedProjectMetadataEntry[] = [];
  const badges: BadgeGroup[] = [];
  const proofs: ProofRecord[] = [];

  for (const iterationId of iterationIds) {
    const roundInfos = await registry.getRounds(iterationId);
    for (const roundInfo of roundInfos as Array<{ roundId: bigint; jurySC: string; deployBlockHint: bigint; exists: boolean }>) {
      const roundId = Number(roundInfo.roundId);
      if (!shouldIncludeRound(iterationId, roundId, iterationFilter, roundFilter)) {
        continue;
      }

      const juryAddress = normalizeAddress(roundInfo.jurySC);
      const deployBlockHint = Number(roundInfo.deployBlockHint);
      const [versionIdRaw, adapterConfig] = await Promise.all([
        registry.roundVersion(iterationId, roundId),
        registry.getAdapterConfig(iterationId, roundId)
      ]);
      const versionId = Number(versionIdRaw);
      const adapterAddress = normalizeAddress(adapterConfig[1] as string);

      console.log(`  exporting iteration ${iterationId} round ${roundId} (v${versionId})`);
      const exported = await exportRound(
        ctx,
        iterationId,
        roundId,
        juryAddress,
        deployBlockHint,
        versionId,
        adapterAddress,
        join(outputDir, 'raw', 'logs')
      );

      rounds.push(exported.round);
      results.push(exported.result);
      projectMetadata.push(...exported.projectMetadata);
      badges.push(exported.badges);
      proofs.push(...exported.proofs);

      await sleep(500);
    }
  }

  const iterationMetadata = await buildIterationMetadataEntries(ctx, rounds);

  if (sourceDbPresent) {
    const metadataRows = loadMetadataRows(sourceDbPath, sourceChainId);
    mapMetadataRows(metadataRows, rounds, iterationMetadata, projectMetadata, removedProjectMetadata, proofs, ctx.warnings, sourceChainId);
  }

  const allCids = collectReferencedMetadataCids(iterationMetadata, projectMetadata, removedProjectMetadata);
  const cachedMetadataRows = sourceDbPresent ? loadCachedMetadataRows(sourceDbPath, allCids) : [];
  const cachedCidSet = new Set(cachedMetadataRows.map((row) => row.cid));
  const missingMetadataCids = allCids.filter((cid) => !cachedCidSet.has(cid));

  let fallbackMetadataRows: CachedMetadataRow[] = [];
  if (missingMetadataCids.length > 0) {
    const metadataApiBaseUrl = envString('MIGRATION_METADATA_API_BASE_URL') || DEFAULT_METADATA_API_BASE_URL;
    ctx.warnings.push(`Fetching ${missingMetadataCids.length} missing metadata bodies from ${metadataApiBaseUrl}`);
    fallbackMetadataRows = await fetchMissingMetadataRows(metadataApiBaseUrl, missingMetadataCids, ctx.warnings);
  }

  const mergedMetadataRows = new Map<string, CachedMetadataRow>();
  for (const row of [...cachedMetadataRows, ...fallbackMetadataRows]) {
    if (!mergedMetadataRows.has(row.cid)) {
      mergedMetadataRows.set(row.cid, row);
    }
  }
  writeRawMetadata(outputDir, [...mergedMetadataRows.values()]);

  const uniqueTxHashes = proofs.map((proof) => proof.txHash);
  const rawCounts = await writeRawTransactions(provider, outputDir, uniqueTxHashes, ctx.warnings);

  const rawMetadataDir = join(outputDir, 'raw', 'metadata');
  const rawMetadataCount = existsSync(rawMetadataDir) ? readdirSync(rawMetadataDir).length : 0;

  writeJson(join(outputDir, 'rounds.json'), rounds);
  writeJson(join(outputDir, 'results.json'), results);
  writeJson(join(outputDir, 'iteration-metadata.json'), iterationMetadata);
  writeJson(join(outputDir, 'project-metadata.json'), projectMetadata);
  writeJson(join(outputDir, 'removed-project-metadata.json'), removedProjectMetadata);
  writeJson(join(outputDir, 'badges.json'), badges);
  writeJson(join(outputDir, 'proofs.json'), proofs);

  const manifest: BatchManifest = {
    batchId,
    sourceChainId,
    sourceRpcUrl,
    sourceRegistryAddress,
    sourceDbPath: sourceDbPresent ? sourceDbPath : null,
    sourceDbPresent,
    exportTimestamp: new Date().toISOString(),
    exportToolVersion: TOOL_VERSION,
    artifactFiles: [],
    contentHashes: {},
    counts: collectCounts(
      rounds,
      results,
      iterationMetadata,
      projectMetadata,
      removedProjectMetadata,
      badges,
      proofs,
      rawCounts.transactions,
      rawCounts.receipts,
      rawMetadataCount
    ),
    rounds: badges.map((group) => ({
      iterationId: group.iterationId,
      roundId: group.roundId,
      versionId: rounds.find((round) => round.iterationId === group.iterationId && round.roundId === group.roundId)?.versionId || 0,
      juryAddress: group.juryAddress,
      pobAddress: group.pobAddress,
      badgeTotals: {
        total: group.total,
        byRole: group.roleCounts
      }
    })),
    warnings: ctx.warnings
  };

  const hashedFiles = listFilesRecursively(outputDir).filter(
    (filePath) => filePath !== 'manifest.json' && filePath !== 'checksums.json' && filePath !== 'validation-report.json'
  );
  const contentHashes: Record<string, string> = {};
  for (const relativePath of hashedFiles) {
    contentHashes[relativePath] = hashFile(join(outputDir, relativePath));
  }

  manifest.artifactFiles = hashedFiles;
  manifest.contentHashes = contentHashes;
  writeJson(join(outputDir, 'manifest.json'), manifest);

  const checksums = {
    ...contentHashes,
    'manifest.json': hashFile(join(outputDir, 'manifest.json'))
  };
  writeJson(join(outputDir, 'checksums.json'), checksums);

  const report = validateBatch(
    manifest,
    checksums,
    rounds,
    results,
    iterationMetadata,
    projectMetadata,
    removedProjectMetadata,
    badges,
    proofs,
    outputDir
  );
  writeJson(join(outputDir, 'validation-report.json'), report);

  console.log(`Export complete: ${outputDir}`);
  console.log(`Validation: ${report.ok ? 'OK' : 'FAILED'}`);
  if (report.warnings.length > 0) {
    console.log(`Warnings: ${report.warnings.length}`);
  }
  if (report.errors.length > 0) {
    console.log(`Errors: ${report.errors.length}`);
    for (const error of report.errors.slice(0, 10)) {
      console.log(`  - ${error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
