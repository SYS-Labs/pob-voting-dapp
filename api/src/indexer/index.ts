/**
 * X Indexer entry point
 *
 * This module monitors a main X post and indexes all replies/sub-replies
 * up to 3 levels deep. Posts are classified as trusted or non-trusted based
 * on the author's username.
 *
 * See xAPI/IMPLEMENTATION.md for implementation details.
 */

import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createPostDatabase } from '../db/queries.js';
import { createMonitoredThreadsDatabase } from '../db/monitored-threads.js';
import { createXApiClient } from './x-api-client.js';
import { createCustomThreadBuilder } from './thread-builder-custom.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { Post } from '../types/post.js';

class XIndexer {
  private db: Database.Database;
  private postDb: ReturnType<typeof createPostDatabase>;
  private threadsDb: ReturnType<typeof createMonitoredThreadsDatabase>;
  private threadBuilder: ReturnType<typeof createCustomThreadBuilder>;
  private rateLimiter: RateLimiter;
  private isRunning = false;

  constructor() {
    // Initialize database
    this.db = initDatabase(config.database.path);
    this.postDb = createPostDatabase(this.db);
    this.threadsDb = createMonitoredThreadsDatabase(this.db);

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter(300, 15 * 60 * 1000);

    // Initialize custom X API client (uses env vars directly)
    const xClient = createXApiClient();

    // Create thread builder
    this.threadBuilder = createCustomThreadBuilder(xClient, {
      maxReplyDepth: config.indexer.maxReplyDepth,
      trustedUsers: config.indexer.trustedUsers,
      rateLimiter: this.rateLimiter
    });
  }

  /**
   * Initialize the indexer
   */
  async initialize(): Promise<void> {
    logger.info('Initializing X indexer');
    // Custom client is already initialized in constructor with env vars
    logger.info('X indexer initialized successfully');
  }

  /**
   * Poll for new posts and index them
   */
  async poll(): Promise<void> {

    // Get threads from database (managed via admin API)
    const mainPostIds = this.threadsDb.getActiveThreadIds();

    if (mainPostIds.length === 0) {
      logger.warn('No threads registered. Use admin API to register threads for monitoring');
      return;
    }

    logger.debug('Monitoring threads from database', { count: mainPostIds.length });

    logger.info('Polling for new posts', {
      mainPostIds,
      count: mainPostIds.length
    });

    const startTime = Date.now();
    let totalNewPosts = 0;
    let totalScanned = 0;

    try {
      // Index each main post and its replies
      for (const mainPostId of mainPostIds) {
        logger.debug('Indexing thread', { mainPostId });

        // Build the reply tree from this main post
        const posts = await this.threadBuilder.buildReplyTree(mainPostId, 0);

        // Filter out posts we've already indexed
        const newPosts = posts.filter(post => !this.postDb.postExists(post.id));

        if (newPosts.length > 0) {
          // Store new posts in database
          this.postDb.storePosts(newPosts);

          logger.info('Indexed thread', {
            mainPostId,
            total: posts.length,
            new: newPosts.length,
            trusted: newPosts.filter(p => p.isTrusted).length
          });
        } else {
          logger.debug('No new posts in thread', {
            mainPostId,
            totalScanned: posts.length
          });
        }

        totalNewPosts += newPosts.length;
        totalScanned += posts.length;
      }

      logger.info('Poll complete', {
        threadsIndexed: mainPostIds.length,
        totalScanned,
        totalNew: totalNewPosts,
        duration: Date.now() - startTime
      });

      // Log database statistics
      const stats = this.postDb.getStats();
      logger.info('Database statistics', stats);

    } catch (error) {
      logger.error('Poll failed', error);
      throw error;
    }
  }

  /**
   * Start the indexer with continuous polling
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Indexer is already running');
      return;
    }

    logger.info('Starting X indexer', {
      pollInterval: config.indexer.pollInterval,
      maxDepth: config.indexer.maxReplyDepth,
      trustedUsers: config.indexer.trustedUsers
    });

    // Initialize first
    await this.initialize();

    // Initial poll
    await this.poll();

    this.isRunning = true;

    // Set up polling interval
    setInterval(() => {
      if (!this.isRunning) return;

      this.poll().catch(error => {
        logger.error('Poll failed', error);
      });
    }, config.indexer.pollInterval);

    logger.info('X indexer started successfully');
  }

  /**
   * Stop the indexer
   */
  async stop(): Promise<void> {
    logger.info('Stopping X indexer');
    this.isRunning = false;
    this.db.close();
    logger.info('X indexer stopped');
  }

  /**
   * Get the newest post from a list
   * Currently unused but kept for potential future use
   */
  // @ts-expect-error - Reserved for future use
  private getNewestPost(posts: Post[]): Post | null {
    if (posts.length === 0) return null;

    return posts.reduce((newest, post) =>
      post.timestamp > newest.timestamp ? post : newest
    );
  }
}

// Start the indexer (will run when this file is executed)
const indexer = new XIndexer();
indexer.start().catch(error => {
  logger.error('Indexer failed to start', error);
  process.exit(1);
});

export { XIndexer };
