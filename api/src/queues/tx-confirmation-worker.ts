/**
 * Transaction Confirmation Worker
 *
 * Monitors pending blockchain transactions and tracks their confirmation status.
 * Marks transactions as final after 10+ confirmations.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { createQueueDatabase } from '../db/queues.js';
import { createBlockchainService } from '../blockchain/contract.js';
import { createXPoster } from '../indexer/x-poster.js';

export class TxConfirmationWorker {
  private db;
  private queueDb;
  private blockchain;
  private xPoster;

  constructor() {
    this.db = initDatabase(config.database.path);
    this.queueDb = createQueueDatabase(this.db);
    this.blockchain = createBlockchainService();
    this.xPoster = createXPoster();
  }

  async process(): Promise<void> {
    logger.debug('Checking transaction confirmations...');

    try {
      // Get transactions that need confirmation checking
      const pendingTxs = this.queueDb.getPendingTxConfirmations(100);

      if (pendingTxs.length === 0) {
        logger.debug('No pending transactions to check');
        return;
      }

      let checked = 0;
      let finalized = 0;
      let disappeared = 0;
      let failed = 0;

      for (const tx of pendingTxs) {
        if (!tx.tx_hash) {
          logger.warn('Transaction has no hash', { id: tx.id });
          continue;
        }

        try {
          // Check confirmations
          const confirmations = await this.blockchain.getTransactionConfirmations(tx.tx_hash);

          if (confirmations === null) {
            // Transaction disappeared from RPC
            disappeared++;
            logger.warn('Transaction disappeared from RPC', {
              id: tx.id,
              txHash: tx.tx_hash,
              sentHeight: tx.tx_sent_height,
              retryCount: tx.tx_retry_count
            });
            // Don't update status here - retry worker will handle it
            // based on the 5-block delay logic
            continue;
          }

          // Update confirmations in database
          this.queueDb.updatePubTxConfirmations(tx.id, confirmations);

          checked++;

          if (confirmations >= 10) {
            // Mark as final
            this.queueDb.updatePubTxFinal(tx.id);
            finalized++;
            logger.info('Transaction finalized', {
              id: tx.id,
              txHash: tx.tx_hash,
              confirmations,
              sourcePostId: tx.source_post_id,
              replyPostId: tx.reply_post_id
            });

            // Post seal reply to X
            await this.postSealReply(tx.reply_post_id, tx.tx_hash);
          } else {
            logger.debug('Transaction confirmation update', {
              id: tx.id,
              txHash: tx.tx_hash,
              confirmations,
              status: tx.status
            });
          }
        } catch (error) {
          failed++;
          logger.error('Failed to check transaction confirmations', {
            error,
            id: tx.id,
            txHash: tx.tx_hash
          });
        }
      }

      logger.info('Transaction confirmation check complete', {
        total: pendingTxs.length,
        checked,
        finalized,
        disappeared,
        failed
      });
    } catch (error) {
      logger.error('Transaction confirmation worker failed', error);
      throw error;
    }
  }

  /**
   * Post a seal reply to X indicating the transaction is finalized
   */
  private async postSealReply(replyPostId: string | null, txHash: string): Promise<void> {
    if (!replyPostId) {
      logger.warn('Cannot post seal - no reply_post_id', { txHash });
      return;
    }

    if (!this.xPoster.isConfigured()) {
      logger.warn('X poster not configured - skipping seal post');
      return;
    }

    try {
      const explorerLink = `${config.blockchain.explorerUrl}/tx/${txHash}`;
      const sealContent = `sealed at: ${explorerLink}`;

      const sealPostId = await this.xPoster.postReply(replyPostId, sealContent);

      // Save seal post ID so it can be filtered from indexing
      this.queueDb.updateSealPostId(txHash, sealPostId);

      logger.info('Seal reply posted to X', {
        replyPostId,
        sealPostId,
        txHash,
        explorerLink
      });
    } catch (error) {
      logger.error('Failed to post seal reply', {
        error,
        replyPostId,
        txHash
      });
      // Don't throw - seal posting failure shouldn't break the confirmation worker
    }
  }
}
