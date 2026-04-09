/**
 * Main entry point for the iteration indexer runtime.
 */

import { logger } from './utils/logger.js';
import { IterationIndexer } from './indexer/iteration-indexer.js';

async function main() {
  logger.info('Starting iteration indexer runtime', {
    chainId: process.env.CHAIN_ID || 'all-configured-chains',
  });

  const indexer = new IterationIndexer();

  process.on('SIGINT', () => {
    indexer.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    indexer.stop();
    process.exit(0);
  });

  await indexer.start();
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
