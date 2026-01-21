import Database from 'better-sqlite3';

export interface RetryRecord {
  key: string;
  attempt_count: number;
  last_attempt_at: number;
  next_retry_at: number;
  last_error: string | null;
}

// Default backoff schedule (in milliseconds)
// After attempt 1: 5 minutes, attempt 2: 30 minutes, attempt 3: 2 hours, attempt 4+: 24 hours
const DEFAULT_BACKOFF_MS = [
  5 * 60 * 1000,      // 5 minutes
  30 * 60 * 1000,     // 30 minutes
  2 * 60 * 60 * 1000, // 2 hours
  24 * 60 * 60 * 1000 // 24 hours (max)
];

export function createRetryTracker(db: Database.Database, backoffMs: number[] = DEFAULT_BACKOFF_MS) {
  /**
   * Build a key from module, action, and identifier
   */
  function buildKey(module: string, action: string, identifier: string): string {
    return `${module}:${action}:${identifier}`;
  }

  /**
   * Calculate next retry time based on attempt count
   */
  function getBackoffMs(attemptCount: number): number {
    const index = Math.min(attemptCount - 1, backoffMs.length - 1);
    return backoffMs[index];
  }

  /**
   * Check if an operation should be retried now
   * Returns true if:
   * - No record exists (first attempt)
   * - next_retry_at has passed
   */
  function shouldRetry(module: string, action: string, identifier: string): boolean {
    const key = buildKey(module, action, identifier);
    const stmt = db.prepare('SELECT next_retry_at FROM retry_tracker WHERE key = ?');
    const record = stmt.get(key) as { next_retry_at: number } | undefined;

    if (!record) {
      return true; // No failure recorded, go ahead
    }

    return Date.now() >= record.next_retry_at;
  }

  /**
   * Record a failed attempt
   */
  function recordFailure(module: string, action: string, identifier: string, error?: string): void {
    const key = buildKey(module, action, identifier);
    const now = Date.now();

    // Get existing record to increment attempt count
    const existing = db.prepare('SELECT attempt_count FROM retry_tracker WHERE key = ?')
      .get(key) as { attempt_count: number } | undefined;

    const attemptCount = (existing?.attempt_count || 0) + 1;
    const nextRetryAt = now + getBackoffMs(attemptCount);

    const stmt = db.prepare(`
      INSERT INTO retry_tracker (key, attempt_count, last_attempt_at, next_retry_at, last_error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        attempt_count = ?,
        last_attempt_at = ?,
        next_retry_at = ?,
        last_error = ?
    `);

    stmt.run(key, attemptCount, now, nextRetryAt, error || null,
             attemptCount, now, nextRetryAt, error || null);
  }

  /**
   * Record a successful attempt (removes from tracker)
   */
  function recordSuccess(module: string, action: string, identifier: string): void {
    const key = buildKey(module, action, identifier);
    const stmt = db.prepare('DELETE FROM retry_tracker WHERE key = ?');
    stmt.run(key);
  }

  /**
   * Get retry record for an operation
   */
  function getRecord(module: string, action: string, identifier: string): RetryRecord | null {
    const key = buildKey(module, action, identifier);
    const stmt = db.prepare('SELECT * FROM retry_tracker WHERE key = ?');
    return (stmt.get(key) as RetryRecord | undefined) || null;
  }

  /**
   * Get all records for a module (useful for debugging)
   */
  function getModuleRecords(module: string): RetryRecord[] {
    const stmt = db.prepare('SELECT * FROM retry_tracker WHERE key LIKE ?');
    return stmt.all(`${module}:%`) as RetryRecord[];
  }

  /**
   * Clear old records (cleanup job)
   * Removes records older than maxAge (default: 30 days)
   */
  function cleanup(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const stmt = db.prepare('DELETE FROM retry_tracker WHERE last_attempt_at < ?');
    const result = stmt.run(cutoff);
    return result.changes;
  }

  return {
    buildKey,
    shouldRetry,
    recordFailure,
    recordSuccess,
    getRecord,
    getModuleRecords,
    cleanup
  };
}
