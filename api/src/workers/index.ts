/**
 * Worker orchestration
 *
 * Runs only the metadata confirmation worker in the migration runtime.
 */

import { logger } from '../utils/logger.js';
import Database from 'better-sqlite3';
import { initDatabase } from '../db/init.js';
import { MetadataConfirmationWorker } from '../queues/metadata-confirmation-worker.js';

class WorkerOrchestrator {
  private db: Database.Database;
  private metadataWorker: MetadataConfirmationWorker;

  constructor() {
    this.db = initDatabase(process.env.DB_PATH || './data/index.db');
    this.metadataWorker = new MetadataConfirmationWorker(this.db);
  }

  start(): void {
    logger.info('Starting metadata worker runtime');
    this.metadataWorker.start();
  }

  stop(): void {
    this.metadataWorker.stop();
    this.db.close();
    logger.info('Stopped metadata worker runtime');
  }
}

const orchestrator = new WorkerOrchestrator();
orchestrator.start();

process.on('SIGINT', () => {
  orchestrator.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  orchestrator.stop();
  process.exit(0);
});

export { WorkerOrchestrator };
