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
import { logger } from '../utils/logger.js';
import { PostRecord } from '../types/post.js';

const PORT = parseInt(process.env.API_PORT || process.env.DASHBOARD_PORT || '4000', 10);

const db = initDatabase(config.database.path);
const postDb = createPostDatabase(db);
const deploymentDb = createDeploymentDatabase(db);
const threadsDb = createMonitoredThreadsDatabase(db);

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
