import Database from 'better-sqlite3';
import { createMetadataDatabase } from '../db/metadata.js';
import { createBlockchainService } from '../blockchain/contract.js';
import { logger } from '../utils/logger.js';

const CONFIRMATIONS_REQUIRED = 10;
const WORKER_INTERVAL = 60_000; // 60 seconds

export class MetadataConfirmationWorker {
  private metadataDb: ReturnType<typeof createMetadataDatabase>;
  private blockchain: ReturnType<typeof createBlockchainService>;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(db: Database.Database) {
    this.metadataDb = createMetadataDatabase(db);
    this.blockchain = createBlockchainService();
  }

  /**
   * Start the worker
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Metadata confirmation worker already running');
      return;
    }

    logger.info('Starting metadata confirmation worker', {
      interval: WORKER_INTERVAL,
      confirmationsRequired: CONFIRMATIONS_REQUIRED
    });

    // Run immediately, then at intervals
    this.process().catch(error => {
      logger.error('Initial metadata confirmation check failed', { error });
    });

    this.intervalId = setInterval(() => {
      this.process().catch(error => {
        logger.error('Metadata confirmation check failed', { error });
      });
    }, WORKER_INTERVAL);
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped metadata confirmation worker');
    }
  }

  /**
   * Process pending metadata updates
   */
  async process(): Promise<void> {
    try {
      // Get pending metadata updates
      const pending = this.metadataDb.getPendingUpdates(100);

      if (pending.length === 0) {
        logger.debug('No pending metadata updates to check');
        return;
      }

      logger.info('Checking metadata update confirmations', {
        count: pending.length
      });

      for (const update of pending) {
        try {
          const confirmations = await this.blockchain.getTransactionConfirmations(
            update.tx_hash
          );

          if (confirmations === null) {
            logger.warn('Metadata tx disappeared', {
              txHash: update.tx_hash,
              updateId: update.id
            });
            continue;
          }

          // Update confirmations count
          this.metadataDb.updateConfirmations(update.tx_hash, confirmations);

          logger.debug('Updated metadata tx confirmations', {
            txHash: update.tx_hash,
            confirmations,
            required: CONFIRMATIONS_REQUIRED
          });

          // If confirmed, mark as confirmed
          if (confirmations >= CONFIRMATIONS_REQUIRED) {
            const confirmedUpdate = this.metadataDb.markConfirmed(update.tx_hash);

            if (confirmedUpdate) {
              logger.info('Metadata update confirmed', {
                txHash: update.tx_hash,
                cid: update.cid,
                confirmations,
                projectAddress: update.project_address,
                iterationNumber: update.iteration_number
              });
            }
          }
        } catch (error) {
          logger.error('Failed to check metadata update confirmations', {
            error,
            updateId: update.id,
            txHash: update.tx_hash
          });
        }
      }
    } catch (error) {
      logger.error('Metadata confirmation worker process failed', { error });
      throw error;
    }
  }
}
