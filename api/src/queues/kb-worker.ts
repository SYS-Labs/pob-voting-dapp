/**
 * Knowledge Base Worker (Queue 1)
 *
 * Processes trusted posts and adds them to the knowledge base
 * for use in AI-generated responses.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createQueueDatabase } from '../db/queues.js';

export class KnowledgeBaseWorker {
  private db;
  private queueDb;

  constructor() {
    this.db = initDatabase(config.database.path);
    this.queueDb = createQueueDatabase(this.db);
  }

  async process(): Promise<void> {
    logger.debug('Processing knowledge base queue...');

    try {
      // Get unprocessed trusted posts
      const posts = this.queueDb.getUnprocessedTrustedPosts(config.worker.batchSize);

      if (posts.length === 0) {
        logger.debug('No trusted posts to process');
        return;
      }

      let processed = 0;
      let failed = 0;

      for (const post of posts) {
        try {
          // Add to knowledge base
          this.queueDb.addToKnowledgeBase(post.id, post.content);

          // Mark as processed
          this.queueDb.markPostProcessed(post.id);

          processed++;
          logger.debug('Added to knowledge base', {
            postId: post.id,
            author: post.author_username
          });
        } catch (error) {
          failed++;
          logger.error('Failed to add post to knowledge base', {
            error,
            postId: post.id
          });
        }
      }

      logger.info('Knowledge base queue processed', {
        processed,
        failed,
        total: posts.length
      });
    } catch (error) {
      logger.error('Knowledge base worker failed', error);
      throw error;
    }
  }
}
