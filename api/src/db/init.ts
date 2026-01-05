/**
 * Database initialization script
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function initDatabase(dbPath: string = config.database.path): Database.Database {
  logger.info('Initializing database', { path: dbPath });

  // Create database
  const db = new Database(dbPath);

  // Read schema
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Execute schema (creates pob_metadata_history and pob_ipfs_cache tables)
  db.exec(schema);

  logger.info('Database initialized successfully');

  return db;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    initDatabase();
    logger.info('Database initialization complete');
    process.exit(0);
  } catch (error) {
    logger.error('Database initialization failed', error);
    process.exit(1);
  }
}
