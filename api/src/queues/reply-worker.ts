/**
 * Reply Generation Worker (Queue 3)
 *
 * Generates AI responses for posts in the reply queue,
 * then moves them to the publication queue.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createQueueDatabase } from '../db/queues.js';
import { createAIClient } from '../ai/client.js';
import { createEmbeddingService } from '../ai/embeddings.js';

export class ReplyGenerationWorker {
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
    logger.debug('Processing reply generation queue...');

    try {
      // Get pending replies
      const pending = this.queueDb.getPendingReplies(config.worker.batchSize);

      if (pending.length === 0) {
        logger.debug('No replies to generate');
        return;
      }

      let generated = 0;
      let failed = 0;

      for (const item of pending) {
        try {
          // Update status to generating
          this.queueDb.updateReplyStatus(item.post_id, 'generating');

          // Generate reply
          const replyContent = await this.generateReply(item.post_id);

          // Update reply queue with content
          this.queueDb.updateReplyContent(item.post_id, replyContent);

          // Add to publication queue
          this.queueDb.addToPubQueue(item.post_id, replyContent);

          generated++;
          logger.debug('Reply generated', {
            postId: item.post_id,
            length: replyContent.length
          });
        } catch (error) {
          failed++;
          // Keep status as pending so it can be retried
          logger.error('Failed to generate reply', {
            error,
            postId: item.post_id
          });
        }
      }

      logger.info('Reply generation queue processed', {
        generated,
        failed,
        total: pending.length
      });
    } catch (error) {
      logger.error('Reply generation worker failed', error);
      throw error;
    }
  }

  private async generateReply(postId: string): Promise<string> {
    // Get post details
    const post = this.queueDb.getPost(postId);
    if (!post) {
      throw new Error(`Post ${postId} not found`);
    }

    // Get thread context
    const threadContext = this.queueDb.getThreadContext(postId);

    // Get knowledge base with semantic search
    const knowledgeBase = await this.getRelevantKnowledge(post.content);

    // Call AI API to generate reply
    const result = await this.aiClient.generateReply(
      {
        id: post.id,
        content: post.content,
        author_username: post.author_username
      },
      threadContext,
      knowledgeBase
    );

    return result.content;
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
