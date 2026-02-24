import Database from 'better-sqlite3';

export interface CertTemplate {
  sanitized_hash: string;
  cid: string;
  pinned_at: number;
}

export function createTemplatesDatabase(db: Database.Database) {
  /**
   * Look up an existing published template by its sanitized keccak256 hash.
   * Returns the CID if a match is found, or null.
   */
  function getByCID(sanitizedHash: string): string | null {
    const stmt = db.prepare<string, CertTemplate>(
      'SELECT * FROM cert_templates WHERE sanitized_hash = ?'
    );
    const row = stmt.get(sanitizedHash);
    return row ? row.cid : null;
  }

  /**
   * Record a newly published template.
   * Ignored if the hash is already present (idempotent).
   */
  function insert(sanitizedHash: string, cid: string): void {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO cert_templates (sanitized_hash, cid, pinned_at) VALUES (?, ?, ?)'
    );
    stmt.run(sanitizedHash, cid, Date.now());
  }

  return { getByCID, insert };
}
