/**
 * Evaluation Worker (Queue 2)
 *
 * Evaluates non-trusted posts using AI to determine if they
 * warrant a response. Posts marked RESPOND move to reply queue.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createQueueDatabase } from '../db/queues.js';
import { createAIClient } from '../ai/client.js';
import { createEmbeddingService } from '../ai/embeddings.js';

export class EvaluationWorker {
  private db;
  private queueDb;
  private aiClient;
  private embeddingService;

  constructor() {
    this.db = initDatabase(config.database.path);
    this.queueDb = createQueueDatabase(this.db);
    this.aiClient = createAIClient();
    this.embeddingService = createEmbeddingService();
  }

  async process(): Promise<void> {
    logger.debug('Processing evaluation queue...');

    try {
      // First, add new non-trusted posts to eval queue
      const newPosts = this.queueDb.getUnprocessedNonTrustedPosts(config.worker.batchSize);

      for (const post of newPosts) {
        // Skip bot's own posts to prevent self-reply loop
        if (post.author_username === config.indexer.xUsername) {
          logger.debug('Skipping bot\'s own post', { postId: post.id, author: post.author_username });
          this.queueDb.markPostProcessed(post.id);
          continue;
        }

        this.queueDb.addToEvalQueue(post.id);
        this.queueDb.markPostProcessed(post.id);
      }

      if (newPosts.length > 0) {
        logger.info('Added posts to evaluation queue', { count: newPosts.length });
      }

      // Now process pending evaluations
      const pending = this.queueDb.getPendingEvalItems(config.worker.batchSize);

      if (pending.length === 0) {
        logger.debug('No posts to evaluate');
        return;
      }

      let responded = 0;
      let ignored = 0;
      let stopped = 0;
      let failed = 0;

      for (const item of pending) {
        try {
          // Double-check: skip bot's own posts (defensive programming)
          const post = this.queueDb.getPost(item.post_id);
          if (post && post.author_username === config.indexer.xUsername) {
            logger.debug('Skipping bot\'s own post in eval queue', { postId: item.post_id });
            this.queueDb.updateEvalResult(item.post_id, 'IGNORE', 'Bot\'s own post');
            ignored++;
            continue;
          }

          const result = await this.evaluatePost(item.post_id);

          // Update eval queue with decision
          this.queueDb.updateEvalResult(item.post_id, result.decision, result.reasoning);

          // If RESPOND, add to reply queue
          if (result.decision === 'RESPOND') {
            this.queueDb.addToReplyQueue(item.post_id);
            responded++;
          } else if (result.decision === 'IGNORE') {
            ignored++;
          } else if (result.decision === 'STOP') {
            stopped++;
          }

          logger.debug('Post evaluated', {
            postId: item.post_id,
            decision: result.decision,
            reasoning: result.reasoning
          });
        } catch (error) {
          failed++;
          logger.error('Failed to evaluate post', {
            error,
            postId: item.post_id
          });
        }
      }

      logger.info('Evaluation queue processed', {
        responded,
        ignored,
        stopped,
        failed,
        total: pending.length
      });
    } catch (error) {
      logger.error('Evaluation worker failed', error);
      throw error;
    }
  }

  private async evaluatePost(postId: string) {
    // Get post details
    const post = this.queueDb.getPost(postId);
    if (!post) {
      throw new Error(`Post ${postId} not found`);
    }

    // Get thread context
    const threadContext = this.queueDb.getThreadContext(postId);

    // Get knowledge base with semantic search
    const knowledgeBase = await this.getRelevantKnowledge(post.content);

    // Call AI API to evaluate
    return await this.aiClient.evaluatePost(
      {
        id: post.id,
        content: post.content,
        author_username: post.author_username,
        isTrusted: post.is_trusted
      },
      threadContext,
      knowledgeBase
    );
  }

  private async getRelevantKnowledge(query: string): Promise<string[]> {
    try {
      // Get all KB entries with embeddings
      const kbEntries = this.queueDb.getKnowledgeBaseWithEmbeddings();

      if (kbEntries.length === 0) {
        // Fallback to simple retrieval if no embeddings available yet
        return this.queueDb.getKnowledgeBase(5);
      }

      // Use semantic search to find top 5 most relevant entries
      const relevantEntries = await this.embeddingService.searchKnowledgeBaseContent(
        query,
        kbEntries,
        5,
        0.7 // minimum similarity threshold
      );

      return relevantEntries;
    } catch (error) {
      logger.warn('Semantic search failed, falling back to recent KB entries', { error });
      return this.queueDb.getKnowledgeBase(5);
    }
  }
}
