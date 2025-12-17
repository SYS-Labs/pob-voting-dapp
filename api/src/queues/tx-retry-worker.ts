/**
 * Transaction Retry Worker
 *
 * Handles retrying blockchain transactions that have disappeared from RPC.
 * Waits 5 blocks past the sent height to avoid issues with temporary sync
 * problems or chain reorganizations.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createQueueDatabase } from '../db/queues.js';
import { createBlockchainService } from '../blockchain/contract.js';

const MAX_RETRIES = 5;
const RETRY_BLOCK_DELAY = 5; // Wait 5 blocks before retry

export class TxRetryWorker {
  private db;
  private queueDb;
  private blockchain;

  constructor() {
    this.db = initDatabase(config.database.path);
    this.queueDb = createQueueDatabase(this.db);
    this.blockchain = createBlockchainService();
  }

  async process(): Promise<void> {
    logger.debug('Checking for transactions needing retry...');

    try {
      // Get current block height
      const currentHeight = await this.blockchain.getCurrentBlockHeight();

      // Get transactions that need retry (sent_height + 5 <= current_height)
      const txsNeedingRetry = this.queueDb.getTxNeedingRetry(currentHeight, 10);

      if (txsNeedingRetry.length === 0) {
        logger.debug('No transactions need retry');
        return;
      }

      let retried = 0;
      let failed = 0;
      let maxRetriesReached = 0;

      for (const tx of txsNeedingRetry) {
        if (!tx.tx_hash || !tx.content_hash) {
          logger.warn('Transaction missing hash or content hash', { id: tx.id });
          continue;
        }

        // Check if transaction still exists
        const confirmations = await this.blockchain.getTransactionConfirmations(tx.tx_hash);

        if (confirmations !== null) {
          // Transaction exists, just update confirmations
          this.queueDb.updatePubTxConfirmations(tx.id, confirmations);
          logger.info('Transaction found after retry check', {
            id: tx.id,
            txHash: tx.tx_hash,
            confirmations
          });
          continue;
        }

        // Verify we've waited long enough
        if (tx.tx_sent_height && tx.tx_sent_height + RETRY_BLOCK_DELAY > currentHeight) {
          logger.debug('Not enough blocks passed for retry', {
            id: tx.id,
            sentHeight: tx.tx_sent_height,
            currentHeight,
            blocksToWait: tx.tx_sent_height + RETRY_BLOCK_DELAY - currentHeight
          });
          continue;
        }

        // Check max retries
        if (tx.tx_retry_count >= MAX_RETRIES) {
          maxRetriesReached++;
          this.queueDb.updatePubFailed(
            tx.id,
            `Max retries (${MAX_RETRIES}) reached - transaction keeps disappearing`
          );
          logger.error('Max retries reached for transaction', {
            id: tx.id,
            txHash: tx.tx_hash,
            retryCount: tx.tx_retry_count
          });
          continue;
        }

        try {
          // Retry transaction submission
          logger.info('Retrying transaction submission', {
            id: tx.id,
            oldTxHash: tx.tx_hash,
            retryCount: tx.tx_retry_count + 1,
            sourcePostId: tx.source_post_id,
            replyPostId: tx.reply_post_id
          });

          const newTxHash = await this.blockchain.submitRecordPost(
            tx.reply_post_id!,
            tx.content_hash
          );

          // Update database with new transaction hash and sent height
          this.queueDb.updatePubTxRetry(tx.id, newTxHash, currentHeight);

          retried++;
          logger.info('Transaction retried successfully', {
            id: tx.id,
            oldTxHash: tx.tx_hash,
            newTxHash,
            retryCount: tx.tx_retry_count + 1,
            newSentHeight: currentHeight
          });
        } catch (error) {
          failed++;
          logger.error('Failed to retry transaction', {
            error,
            id: tx.id,
            txHash: tx.tx_hash,
            retryCount: tx.tx_retry_count
          });
        }
      }

      logger.info('Transaction retry check complete', {
        total: txsNeedingRetry.length,
        retried,
        failed,
        maxRetriesReached,
        currentHeight
      });
    } catch (error) {
      logger.error('Transaction retry worker failed', error);
      throw error;
    }
  }
}
