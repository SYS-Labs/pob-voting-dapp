/**
 * Public-facing HTTP API server
 * Provides:
 * - Thread listing + detail from the indexed posts
 * - Admin endpoints for thread management
 * - Contract deployment endpoint with admin signature validation
 */

import http, { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { ethers, Contract, Interface, JsonRpcProvider } from 'ethers';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createPostDatabase } from '../db/queries.js';
import { createDeploymentDatabase } from '../db/deployments.js';
import { createMonitoredThreadsDatabase } from '../db/monitored-threads.js';
import { createMetadataDatabase } from '../db/metadata.js';
import { createIterationsDatabase } from '../db/iterations.js';
import { createCertsDatabase } from '../db/certs.js';
import { createProfilesDatabase } from '../db/profiles.js';
import { createTeamMembersDatabase } from '../db/teamMembers.js';
import { createEligibilityDatabase } from '../db/eligibility.js';
import { createTemplatesDatabase } from '../db/templates.js';
import { sanitizeSVG } from '../services/svg-sanitizer.js';
import { IPFSService } from '../services/ipfs.js';
import { MetadataService } from '../services/metadata.js';
import { logger } from '../utils/logger.js';
import { NETWORKS } from '../constants/networks.js';
import { PostRecord } from '../types/post.js';

const PORT = parseInt(process.env.API_PORT || process.env.DASHBOARD_PORT || '4000', 10);

const db = initDatabase(config.database.path);
const postDb = createPostDatabase(db);
const deploymentDb = createDeploymentDatabase(db);
const threadsDb = createMonitoredThreadsDatabase(db);
const metadataDb = createMetadataDatabase(db);
const iterationsDb = createIterationsDatabase(db);
const certsDb = createCertsDatabase(db);
const profilesDb = createProfilesDatabase(db);
const teamMembersDb = createTeamMembersDatabase(db);
const eligibilityDb = createEligibilityDatabase(db);
const templatesDb = createTemplatesDatabase(db);

// Initialize IPFS and metadata services
const ipfsService = new IPFSService();
const metadataService = new MetadataService(ipfsService);

const POB_BADGE_DISCOVERY_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function roleOf(uint256 tokenId) view returns (string)',
  'function claimed(uint256 tokenId) view returns (bool)',
];

const POB_MINT_STATUS_ABI = [
  'function hasMintedBadge(address account) view returns (bool)',
];

const POB_V1_MINT_STATUS_ABI = [
  'function hasMinted(address account) view returns (bool)',
];

interface UserRoundBadgeRecord {
  tokenId: string;
  role: string;
  claimed: boolean;
}

interface UserRoundBadgeStatus {
  round: number;
  pobAddress: string;
  juryAddress: string;
  hasMinted: boolean | null;
  badges: UserRoundBadgeRecord[];
  error?: string;
}

interface UserIterationBadgeStatusResponse {
  chainId: number;
  iterationId: number;
  address: string;
  rounds: Record<string, UserRoundBadgeStatus>;
}

const apiProviders = new Map<number, JsonRpcProvider>();
const userIterationBadgeStatusCache = new Map<string, { expiresAt: number; payload: UserIterationBadgeStatusResponse }>();
const USER_BADGE_STATUS_TTL_MS = 15_000;

function getApiProvider(chainId: number): JsonRpcProvider | null {
  const existing = apiProviders.get(chainId);
  if (existing) return existing;

  const cfg = NETWORKS[chainId];
  if (!cfg?.rpcUrl) return null;

  const provider = new JsonRpcProvider(cfg.rpcUrl);
  apiProviders.set(chainId, provider);
  return provider;
}

function getCachedUserIterationBadgeStatus(cacheKey: string): UserIterationBadgeStatusResponse | null {
  const cached = userIterationBadgeStatusCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    userIterationBadgeStatusCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedUserIterationBadgeStatus(cacheKey: string, payload: UserIterationBadgeStatusResponse): void {
  userIterationBadgeStatusCache.set(cacheKey, {
    expiresAt: Date.now() + USER_BADGE_STATUS_TTL_MS,
    payload,
  });
}

async function readPobHasMinted(pobAddress: string, account: string, provider: JsonRpcProvider): Promise<boolean | null> {
  try {
    const contract = new Contract(pobAddress, POB_MINT_STATUS_ABI, provider);
    return Boolean(await contract.hasMintedBadge(account));
  } catch {
    // v1 fallback
  }

  try {
    const contract = new Contract(pobAddress, POB_V1_MINT_STATUS_ABI, provider);
    return Boolean(await contract.hasMinted(account));
  } catch {
    return null;
  }
}

async function readUserOwnedPobBadges(
  pobAddress: string,
  account: string,
  provider: JsonRpcProvider,
  deployBlockHint?: number | null,
): Promise<UserRoundBadgeRecord[]> {
  const iface = new Interface(POB_BADGE_DISCOVERY_ABI);
  const transferTopic = iface.getEvent('Transfer')?.topicHash;
  if (!transferTopic) return [];

  const pob = new Contract(pobAddress, POB_BADGE_DISCOVERY_ABI, provider);
  const fromBlock = deployBlockHint !== undefined && deployBlockHint !== null ? deployBlockHint : 0;

  const logs = await provider.getLogs({
    address: pobAddress,
    fromBlock,
    toBlock: 'latest',
    topics: [transferTopic, null, ethers.zeroPadValue(account, 32)],
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
    } catch {
      // Ignore malformed/unknown logs
    }
  }

  if (tokenIds.length === 0) return [];

  const uniqueTokenIds = Array.from(new Set(tokenIds));
  const calls = uniqueTokenIds.flatMap((tokenId) => ([
    pob.ownerOf(tokenId),
    pob.roleOf(tokenId),
    pob.claimed(tokenId).catch(() => false),
  ]));

  const results = await Promise.allSettled(calls);
  const badges: UserRoundBadgeRecord[] = [];
  const normalized = account.toLowerCase();

  for (let i = 0; i < uniqueTokenIds.length; i++) {
    const ownerRes = results[i * 3];
    const roleRes = results[i * 3 + 1];
    const claimedRes = results[i * 3 + 2];

    if (ownerRes.status !== 'fulfilled' || typeof ownerRes.value !== 'string') continue;
    if (ownerRes.value.toLowerCase() !== normalized) continue;
    if (roleRes.status !== 'fulfilled') continue;

    badges.push({
      tokenId: uniqueTokenIds[i],
      role: String(roleRes.value).toLowerCase(),
      claimed: claimedRes.status === 'fulfilled' ? Boolean(claimedRes.value) : false,
    });
  }

  return badges;
}

async function buildUserIterationBadgeStatus(
  chainId: number,
  iterationId: number,
  address: string,
): Promise<UserIterationBadgeStatusResponse | null> {
  const snapshot = iterationsDb.getSnapshot(chainId, iterationId);
  if (!snapshot) return null;

  const provider = getApiProvider(chainId);
  if (!provider) {
    throw new Error(`Unsupported chain ${chainId}`);
  }

  const rounds = iterationsDb.getAllRounds(chainId, iterationId)
    .filter((row) => row.round > 0 && row.pob_address && row.pob_address !== ethers.ZeroAddress);

  const roundStatuses = await Promise.all(rounds.map(async (row): Promise<[string, UserRoundBadgeStatus]> => {
    const key = String(row.round);
    try {
      const hasMinted = await readPobHasMinted(row.pob_address, address, provider);
      const badges = hasMinted === false
        ? []
        : await readUserOwnedPobBadges(row.pob_address, address, provider, row.deploy_block_hint);

      return [key, {
        round: row.round,
        pobAddress: row.pob_address,
        juryAddress: row.jury_address,
        hasMinted,
        badges,
      }];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [key, {
        round: row.round,
        pobAddress: row.pob_address,
        juryAddress: row.jury_address,
        hasMinted: null,
        badges: [],
        error: message,
      }];
    }
  }));

  return {
    chainId,
    iterationId,
    address,
    rounds: Object.fromEntries(roundStatuses),
  };
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

const routes: Record<string, Handler> = {
  'GET:/health': async (_req, res) => {
    sendJson(res, 200, { status: 'ok' });
  },

  'GET:/api/threads': async (_req, res) => {
    const threads = postDb.getRootPosts(100).map(serializePost);
    sendJson(res, 200, { threads });
  },

  'GET:/api/deployments': async (_req, res) => {
    const deployments = deploymentDb.listDeployments();
    sendJson(res, 200, { deployments });
  },

  'GET:/api/admin/threads': async (_req, res) => {
    const threads = threadsDb.listThreads();
    sendJson(res, 200, { threads });
  },

  'GET:/api/admin/threads/stats': async (_req, res) => {
    const stats = threadsDb.getStats();
    sendJson(res, 200, { stats });
  },

  'GET:/api/iterations': async (_req, res) => {
    const iterations = iterationsDb.getAllSnapshotsAPI();

    // Include per-chain CertNFT addresses so the frontend can discover them
    const certNFTAddresses: Record<number, string> = {};
    for (const [chainId, cfg] of Object.entries(NETWORKS)) {
      if (cfg.certNFTAddress) {
        certNFTAddresses[Number(chainId)] = cfg.certNFTAddress;
      }
    }

    sendJson(res, 200, { iterations, certNFTAddresses });
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/threads/')) {
    await handleThreadDetail(req, res, url);
    return;
  }

  // Iteration endpoints (dynamic routes)
  if (req.method === 'GET' && url.pathname.match(/^\/api\/iterations\/\d+\/\d+\/badges\/0x[a-fA-F0-9]{40}$/)) {
    await handleGetIterationUserBadges(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/iterations\/\d+\/\d+$/)) {
    await handleGetIteration(req, res, url);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/deployments') {
    await handleDeployment(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/threads') {
    await handleRegisterThread(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/admin/threads/') && url.pathname.endsWith('/deploy')) {
    await handleDeployContract(req, res, url);
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/threads/')) {
    await handleUpdateThread(req, res, url);
    return;
  }

  // Cert endpoints
  if (req.method === 'GET' && url.pathname.match(/^\/api\/certs\/\d+\/pending$/)) {
    await handleGetPendingCerts(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/certs\/\d+\/iteration\/\d+$/)) {
    await handleGetCertsForIteration(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/certs\/\d+\/0x[a-fA-F0-9]{40}$/)) {
    await handleGetCertsForAccount(req, res, url);
    return;
  }

  // Team member endpoints
  if (req.method === 'GET' && url.pathname.match(/^\/api\/team-members\/\d+\/\d+\/0x[a-fA-F0-9]{40}$/)) {
    await handleGetTeamMembersForProject(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/team-members\/\d+\/member\/0x[a-fA-F0-9]{40}$/)) {
    await handleGetTeamMembersForMember(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/team-members\/\d+\/pending$/)) {
    await handleGetPendingTeamMembers(req, res, url);
    return;
  }

  // Eligibility endpoint
  if (req.method === 'GET' && url.pathname.match(/^\/api\/certs\/\d+\/eligible\/0x[a-fA-F0-9]{40}$/)) {
    await handleGetEligibility(req, res, url);
    return;
  }

  // Profile endpoints
  if (req.method === 'GET' && url.pathname.match(/^\/api\/profile\/\d+\/0x[a-fA-F0-9]{40}$/)) {
    await handleGetProfile(req, res, url);
    return;
  }

  // SVG template endpoints
  if (req.method === 'POST' && url.pathname === '/api/templates/sanitize') {
    await handleSanitizeTemplate(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/templates/publish') {
    await handlePublishTemplate(req, res);
    return;
  }

  // Metadata endpoints
  if (req.method === 'GET' && url.pathname.startsWith('/api/metadata/project/')) {
    await handleGetProjectMetadata(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/metadata/iteration/')) {
    await handleGetIterationMetadata(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/metadata/cid/')) {
    await handleGetCIDMetadata(req, res, url);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/metadata/batch') {
    await handleBatchGetMetadata(req, res);
    return;
  }

  // Role-gated metadata endpoints
  if (req.method === 'POST' && url.pathname === '/api/metadata/preview') {
    await handlePreviewCID(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/metadata/submit') {
    await handleSubmitMetadata(req, res);
    return;
  }

  const key = `${req.method}:${url.pathname}`;
  const handler = routes[key];

  if (!handler) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  try {
    await handler(req, res, url);
  } catch (error) {
    logger.error('Request handling failed', error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  logger.info('Dashboard API listening', { port: PORT });
});

process.on('SIGINT', () => {
  logger.info('Shutting down dashboard API');
  db.close();
  server.close(() => process.exit(0));
});

// ========== Route Handlers ==========

async function handleThreadDetail(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const conversationId = url.pathname.replace('/api/threads/', '');
  if (!conversationId) {
    sendJson(res, 400, { error: 'Missing conversation ID' });
    return;
  }

  const posts = postDb.getThread(conversationId).map(serializePost);
  sendJson(res, 200, { conversationId, posts });
}

async function handleGetIteration(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // Parse URL: /api/iterations/:chainId/:iterationId
  const parts = url.pathname.replace('/api/iterations/', '').split('/');

  if (parts.length !== 2) {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/iterations/:chainId/:iterationId' });
    return;
  }

  const [chainIdStr, iterationIdStr] = parts;
  const chainId = parseInt(chainIdStr, 10);
  const iterationId = parseInt(iterationIdStr, 10);

  if (isNaN(chainId) || isNaN(iterationId)) {
    sendJson(res, 400, { error: 'Invalid chainId or iterationId format' });
    return;
  }

  const iteration = iterationsDb.getSnapshotAPI(chainId, iterationId);

  if (!iteration) {
    sendJson(res, 404, { error: 'Iteration not found' });
    return;
  }

  sendJson(res, 200, { iteration });
}

async function handleGetIterationUserBadges(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // /api/iterations/:chainId/:iterationId/badges/:address
  const parts = url.pathname.replace('/api/iterations/', '').split('/');
  if (parts.length !== 4 || parts[2] !== 'badges') {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/iterations/:chainId/:iterationId/badges/:address' });
    return;
  }

  const chainId = parseInt(parts[0], 10);
  const iterationId = parseInt(parts[1], 10);
  const address = parts[3];

  if (isNaN(chainId) || isNaN(iterationId)) {
    sendJson(res, 400, { error: 'Invalid chainId or iterationId format' });
    return;
  }

  if (!ethers.isAddress(address)) {
    sendJson(res, 400, { error: 'Invalid address format' });
    return;
  }

  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${chainId}:${iterationId}:${normalizedAddress}`;
  const cached = getCachedUserIterationBadgeStatus(cacheKey);
  if (cached) {
    sendJson(res, 200, { badgeStatus: cached, cached: true });
    return;
  }

  try {
    const badgeStatus = await buildUserIterationBadgeStatus(chainId, iterationId, normalizedAddress);
    if (!badgeStatus) {
      sendJson(res, 404, { error: 'Iteration not found' });
      return;
    }
    setCachedUserIterationBadgeStatus(cacheKey, badgeStatus);
    sendJson(res, 200, { badgeStatus, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user badge status';
    sendJson(res, 500, { error: message });
  }
}

async function handleDeployment(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req) as { message?: string; signature?: string };
    const message = String(body?.message || '');
    const signature = String(body?.signature || '');

    if (!message || !signature) {
      sendJson(res, 400, { error: 'message and signature are required' });
      return;
    }

    const isAdmin = validateAdminSignature(message, signature);
    if (!isAdmin) {
      sendJson(res, 401, { error: 'Invalid admin signature' });
      return;
    }

    const deployment = deploymentDb.createDeployment({
      createdBy: config.auth.adminAddress,
      signature,
      message
    });

    sendJson(res, 201, { deployment });
  } catch (error) {
    logger.error('Deployment request failed', error);
    sendJson(res, 500, { error: 'Failed to process deployment' });
  }
}

async function handleRegisterThread(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req) as { postId?: string; message?: string; signature?: string };
    const postId = String(body?.postId || '').trim();
    const message = String(body?.message || '');
    const signature = String(body?.signature || '');

    if (!postId) {
      sendJson(res, 400, { error: 'postId is required' });
      return;
    }

    if (!message || !signature) {
      sendJson(res, 400, { error: 'message and signature are required' });
      return;
    }

    const isAdmin = validateAdminSignature(message, signature);
    if (!isAdmin) {
      sendJson(res, 401, { error: 'Invalid admin signature' });
      return;
    }

    // Validate post ID format (Twitter snowflake IDs are numeric strings)
    if (!/^\d+$/.test(postId)) {
      sendJson(res, 400, { error: 'Invalid post ID format' });
      return;
    }

    const thread = threadsDb.registerThread({
      postId,
      registeredBy: config.auth.adminAddress,
      signature,
      message
    });

    sendJson(res, 201, { thread });
  } catch (error) {
    if (error instanceof Error && error.message.includes('already registered')) {
      sendJson(res, 409, { error: error.message });
    } else {
      logger.error('Thread registration failed', error);
      sendJson(res, 500, { error: 'Failed to register thread' });
    }
  }
}

async function handleDeployContract(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  try {
    const postId = url.pathname.replace('/api/admin/threads/', '').replace('/deploy', '');
    if (!postId) {
      sendJson(res, 400, { error: 'Missing post ID' });
      return;
    }

    const body = await readJsonBody(req) as { message?: string; signature?: string };
    const message = String(body?.message || '');
    const signature = String(body?.signature || '');

    if (!message || !signature) {
      sendJson(res, 400, { error: 'message and signature are required' });
      return;
    }

    const isAdmin = validateAdminSignature(message, signature);
    if (!isAdmin) {
      sendJson(res, 401, { error: 'Invalid admin signature' });
      return;
    }

    // Check if thread exists
    const thread = threadsDb.getThread(postId);
    if (!thread) {
      sendJson(res, 404, { error: 'Thread not found. Register it first.' });
      return;
    }

    // Check if already has contract
    if (thread.contract_address) {
      sendJson(res, 409, {
        error: `Thread already has contract ${thread.contract_address}. Cannot deploy duplicate.`
      });
      return;
    }

    // Create deployment (mock contract)
    const deployment = deploymentDb.createDeployment({
      createdBy: config.auth.adminAddress,
      signature,
      message
    });

    // Assign contract to thread
    threadsDb.assignContract(postId, deployment.contract_address);

    sendJson(res, 201, {
      deployment,
      thread: threadsDb.getThread(postId)
    });
  } catch (error) {
    logger.error('Contract deployment failed', error);
    sendJson(res, 500, { error: 'Failed to deploy contract' });
  }
}

async function handleUpdateThread(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  try {
    const postId = url.pathname.replace('/api/admin/threads/', '');
    if (!postId) {
      sendJson(res, 400, { error: 'Missing post ID' });
      return;
    }

    const body = await readJsonBody(req) as {
      status?: string;
      message?: string;
      signature?: string;
    };
    const status = body?.status as 'active' | 'paused' | 'archived' | undefined;
    const message = String(body?.message || '');
    const signature = String(body?.signature || '');

    if (!status) {
      sendJson(res, 400, { error: 'status is required' });
      return;
    }

    if (!['active', 'paused', 'archived'].includes(status)) {
      sendJson(res, 400, { error: 'Invalid status. Must be: active, paused, or archived' });
      return;
    }

    if (!message || !signature) {
      sendJson(res, 400, { error: 'message and signature are required' });
      return;
    }

    const isAdmin = validateAdminSignature(message, signature);
    if (!isAdmin) {
      sendJson(res, 401, { error: 'Invalid admin signature' });
      return;
    }

    threadsDb.updateStatus(postId, status);

    sendJson(res, 200, {
      thread: threadsDb.getThread(postId)
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      sendJson(res, 404, { error: error.message });
    } else {
      logger.error('Thread update failed', error);
      sendJson(res, 500, { error: 'Failed to update thread' });
    }
  }
}

async function handleGetProjectMetadata(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  try {
    // Parse URL: /api/metadata/project/:chainId/:contractAddress/:projectAddress
    const parts = url.pathname.replace('/api/metadata/project/', '').split('/');

    if (parts.length !== 3) {
      sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/metadata/project/:chainId/:contractAddress/:projectAddress' });
      return;
    }

    const [chainIdStr, contractAddress, projectAddress] = parts;
    const chainId = parseInt(chainIdStr, 10);

    if (isNaN(chainId)) {
      sendJson(res, 400, { error: 'Invalid chainId format' });
      return;
    }

    if (!ethers.isAddress(contractAddress) || !ethers.isAddress(projectAddress)) {
      sendJson(res, 400, { error: 'Invalid address format' });
      return;
    }

    const metadata = await metadataService.getProjectMetadata(chainId, contractAddress, projectAddress);
    const cid = await metadataService.getProjectMetadataCID(chainId, contractAddress, projectAddress);
    const update = cid
      ? metadataDb.getLatestProjectUpdateForCID(chainId, contractAddress, projectAddress, cid)
      : null;
    const txHash = update?.tx_hash || null;

    sendJson(res, 200, {
      success: true,
      metadata: metadata ? { ...metadata, txHash } : null,
      cid
    });
  } catch (error) {
    logger.error('Failed to get project metadata', error);
    sendJson(res, 500, { success: false, error: 'Failed to fetch metadata' });
  }
}

async function handleGetIterationMetadata(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  try {
    // Parse URL: /api/metadata/iteration/:chainId/:contractAddress
    const parts = url.pathname.replace('/api/metadata/iteration/', '').split('/');

    if (parts.length !== 2) {
      sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/metadata/iteration/:chainId/:contractAddress' });
      return;
    }

    const [chainIdStr, contractAddress] = parts;
    const chainId = parseInt(chainIdStr, 10);

    if (isNaN(chainId)) {
      sendJson(res, 400, { error: 'Invalid chainId format' });
      return;
    }

    if (!ethers.isAddress(contractAddress)) {
      sendJson(res, 400, { error: 'Invalid contract address format' });
      return;
    }

    const metadata = await metadataService.getIterationMetadata(chainId, contractAddress);
    const cid = await metadataService.getIterationMetadataCID(chainId, contractAddress);
    const update = cid
      ? metadataDb.getLatestIterationUpdateForCID(chainId, contractAddress, cid)
      : null;
    const txHash = update?.tx_hash || null;

    sendJson(res, 200, {
      success: true,
      metadata: metadata ? { ...metadata, txHash } : null,
      cid
    });
  } catch (error) {
    logger.error('Failed to get iteration metadata', error);
    sendJson(res, 500, { success: false, error: 'Failed to fetch metadata' });
  }
}

async function handleGetCIDMetadata(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  try {
    const cid = url.pathname.replace('/api/metadata/cid/', '');

    if (!cid || cid.length === 0 || cid.length > 100) {
      sendJson(res, 400, { error: 'Invalid CID format' });
      return;
    }

    const cachedItem = metadataDb.getCachedIPFSContent(cid);
    if (cachedItem) {
      try {
        const parsed = JSON.parse(cachedItem.content);
        sendJson(res, 200, {
          success: true,
          cid,
          metadata: parsed
        });
        return;
      } catch (error) {
        logger.warn('Failed to parse cached content', { cid, error });
      }
    }

    const metadata = await ipfsService.fetchJSON(cid);
    metadataDb.cacheIPFSContent(cid, JSON.stringify(metadata));

    sendJson(res, 200, {
      success: true,
      cid,
      metadata
    });
  } catch (error) {
    logger.error('Failed to fetch CID metadata', { error });
    sendJson(res, 404, { success: false, error: 'CID not found' });
  }
}

async function handleBatchGetMetadata(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await readJsonBody(req) as {
      cids?: string[];
    };

    if (!body.cids || !Array.isArray(body.cids)) {
      sendJson(res, 400, { error: 'Request must include cids array' });
      return;
    }

    if (body.cids.length === 0) {
      sendJson(res, 200, { success: true, metadata: {} });
      return;
    }

    if (body.cids.length > 50) {
      sendJson(res, 400, { error: 'Maximum 50 CIDs per request' });
      return;
    }

    // Validate CIDs (basic validation)
    for (const cid of body.cids) {
      if (typeof cid !== 'string' || cid.length === 0 || cid.length > 100) {
        sendJson(res, 400, { error: `Invalid CID format: ${cid}` });
        return;
      }
    }

    // Check cache first
    const cached = metadataDb.getBatchCachedIPFSContent(body.cids);
    const result: Record<string, any> = {};
    const toFetch: string[] = [];

    for (const cid of body.cids) {
      const cachedItem = cached.get(cid);
      if (cachedItem) {
        try {
          result[cid] = JSON.parse(cachedItem.content);
        } catch (error) {
          logger.warn('Failed to parse cached content', { cid, error });
          toFetch.push(cid);
        }
      } else {
        toFetch.push(cid);
      }
    }

    // Fetch missing CIDs from IPFS
    if (toFetch.length > 0) {
      const fetchResults = await Promise.allSettled(
        toFetch.map(async (cid) => {
          const data = await ipfsService.fetchJSON(cid);
          // Cache the fetched content
          metadataDb.cacheIPFSContent(cid, JSON.stringify(data));
          return { cid, data };
        })
      );

      for (const fetchResult of fetchResults) {
        if (fetchResult.status === 'fulfilled') {
          result[fetchResult.value.cid] = fetchResult.value.data;
        } else {
          logger.warn('Failed to fetch CID', { error: fetchResult.reason });
          // Don't include in result - empty means not found
        }
      }
    }

    sendJson(res, 200, {
      success: true,
      metadata: result
    });
  } catch (error) {
    logger.error('Failed to batch fetch metadata', error);
    sendJson(res, 500, { success: false, error: 'Failed to fetch metadata' });
  }
}

// ========== Cert & Profile Handlers ==========

async function handleGetCertsForAccount(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const parts = url.pathname.replace('/api/certs/', '').split('/');
  if (parts.length !== 2) {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/certs/:chainId/:address' });
    return;
  }

  const chainId = parseInt(parts[0], 10);
  const address = parts[1];

  if (isNaN(chainId)) {
    sendJson(res, 400, { error: 'Invalid chainId format' });
    return;
  }

  if (!ethers.isAddress(address)) {
    sendJson(res, 400, { error: 'Invalid address format' });
    return;
  }

  const rows = certsDb.getCertsForAccount(chainId, address);
  const certs = rows.map((row) => certsDb.toAPI(row));

  sendJson(res, 200, { certs });
}

async function handleGetCertsForIteration(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // Parse URL: /api/certs/:chainId/iteration/:iterationId
  const parts = url.pathname.replace('/api/certs/', '').split('/');
  if (parts.length !== 3 || parts[1] !== 'iteration') {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/certs/:chainId/iteration/:iterationId' });
    return;
  }

  const chainId = parseInt(parts[0], 10);
  const iterationId = parseInt(parts[2], 10);

  if (isNaN(chainId) || isNaN(iterationId)) {
    sendJson(res, 400, { error: 'Invalid chainId or iterationId format' });
    return;
  }

  const rows = certsDb.getCertsForIteration(chainId, iterationId);
  // Only return minted certs for public iteration view
  const mintedRows = rows.filter((r) => r.status === 'minted');
  const certs = mintedRows.map((row) => certsDb.toAPI(row));

  sendJson(res, 200, { certs });
}

async function handleGetPendingCerts(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const parts = url.pathname.replace('/api/certs/', '').split('/');
  if (parts.length !== 2 || parts[1] !== 'pending') {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/certs/:chainId/pending' });
    return;
  }

  const chainId = parseInt(parts[0], 10);

  if (isNaN(chainId)) {
    sendJson(res, 400, { error: 'Invalid chainId format' });
    return;
  }

  const rows = certsDb.getNonFinalCerts(chainId);
  const certs = rows.map((row) => certsDb.toAPI(row));

  sendJson(res, 200, { certs });
}

// ========== Team Member Handlers ==========

async function handleGetTeamMembersForProject(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // Parse URL: /api/team-members/:chainId/:iteration/:projectAddress
  const parts = url.pathname.replace('/api/team-members/', '').split('/');
  if (parts.length !== 3) {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/team-members/:chainId/:iteration/:projectAddress' });
    return;
  }

  const chainId = parseInt(parts[0], 10);
  const iteration = parseInt(parts[1], 10);
  const projectAddress = parts[2];

  if (isNaN(chainId) || isNaN(iteration)) {
    sendJson(res, 400, { error: 'Invalid chainId or iteration format' });
    return;
  }

  if (!ethers.isAddress(projectAddress)) {
    sendJson(res, 400, { error: 'Invalid address format' });
    return;
  }

  const rows = teamMembersDb.getTeamMembersForProject(chainId, iteration, projectAddress);
  const members = rows.map((row) => teamMembersDb.toAPI(row));

  sendJson(res, 200, { members });
}

async function handleGetTeamMembersForMember(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // Parse URL: /api/team-members/:chainId/member/:memberAddress
  const parts = url.pathname.replace('/api/team-members/', '').split('/');
  if (parts.length !== 3 || parts[1] !== 'member') {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/team-members/:chainId/member/:memberAddress' });
    return;
  }

  const chainId = parseInt(parts[0], 10);
  const memberAddress = parts[2];

  if (isNaN(chainId)) {
    sendJson(res, 400, { error: 'Invalid chainId format' });
    return;
  }

  if (!ethers.isAddress(memberAddress)) {
    sendJson(res, 400, { error: 'Invalid address format' });
    return;
  }

  const rows = teamMembersDb.getTeamMembersForMember(chainId, memberAddress);
  const memberships = rows.map((row) => teamMembersDb.toAPI(row));

  sendJson(res, 200, { memberships });
}

async function handleGetPendingTeamMembers(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // Parse URL: /api/team-members/:chainId/pending
  const parts = url.pathname.replace('/api/team-members/', '').split('/');
  if (parts.length !== 2 || parts[1] !== 'pending') {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/team-members/:chainId/pending' });
    return;
  }

  const chainId = parseInt(parts[0], 10);

  if (isNaN(chainId)) {
    sendJson(res, 400, { error: 'Invalid chainId format' });
    return;
  }

  const rows = teamMembersDb.getPendingMembers(chainId);
  const members = rows.map((row) => teamMembersDb.toAPI(row));

  sendJson(res, 200, { members });
}

async function handleGetEligibility(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // Parse URL: /api/certs/:chainId/eligible/:address
  const parts = url.pathname.replace('/api/certs/', '').split('/');
  if (parts.length !== 3 || parts[1] !== 'eligible') {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/certs/:chainId/eligible/:address' });
    return;
  }

  const chainId = parseInt(parts[0], 10);
  const address = parts[2];

  if (isNaN(chainId)) {
    sendJson(res, 400, { error: 'Invalid chainId format' });
    return;
  }

  if (!ethers.isAddress(address)) {
    sendJson(res, 400, { error: 'Invalid address format' });
    return;
  }

  const rows = eligibilityDb.getEligibleForAccount(chainId, address);

  // Exclude iterations where account has a non-cancelled cert
  // (cancelled certs allow re-entry so users can navigate to the resubmit UI)
  const existingCerts = certsDb.getCertsForAccount(chainId, address);
  const certIterations = new Set(
    existingCerts.filter((c) => c.status !== 'cancelled').map((c) => c.iteration)
  );

  const eligibility = rows
    .filter((row) => !certIterations.has(row.iteration))
    .map((row) => eligibilityDb.toAPI(row));

  sendJson(res, 200, { eligibility });
}

async function handleGetProfile(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // Parse URL: /api/profile/:chainId/:address
  const parts = url.pathname.replace('/api/profile/', '').split('/');
  if (parts.length !== 2) {
    sendJson(res, 400, { error: 'Invalid URL format. Expected: /api/profile/:chainId/:address' });
    return;
  }

  const chainId = parseInt(parts[0], 10);
  const address = parts[1];

  if (isNaN(chainId)) {
    sendJson(res, 400, { error: 'Invalid chainId format' });
    return;
  }

  if (!ethers.isAddress(address)) {
    sendJson(res, 400, { error: 'Invalid address format' });
    return;
  }

  const row = profilesDb.getProfile(chainId, address);

  if (!row) {
    sendJson(res, 200, { profile: null });
    return;
  }

  const profile = profilesDb.toAPI(row);

  // Inline IPFS metadata from cache
  let pictureMetadata: Record<string, unknown> | null = null;
  let bioMetadata: Record<string, unknown> | null = null;

  if (row.picture_cid) {
    const cached = metadataDb.getCachedIPFSContent(row.picture_cid);
    if (cached) {
      try { pictureMetadata = JSON.parse(cached.content); } catch { /* ignore */ }
    }
  }

  if (row.bio_cid) {
    const cached = metadataDb.getCachedIPFSContent(row.bio_cid);
    if (cached) {
      try { bioMetadata = JSON.parse(cached.content); } catch { /* ignore */ }
    }
  }

  // Get cert count and iteration participation count
  const userCerts = certsDb.getCertsForAccount(chainId, address);
  const iterationSet = new Set(userCerts.map((c) => c.iteration));

  sendJson(res, 200, {
    profile: {
      ...profile,
      pictureMetadata,
      bioMetadata,
      certCount: userCerts.filter((c) => c.status !== 'cancelled').length,
      iterationCount: iterationSet.size,
    },
  });
}

// ============================================================================
// SVG Template Endpoints
// ============================================================================

/**
 * POST /api/templates/sanitize
 * Body: { svg: string }
 * Returns sanitized SVG + keccak256 hash + validation report. No IPFS write.
 */
async function handleSanitizeTemplate(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await readJsonBody(req) as { svg?: string };
    const rawSvg = body?.svg;

    if (typeof rawSvg !== 'string' || rawSvg.length === 0) {
      sendJson(res, 400, { error: 'Missing required field: svg (string)' });
      return;
    }

    const result = sanitizeSVG(rawSvg);

    sendJson(res, 200, {
      valid: result.valid,
      sanitizedSvg: result.sanitizedSvg,
      hash: result.hash,
      issues: result.issues,
      errors: result.errors,
    });
  } catch (error) {
    logger.error('Template sanitize failed', error);
    sendJson(res, 500, { error: 'Failed to sanitize template' });
  }
}

/**
 * POST /api/templates/publish
 * Body: { svg: string, message: string, signature: string }
 * Admin-only. Re-sanitizes internally (never trusts prior preview).
 * Idempotent by sanitized-hash: reuses existing CID when possible.
 * Returns: { cid, hash, new: boolean }
 */
async function handlePublishTemplate(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await readJsonBody(req) as {
      svg?: string;
      message?: string;
      signature?: string;
    };

    const rawSvg = body?.svg;
    const message = String(body?.message || '');
    const signature = String(body?.signature || '');

    if (typeof rawSvg !== 'string' || rawSvg.length === 0) {
      sendJson(res, 400, { error: 'Missing required field: svg (string)' });
      return;
    }

    if (!message || !signature) {
      sendJson(res, 400, { error: 'message and signature are required' });
      return;
    }

    const isAdmin = validateAdminSignature(message, signature);
    if (!isAdmin) {
      sendJson(res, 401, { error: 'Invalid admin signature' });
      return;
    }

    // Always re-sanitize; never trust a caller-provided hash or CID
    const result = sanitizeSVG(rawSvg);

    if (!result.valid) {
      sendJson(res, 422, {
        error: 'SVG failed validation',
        errors: result.errors,
        issues: result.issues,
      });
      return;
    }

    // Idempotency: reuse CID if this exact sanitized content was published before
    const existing = templatesDb.getByCID(result.hash);
    if (existing) {
      logger.info('Template publish: reusing existing CID', { hash: result.hash, cid: existing });
      sendJson(res, 200, {
        cid: existing,
        hash: result.hash,
        new: false,
      });
      return;
    }

    // Upload sanitized bytes to IPFS
    const sanitizedBytes = Buffer.from(result.sanitizedSvg, 'utf8');
    const cid = await ipfsService.uploadBytes(sanitizedBytes, 'cert-template.svg');

    // Persist for future idempotency checks
    templatesDb.insert(result.hash, cid);

    logger.info('Template publish: new CID pinned', { hash: result.hash, cid });

    sendJson(res, 201, {
      cid,
      hash: result.hash,
      new: true,
    });
  } catch (error) {
    logger.error('Template publish failed', error);
    sendJson(res, 500, { error: 'Failed to publish template' });
  }
}

// ========== Helpers ==========

function serializePost(post: PostRecord & {
  tx_hash?: string | null;
  tx_confirmations?: number | null;
  tx_status?: string | null;
}) {
  return {
    id: post.id,
    authorUsername: post.author_username,
    authorDisplayName: post.author_display_name,
    content: post.content,
    parentId: post.parent_id,
    conversationId: post.conversation_id,
    depth: post.depth,
    timestamp: post.timestamp,
    likes: post.likes,
    retweets: post.retweets,
    repliesCount: post.replies_count,
    isTrusted: !!post.is_trusted,
    txHash: post.tx_hash || null,
    txConfirmations: post.tx_confirmations || null,
    txStatus: post.tx_status || null
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = data ? JSON.parse(data) : {};
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function validateAdminSignature(message: string, signature: string): boolean {
  try {
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === config.auth.adminAddress.toLowerCase();
  } catch (error) {
    logger.warn('Failed to validate signature', { error });
    return false;
  }
}

// ============================================================================
// Role-Gated Metadata Upload Endpoints
// ============================================================================

/**
 * Preview CID without uploading (only-hash mode)
 * POST /api/metadata/preview
 * Body: { metadata: any, kind: 'project' | 'iteration' }
 * Returns: { success: true, cid: string }
 */
async function handlePreviewCID(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await readJsonBody(req) as {
      metadata?: any;
      kind?: 'project' | 'iteration';
    };

    const { metadata, kind } = body;

    // Validate inputs
    if (!metadata) {
      sendJson(res, 400, { error: 'Missing required field: metadata' });
      return;
    }

    if (!kind || (kind !== 'project' && kind !== 'iteration')) {
      sendJson(res, 400, { error: 'Invalid kind. Must be "project" or "iteration"' });
      return;
    }

    // Preview CID (no upload, no pin)
    const cid = await ipfsService.previewCID(metadata);

    logger.info('Previewed CID (no upload)', {
      cid,
      kind,
      size: JSON.stringify(metadata).length
    });

    sendJson(res, 200, {
      success: true,
      cid
    });
  } catch (error) {
    logger.error('Failed to preview CID', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to preview CID';
    sendJson(res, 500, { success: false, error: errorMessage });
  }
}

/**
 * Submit metadata with role-gated authorization
 * POST /api/metadata/submit
 * Body: {
 *   cid: string,
 *   rawTx: string,
 *   chainId: number,
 *   contractAddress: string,
 *   projectAddress?: string,
 *   kind: 'project' | 'iteration',
 *   metadata: any
 * }
 * Returns: { success: true, cid: string, txHash: string }
 */
async function handleSubmitMetadata(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await readJsonBody(req) as {
      cid?: string;
      rawTx?: string;
      chainId?: number;
      contractAddress?: string;
      projectAddress?: string;
      kind?: 'project' | 'iteration';
      metadata?: any;
    };

    const { cid, rawTx, chainId, contractAddress, projectAddress, kind, metadata } = body;

    // Validate required fields
    if (!cid || !rawTx || !chainId || !contractAddress || !kind || !metadata) {
      sendJson(res, 400, {
        error: 'Missing required fields: cid, rawTx, chainId, contractAddress, kind, metadata'
      });
      return;
    }

    if (!ethers.isAddress(contractAddress)) {
      sendJson(res, 400, { error: 'Invalid contract address format' });
      return;
    }

    if (projectAddress && !ethers.isAddress(projectAddress)) {
      sendJson(res, 400, { error: 'Invalid project address format' });
      return;
    }

    if (kind !== 'project' && kind !== 'iteration') {
      sendJson(res, 400, { error: 'Invalid kind. Must be "project" or "iteration"' });
      return;
    }

    // Import tx verifier here to avoid circular deps
    const { verifyMetadataTx, checkAuthorization } = await import('../services/tx-verifier.js');

    // 1. Verify and decode the raw transaction
    let decoded;
    try {
      decoded = await verifyMetadataTx(rawTx, chainId, cid);
    } catch (error) {
      logger.warn('Transaction verification failed', { error, cid, chainId });
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Invalid transaction'
      });
      return;
    }

    // 2. Verify the transaction matches the expected parameters
    if (decoded.jurySC.toLowerCase() !== contractAddress.toLowerCase()) {
      sendJson(res, 400, {
        error: `JurySC mismatch: expected ${contractAddress}, got ${decoded.jurySC}`
      });
      return;
    }

    if (decoded.kind !== kind) {
      sendJson(res, 400, {
        error: `Kind mismatch: expected ${kind}, got ${decoded.kind}`
      });
      return;
    }

    if (kind === 'project') {
      if (!projectAddress) {
        sendJson(res, 400, { error: 'Project address required for project metadata' });
        return;
      }

      if (decoded.projectAddress?.toLowerCase() !== projectAddress.toLowerCase()) {
        sendJson(res, 400, {
          error: `Project address mismatch: expected ${projectAddress}, got ${decoded.projectAddress}`
        });
        return;
      }
    }

    // 3. Check authorization (signer must be authorized)
    let authorized;
    try {
      authorized = await checkAuthorization(decoded);
    } catch (error) {
      logger.error('Authorization check failed', { error, decoded });
      sendJson(res, 500, {
        error: 'Failed to check authorization'
      });
      return;
    }

    if (!authorized) {
      sendJson(res, 403, {
        error: 'Unauthorized: signer is not authorized to upload this metadata'
      });
      return;
    }

    // 4. Upload metadata to IPFS
    const uploadedCID = await ipfsService.uploadJSON(metadata);

    if (uploadedCID !== cid) {
      logger.error('CID mismatch after upload', {
        expectedCID: cid,
        uploadedCID
      });
      sendJson(res, 500, {
        error: 'CID mismatch: uploaded content does not match expected CID'
      });
      return;
    }

    // 5. Record metadata update in history
    try {
      metadataDb.createUpdate({
        chainId,
        contractAddress,
        iterationNumber: kind === 'iteration' && typeof metadata.iteration === 'number'
          ? metadata.iteration
          : null,
        projectAddress: kind === 'project' ? projectAddress || null : null,
        cid: uploadedCID,
        txHash: decoded.txHash,
        txSentHeight: null
      });
    } catch (error) {
      logger.warn('Failed to record metadata update', { error, txHash: decoded.txHash });
    }

    logger.info('Metadata submitted successfully (role-gated)', {
      cid: uploadedCID,
      txHash: decoded.txHash,
      signer: decoded.signer,
      chainId,
      contractAddress,
      projectAddress,
      kind
    });

    sendJson(res, 200, {
      success: true,
      cid: uploadedCID,
      txHash: decoded.txHash
    });
  } catch (error) {
    logger.error('Failed to submit metadata', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to submit metadata';
    sendJson(res, 500, { success: false, error: errorMessage });
  }
}
