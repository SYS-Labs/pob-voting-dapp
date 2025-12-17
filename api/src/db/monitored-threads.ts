/**
 * Database operations for monitored threads (admin-registered X posts)
 */

import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface MonitoredThread {
  id: number;
  post_id: string;
  contract_address: string | null;
  registered_by: string;
  status: 'active' | 'paused' | 'archived';
  signature: string | null;
  message: string | null;
  registered_at: string;
  updated_at: string;
}

export class MonitoredThreadsDatabase {
  constructor(private db: Database.Database) {}

  /**
   * Register a new thread for monitoring
   */
  registerThread(params: {
    postId: string;
    registeredBy: string;
    signature?: string;
    message?: string;
  }): MonitoredThread {
    // Check if already exists
    const existing = this.getThread(params.postId);
    if (existing) {
      throw new Error(`Thread ${params.postId} is already registered`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO monitored_threads (post_id, registered_by, signature, message, status)
      VALUES (@post_id, @registered_by, @signature, @message, 'active')
    `);

    stmt.run({
      post_id: params.postId,
      registered_by: params.registeredBy,
      signature: params.signature || null,
      message: params.message || null
    });

    logger.info('Registered new thread', {
      postId: params.postId,
      registeredBy: params.registeredBy
    });

    return this.getThread(params.postId)!;
  }

  /**
   * Get a specific thread by post ID
   */
  getThread(postId: string): MonitoredThread | null {
    const stmt = this.db.prepare(
      'SELECT * FROM monitored_threads WHERE post_id = ?'
    );
    return stmt.get(postId) as MonitoredThread | null;
  }

  /**
   * Get all threads with optional status filter
   */
  listThreads(status?: 'active' | 'paused' | 'archived'): MonitoredThread[] {
    if (status) {
      const stmt = this.db.prepare(
        'SELECT * FROM monitored_threads WHERE status = ? ORDER BY registered_at DESC'
      );
      return stmt.all(status) as MonitoredThread[];
    }

    const stmt = this.db.prepare(
      'SELECT * FROM monitored_threads ORDER BY registered_at DESC'
    );
    return stmt.all() as MonitoredThread[];
  }

  /**
   * Get active thread post IDs (for indexer)
   */
  getActiveThreadIds(): string[] {
    const stmt = this.db.prepare(
      `SELECT post_id FROM monitored_threads
       WHERE status = 'active'
       ORDER BY registered_at DESC`
    );
    const results = stmt.all() as { post_id: string }[];
    return results.map(r => r.post_id);
  }

  /**
   * Assign a contract address to a thread
   */
  assignContract(postId: string, contractAddress: string): void {
    const thread = this.getThread(postId);
    if (!thread) {
      throw new Error(`Thread ${postId} not found`);
    }

    if (thread.contract_address) {
      throw new Error(
        `Thread ${postId} already has contract ${thread.contract_address}. Cannot deploy duplicate.`
      );
    }

    const stmt = this.db.prepare(`
      UPDATE monitored_threads
      SET contract_address = ?, updated_at = datetime('now')
      WHERE post_id = ?
    `);

    stmt.run(contractAddress, postId);

    logger.info('Assigned contract to thread', {
      postId,
      contractAddress
    });
  }

  /**
   * Update thread status (pause/resume/archive)
   */
  updateStatus(postId: string, status: 'active' | 'paused' | 'archived'): void {
    const thread = this.getThread(postId);
    if (!thread) {
      throw new Error(`Thread ${postId} not found`);
    }

    const stmt = this.db.prepare(`
      UPDATE monitored_threads
      SET status = ?, updated_at = datetime('now')
      WHERE post_id = ?
    `);

    stmt.run(status, postId);

    logger.info('Updated thread status', {
      postId,
      oldStatus: thread.status,
      newStatus: status
    });
  }

  /**
   * Delete a thread
   */
  deleteThread(postId: string): void {
    const thread = this.getThread(postId);
    if (!thread) {
      throw new Error(`Thread ${postId} not found`);
    }

    const stmt = this.db.prepare('DELETE FROM monitored_threads WHERE post_id = ?');
    stmt.run(postId);

    logger.info('Deleted thread', { postId });
  }

  /**
   * Check if a contract is already assigned to any thread
   */
  isContractAssigned(contractAddress: string): boolean {
    const stmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM monitored_threads WHERE contract_address = ?'
    );
    const result = stmt.get(contractAddress) as { count: number };
    return result.count > 0;
  }

  /**
   * Get thread by contract address
   */
  getThreadByContract(contractAddress: string): MonitoredThread | null {
    const stmt = this.db.prepare(
      'SELECT * FROM monitored_threads WHERE contract_address = ?'
    );
    return stmt.get(contractAddress) as MonitoredThread | null;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    active: number;
    paused: number;
    archived: number;
    withContract: number;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM monitored_threads')
      .get() as { count: number };

    const active = this.db.prepare('SELECT COUNT(*) as count FROM monitored_threads WHERE status = "active"')
      .get() as { count: number };

    const paused = this.db.prepare('SELECT COUNT(*) as count FROM monitored_threads WHERE status = "paused"')
      .get() as { count: number };

    const archived = this.db.prepare('SELECT COUNT(*) as count FROM monitored_threads WHERE status = "archived"')
      .get() as { count: number };

    const withContract = this.db.prepare('SELECT COUNT(*) as count FROM monitored_threads WHERE contract_address IS NOT NULL')
      .get() as { count: number };

    return {
      total: total.count,
      active: active.count,
      paused: paused.count,
      archived: archived.count,
      withContract: withContract.count
    };
  }
}

export function createMonitoredThreadsDatabase(db: Database.Database): MonitoredThreadsDatabase {
  return new MonitoredThreadsDatabase(db);
}
