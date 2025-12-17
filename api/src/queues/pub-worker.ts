/**
 * Publication Worker (Queue 4)
 *
 * Publishes replies to X and submits blockchain transactions asynchronously.
 * Uses new async flow:
 * 1. Publish to X (pending -> published)
 * 2. Submit blockchain tx without waiting (published -> tx_submitted)
 * 3. Separate workers handle confirmation checking and retries
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createQueueDatabase } from '../db/queues.js';
import { createXPoster } from '../indexer/x-poster.js';
import { createBlockchainService } from '../blockchain/contract.js';
import { contentHash } from '../utils/hash.js';

export class PublicationWorker {
  private db;
  private queueDb;
  private xPoster;
  private blockchain;

  constructor() {
    this.db = initDatabase(config.database.path);
    this.queueDb = createQueueDatabase(this.db);
    this.xPoster = createXPoster();
    this.blockchain = createBlockchainService();
  }

  async process(): Promise<void> {
    logger.debug('Processing publication queue...');

    try {
      // Step 1: Publish to X
      await this.publishPendingToX();

      // Step 2: Submit blockchain transactions
      await this.submitBlockchainTransactions();
    } catch (error) {
      logger.error('Publication worker failed', error);
      throw error;
    }
  }

  /**
   * Publish pending posts to X (status: pending -> published)
   */
  private async publishPendingToX(): Promise<void> {
    const pending = this.queueDb.getPendingPublications(config.worker.batchSize);

    if (pending.length === 0) {
      logger.debug('No posts to publish to X');
      return;
    }

    let published = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        logger.debug('Publishing to X', {
          id: item.id,
          sourcePostId: item.source_post_id
        });

        // Publish to X
        const replyPostId = await this.publishToX(item.source_post_id, item.reply_content);

        // Compute content hash
        const hash = contentHash(item.reply_content);

        // Update with published info (status -> 'published')
        this.queueDb.updatePubPublished(item.id, replyPostId, hash);
        published++;

        logger.info('Reply published to X', {
          id: item.id,
          sourcePostId: item.source_post_id,
          replyPostId,
          contentHash: hash
        });
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.queueDb.updatePubFailed(item.id, `X posting failed: ${errorMsg}`);

        logger.error('Failed to publish post to X', {
          error,
          id: item.id,
          sourcePostId: item.source_post_id
        });
      }
    }

    logger.info('X publication complete', { published, failed, total: pending.length });
  }

  /**
   * Submit blockchain transactions for published posts (status: published -> tx_submitted)
   */
  private async submitBlockchainTransactions(): Promise<void> {
    const published = this.queueDb.getPublishedPendingTx(config.worker.batchSize);

    if (published.length === 0) {
      logger.debug('No published posts needing blockchain tx submission');
      return;
    }

    let submitted = 0;
    let failed = 0;

    // Get current block height for tracking
    const currentHeight = await this.blockchain.getCurrentBlockHeight();

    for (const item of published) {
      if (!item.reply_post_id || !item.content_hash) {
        logger.warn('Published item missing reply_post_id or content_hash', { id: item.id });
        continue;
      }

      try {
        logger.debug('Submitting blockchain transaction', {
          id: item.id,
          replyPostId: item.reply_post_id,
          sourcePostId: item.source_post_id
        });

        // Check if source post already has a response on-chain
        const hasResponse = await this.blockchain.hasResponse(item.source_post_id);
        if (hasResponse) {
          const existingResponse = await this.blockchain.getResponse(item.source_post_id);
          this.queueDb.updatePubFailed(
            item.id,
            `Source post already has response on-chain: ${existingResponse}`
          );
          logger.warn('Source post already has response on-chain', {
            id: item.id,
            sourcePostId: item.source_post_id,
            existingResponse
          });
          failed++;
          continue;
        }

        // Submit transaction WITHOUT waiting for confirmation
        const txHash = await this.blockchain.submitRecordResponse(
          item.reply_post_id,
          item.source_post_id,
          item.content_hash
        );

        // Update database with tx info (status -> 'tx_submitted')
        this.queueDb.updatePubTxSubmitted(item.id, txHash, currentHeight);

        // Add verification record
        this.queueDb.addVerificationRecord(item.reply_post_id, item.content_hash, txHash);

        submitted++;

        logger.info('Blockchain transaction submitted (async)', {
          id: item.id,
          replyPostId: item.reply_post_id,
          sourcePostId: item.source_post_id,
          txHash,
          sentHeight: currentHeight
        });
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.queueDb.updatePubFailed(item.id, `Blockchain tx failed: ${errorMsg}`);

        logger.error('Failed to submit blockchain transaction', {
          error,
          id: item.id,
          replyPostId: item.reply_post_id,
          sourcePostId: item.source_post_id
        });
      }
    }

    logger.info('Blockchain tx submission complete', {
      submitted,
      failed,
      total: published.length,
      currentHeight
    });
  }

  private async publishToX(sourcePostId: string, content: string): Promise<string> {
    if (!this.xPoster.isConfigured()) {
      logger.warn('X poster not configured - using mock post ID');
      return 'mock_post_' + Date.now();
    }

    return await this.xPoster.postReply(sourcePostId, content);
  }
}
