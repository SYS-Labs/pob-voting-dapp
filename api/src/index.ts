/**
 * Main entry point for PoB Onboarding DApp
 */

import { logger } from './utils/logger.js';
import { config } from './config.js';
import { XIndexer } from './indexer/index.js';

async function main() {
  logger.info('Starting PoB Onboarding DApp');
  logger.info('Configuration loaded', {
    trustedUsers: config.indexer.trustedUsers.length,
    pollInterval: config.indexer.pollInterval,
    contractAddress: config.blockchain.contractAddress
  });

  // Initialize and start indexer (this also initializes the database)
  logger.info('Starting indexer...');
  const indexer = new XIndexer();
  await indexer.start();

  // TODO: Start workers
  logger.info('Workers: Not yet implemented');

  logger.info('All systems operational');
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
