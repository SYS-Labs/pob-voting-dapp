/**
 * Configuration types
 */

export interface IndexerConfig {
  xUsername: string;
  xPassword: string;
  xEmail: string;
  // mainPostIds removed - now managed via database/admin API
  pollInterval: number;
  maxReplyDepth: number;
  trustedUsers: string[];
  cookiesPath?: string;
  cookiesJson?: string;
  authToken?: string;
  ct0?: string;
}

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface BlockchainConfig {
  privateKey: string;
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  explorerUrl: string;
}

export interface DatabaseConfig {
  path: string;
}

export interface WorkerConfig {
  interval: number;
  batchSize: number;
}

export interface AuthConfig {
  adminAddress: string;
}

export interface AppConfig {
  indexer: IndexerConfig;
  ai: AIConfig;
  blockchain: BlockchainConfig;
  database: DatabaseConfig;
  worker: WorkerConfig;
  auth: AuthConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
