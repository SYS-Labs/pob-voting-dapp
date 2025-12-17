/**
 * Embedding Worker (Queue 1.5)
 *
 * Backfills embeddings for knowledge base entries that don't have them yet.
 * This runs separately from KnowledgeBaseWorker to avoid slowing it down
 * with expensive AI API calls.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createQueueDatabase } from '../db/queues.js';
import { createEmbeddingService } from '../ai/embeddings.js';

export class EmbeddingWorker {
  private db;
  private queueDb;
  private embeddingService;

  constructor() {
    this.db = initDatabase(config.database.path);
    this.queueDb = createQueueDatabase(this.db);
    this.embeddingService = createEmbeddingService();
  }

  async process(): Promise<void> {
    logger.debug('Processing embedding backfill queue...');

    try {
      // Get knowledge base entries without embeddings
      const entries = this.queueDb.getKnowledgeBaseEntriesWithoutEmbeddings(
        config.worker.batchSize
      );

      if (entries.length === 0) {
        logger.debug('No knowledge base entries need embeddings');
        return;
      }

      let processed = 0;
      let failed = 0;

      // Process in smaller batches to respect API rate limits
      const batchSize = 5;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);

        try {
          // Generate embeddings for the batch
          const texts = batch.map(entry => entry.content);
          const embeddings = await this.embeddingService.generateEmbeddings(texts);

          // Update each entry with its embedding
          for (let j = 0; j < batch.length; j++) {
            try {
              this.queueDb.updateKnowledgeBaseEmbedding(
                batch[j].post_id,
                embeddings[j]
              );
              processed++;

              logger.debug('Generated embedding for knowledge base entry', {
                postId: batch[j].post_id,
                dimension: embeddings[j].length
              });
            } catch (error) {
              failed++;
              logger.error('Failed to update embedding', {
                error,
                postId: batch[j].post_id
              });
            }
          }
        } catch (error) {
          failed += batch.length;
          logger.error('Failed to generate embeddings for batch', {
            error,
            batchSize: batch.length
          });
        }

        // Small delay between batches to respect rate limits
        if (i + batchSize < entries.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      logger.info('Embedding backfill processed', {
        processed,
        failed,
        total: entries.length
      });
    } catch (error) {
      logger.error('Embedding worker failed', error);
      throw error;
    }
  }
}
