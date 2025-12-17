/**
 * Forum Type Definitions
 *
 * Types for X/Twitter thread forum functionality
 */

export interface ThreadSummary {
  id: string;
  authorUsername: string;
  authorDisplayName?: string;
  content: string;
  conversationId: string;
  timestamp: string;
  repliesCount?: number;
  isTrusted?: boolean;
}

export interface ThreadPost {
  id: string;
  parentId: string | null;
  depth: number;
  authorUsername: string;
  authorDisplayName?: string;
  content: string;
  timestamp: string;
  likes: number;
  retweets: number;
  repliesCount: number;
  isTrusted: boolean;
  txHash?: string | null;
  txConfirmations?: number | null;
  txStatus?: string | null;
}

export interface MonitoredThread {
  id: number;
  post_id: string;
  contract_address: string | null;
  registered_by: string;
  status: 'active' | 'paused' | 'archived';
  registered_at: string;
  updated_at: string;
}

export interface ApiResponse {
  threads?: ThreadSummary[];
  posts?: ThreadPost[];
  conversationId?: string;
  thread?: MonitoredThread;
  monitoredThreads?: MonitoredThread[];
}
