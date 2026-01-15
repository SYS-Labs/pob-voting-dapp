import Database from 'better-sqlite3';
import { JsonRpcProvider } from 'ethers';
import { createMetadataDatabase } from '../db/metadata.js';
import { logger } from '../utils/logger.js';
import { NETWORKS } from '../constants/networks.js';

const CONFIRMATIONS_REQUIRED = 10;
const WORKER_INTERVAL = 60_000; // 60 seconds

// Single chain mode: only process records for this chain
const CHAIN_ID = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : null;

export class MetadataConfirmationWorker {
  private metadataDb: ReturnType<typeof createMetadataDatabase>;
  private providers: Map<number, JsonRpcProvider> = new Map();
  private intervalId: NodeJS.Timeout | null = null;

  constructor(db: Database.Database) {
    this.metadataDb = createMetadataDatabase(db);

    // Initialize providers for each network (or just the configured chain)
    for (const [chainId, config] of Object.entries(NETWORKS)) {
      const id = Number(chainId);
      if (CHAIN_ID !== null && id !== CHAIN_ID) {
        continue;
      }
      this.providers.set(id, new JsonRpcProvider(config.rpcUrl));
    }
  }

  /**
   * Get provider for a chain ID
   */
  private getProvider(chainId: number): JsonRpcProvider | null {
    return this.providers.get(chainId) || null;
  }

  /**
   * Get transaction confirmations for a specific chain
   */
  private async getTransactionConfirmations(
    chainId: number,
    txHash: string
  ): Promise<number | null> {
    const provider = this.getProvider(chainId);
    if (!provider) {
      logger.warn('No provider for chain', { chainId, txHash });
      return null;
    }

    try {
      const tx = await provider.getTransaction(txHash);

      if (!tx) {
        return null;
      }

      if (!tx.blockNumber) {
        // Transaction is pending
        return 0;
      }

      const currentBlock = await provider.getBlockNumber();
      return currentBlock - tx.blockNumber + 1;
    } catch (error) {
      logger.error('Failed to get transaction confirmations', {
        error,
        chainId,
        txHash
      });
      return null;
    }
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
        // Skip records for other chains in single chain mode
        if (CHAIN_ID !== null && update.chain_id !== CHAIN_ID) {
          continue;
        }

        try {
          const confirmations = await this.getTransactionConfirmations(
            update.chain_id,
            update.tx_hash
          );

          if (confirmations === null) {
            logger.warn('Metadata tx disappeared', {
              txHash: update.tx_hash,
              updateId: update.id,
              chainId: update.chain_id
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
