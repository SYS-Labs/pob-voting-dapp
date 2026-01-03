/**
 * Worker orchestration
 *
 * Runs all queue workers in sequence at regular intervals.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { initDatabase } from '../db/init.js';
import { KnowledgeBaseWorker } from '../queues/kb-worker.js';
import { EmbeddingWorker } from '../queues/embedding-worker.js';
import { EvaluationWorker } from '../queues/eval-worker.js';
import { ReplyGenerationWorker } from '../queues/reply-worker.js';
import { PublicationWorker } from '../queues/pub-worker.js';
import { TxConfirmationWorker } from '../queues/tx-confirmation-worker.js';
import { TxRetryWorker } from '../queues/tx-retry-worker.js';
import { MetadataConfirmationWorker } from '../queues/metadata-confirmation-worker.js';

class WorkerOrchestrator {
  private kbWorker = new KnowledgeBaseWorker();
  private embeddingWorker = new EmbeddingWorker();
  private evalWorker = new EvaluationWorker();
  private replyWorker = new ReplyGenerationWorker();
  private pubWorker = new PublicationWorker();
  private txConfirmationWorker = new TxConfirmationWorker();
  private txRetryWorker = new TxRetryWorker();
  private metadataWorker: MetadataConfirmationWorker;

  constructor() {
    const db = initDatabase(config.database.path);
    this.metadataWorker = new MetadataConfirmationWorker(db);
  }

  async processAll(): Promise<void> {
    logger.info('Running all workers...');

    try {
      // Run workers in sequence (pipeline)
      await this.kbWorker.process();
      await this.embeddingWorker.process(); // Backfill embeddings after KB updates
      await this.evalWorker.process();
      await this.replyWorker.process();
      await this.pubWorker.process();

      // Transaction management workers
      await this.txConfirmationWorker.process(); // Check transaction confirmations
      await this.txRetryWorker.process(); // Retry disappeared transactions

      // Metadata IPFS management
      await this.metadataWorker.process(); // Check metadata tx confirmations and unpin old CIDs

      logger.info('All workers completed');
    } catch (error) {
      logger.error('Worker processing failed', error);
    }
  }

  start(): void {
    logger.info('Starting worker orchestrator', {
      interval: config.worker.interval
    });

    // Run immediately
    this.processAll();

    // Set up interval
    setInterval(() => {
      this.processAll();
    }, config.worker.interval);
  }
}

// Start the orchestrator (will run when this file is executed)
const orchestrator = new WorkerOrchestrator();
orchestrator.start();

export { WorkerOrchestrator };
