/**
 * Configuration loader
 *
 * Environment variables are loaded via tsx --env-file=.env
 * (no dotenv dependency per CLAUDE.md)
 */

import { AppConfig } from './types/config.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config: AppConfig = {
  indexer: {
    // Legacy fields (no longer used with custom client)
    xUsername: optional('X_USERNAME', ''),
    xPassword: optional('X_PASSWORD', ''),
    xEmail: optional('X_EMAIL', ''),
    // Main post IDs are now managed via database/admin API, not config
    pollInterval: parseInt(optional('POLL_INTERVAL', '300000')),
    maxReplyDepth: parseInt(optional('MAX_REPLY_DEPTH', '3')),
    trustedUsers: optional('X_TRUSTED_USERS', '').split(',').filter(Boolean),
    cookiesPath: optional('X_COOKIES_PATH', '') || undefined,
    cookiesJson: optional('X_COOKIES_JSON', '') || undefined,
    authToken: optional('X_AUTH_TOKEN', '') || undefined,
    ct0: optional('X_CT0', '') || undefined
  },

  ai: {
    provider: optional('AI_API_PROVIDER', 'openai') as 'openai',
    endpoint: optional('AI_API_ENDPOINT', 'https://api.openai.com/v1'),
    apiKey: required('AI_API_KEY'),
    model: optional('AI_MODEL', 'gpt-4-turbo')
  },

  blockchain: {
    privateKey: required('PRIVATE_KEY'),
    rpcUrl: optional('RPC_URL', 'https://rpc.tanenbaum.io'),
    chainId: parseInt(optional('CHAIN_ID', '5700')),
    contractAddress: required('CONTRACT_ADDRESS'),
    explorerUrl: optional('EXPLORER_URL', 'https://explorer.tanenbaum.io')
  },

  database: {
    path: optional('DB_PATH', './data/index.db')
  },

  worker: {
    interval: parseInt(optional('WORKER_INTERVAL', '60000')),
    batchSize: parseInt(optional('BATCH_SIZE', '10'))
  },

  auth: {
    adminAddress: required('ADMIN_ADDRESS').toLowerCase()
  },

  logLevel: (optional('LOG_LEVEL', 'info') as 'info')
};

export default config;
