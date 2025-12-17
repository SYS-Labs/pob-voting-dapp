/**
 * Migration script: Move main post IDs from config to monitored_threads table
 *
 * Run this once to migrate existing X_MAIN_POST_IDS from .env to the database.
 * After migration, the indexer will read from the database instead of config.
 */

import { config } from '../config.js';
import { initDatabase } from './init.js';
import { createMonitoredThreadsDatabase } from './monitored-threads.js';
import { logger } from '../utils/logger.js';

async function migrate() {
  logger.info('Starting migration: config → monitored_threads');

  const db = initDatabase(config.database.path);
  const threadsDb = createMonitoredThreadsDatabase(db);

  // mainPostIds was removed from config - this migration is no longer needed
  // It was used to migrate X_MAIN_POST_IDS env var to database
  const existingPostIds: string[] = [];
  const adminAddress = config.auth.adminAddress;

  if (existingPostIds.length === 0) {
    logger.warn('No post IDs found in X_MAIN_POST_IDS config (migration deprecated)');
    logger.info('Migration complete (nothing to migrate)');
    return;
  }

  logger.info('Found post IDs in config', {
    count: existingPostIds.length,
    postIds: existingPostIds
  });

  let migrated = 0;
  let skipped = 0;

  for (const postId of existingPostIds) {
    const existing = threadsDb.getThread(postId);

    if (existing) {
      logger.info('Post already in database, skipping', { postId });
      skipped++;
      continue;
    }

    try {
      threadsDb.registerThread({
        postId,
        registeredBy: adminAddress,
        message: 'Migrated from config file'
      });

      logger.info('Migrated post to database', { postId });
      migrated++;
    } catch (error) {
      logger.error('Failed to migrate post', {
        postId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  db.close();

  logger.info('Migration complete', {
    total: existingPostIds.length,
    migrated,
    skipped
  });

  if (migrated > 0) {
    logger.info('✅ Next steps:');
    logger.info('   1. Restart the indexer to use database threads');
    logger.info('   2. You can now manage threads via admin API');
    logger.info('   3. (Optional) Remove X_MAIN_POST_IDS from .env file');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => {
      logger.info('Migration script finished');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration script failed', error);
      process.exit(1);
    });
}

export { migrate };
