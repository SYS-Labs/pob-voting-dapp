/**
 * Public-facing HTTP API server
 * Provides:
 * - Thread listing + detail from the indexed posts
 * - Admin endpoints for thread management
 * - Contract deployment endpoint with admin signature validation
 */

import http, { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { ethers } from 'ethers';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createPostDatabase } from '../db/queries.js';
import { createDeploymentDatabase } from '../db/deployments.js';
import { createMonitoredThreadsDatabase } from '../db/monitored-threads.js';
import { createMetadataDatabase } from '../db/metadata.js';
import { createIterationsDatabase } from '../db/iterations.js';
import { IPFSService } from '../services/ipfs.js';
import { MetadataService } from '../services/metadata.js';
import { logger } from '../utils/logger.js';
import { PostRecord } from '../types/post.js';

const PORT = parseInt(process.env.API_PORT || process.env.DASHBOARD_PORT || '4000', 10);

const db = initDatabase(config.database.path);
const postDb = createPostDatabase(db);
const deploymentDb = createDeploymentDatabase(db);
const threadsDb = createMonitoredThreadsDatabase(db);
const metadataDb = createMetadataDatabase(db);
const iterationsDb = createIterationsDatabase(db);

// Initialize IPFS and metadata services
const ipfsService = new IPFSService();
const metadataService = new MetadataService(ipfsService);

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
    sendJson(res, 200, { iterations });
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
