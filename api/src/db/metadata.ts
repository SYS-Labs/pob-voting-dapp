import Database from 'better-sqlite3';

export interface MetadataUpdate {
  id?: number;
  chain_id: number;
  contract_address: string | null;
  iteration_number: number | null;
  project_address: string | null;
  cid: string;
  tx_hash: string;
  log_index: number;
  tx_sent_height: number | null;
  confirmations: number;
  confirmed: boolean;
  created_at: number;
  updated_at: number;
}

export interface IPFSCacheItem {
  cid: string;
  content: string;
  content_type: string;
  fetched_at: number;
}

export function createMetadataDatabase(db: Database.Database) {
  ensureMetadataHistorySchema(db);

  function ensureMetadataHistorySchema(db: Database.Database): void {
    // Fresh databases get the canonical table from schema.sql (run by initDatabase
    // before this), already including log_index and COLLATE NOCASE on the address
    // columns. This only rebuilds older tables that predate either of those.
    const createSql = (db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pob_metadata_history'`
    ).get() as { sql: string } | undefined)?.sql;

    if (!createSql) return;

    const hasLogIndex = /\blog_index\b/i.test(createSql);
    const hasNoCaseAddresses =
      /contract_address\s+text\s+collate\s+nocase/i.test(createSql) &&
      /project_address\s+text\s+collate\s+nocase/i.test(createSql);

    if (hasLogIndex && hasNoCaseAddresses) return;

    // Preserve log_index values when the column already exists; otherwise default to 0.
    const logIndexExpr = hasLogIndex ? 'log_index' : '0';

    db.exec(`
      BEGIN;

      CREATE TABLE pob_metadata_history_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL,
        contract_address TEXT COLLATE NOCASE,
        iteration_number INTEGER,
        project_address TEXT COLLATE NOCASE,
        cid TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL DEFAULT 0,
        tx_sent_height INTEGER,
        confirmations INTEGER DEFAULT 0,
        confirmed BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(tx_hash, log_index)
      );

      INSERT OR IGNORE INTO pob_metadata_history_migrated (
        id, chain_id, contract_address, iteration_number, project_address, cid,
        tx_hash, log_index, tx_sent_height, confirmations, confirmed, created_at, updated_at
      )
      SELECT
        id, chain_id, contract_address, iteration_number, project_address, cid,
        tx_hash, ${logIndexExpr}, tx_sent_height, confirmations, confirmed, created_at, updated_at
      FROM pob_metadata_history;

      DROP TABLE pob_metadata_history;
      ALTER TABLE pob_metadata_history_migrated RENAME TO pob_metadata_history;

      CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_confirmed ON pob_metadata_history(confirmed);
      CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_project ON pob_metadata_history(chain_id, project_address, confirmed, created_at);
      CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_iteration ON pob_metadata_history(chain_id, contract_address, confirmed, created_at);
      CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_cid ON pob_metadata_history(cid);

      COMMIT;
    `);
  }

  /**
   * Record a new metadata update transaction
   */
  function createUpdate(params: {
    chainId: number;
    contractAddress: string | null;
    iterationNumber: number | null;
    projectAddress: string | null;
    cid: string;
    txHash: string;
    txSentHeight: number | null;
  }): MetadataUpdate {
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO pob_metadata_history (
        chain_id, contract_address, iteration_number, project_address, cid,
        tx_hash, tx_sent_height, confirmations, confirmed, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `);

    const result = stmt.run(
      params.chainId,
      params.contractAddress,
      params.iterationNumber,
      params.projectAddress,
      params.cid,
      params.txHash,
      params.txSentHeight,
      now,
      now
    );

    return {
      id: Number(result.lastInsertRowid),
      chain_id: params.chainId,
      contract_address: params.contractAddress,
      iteration_number: params.iterationNumber,
      project_address: params.projectAddress,
      cid: params.cid,
      tx_hash: params.txHash,
      log_index: 0,
      tx_sent_height: params.txSentHeight,
      confirmations: 0,
      confirmed: false,
      created_at: now,
      updated_at: now
    };
  }

  /**
   * Insert or refresh a confirmed metadata update discovered from chain logs.
   * External scripts do not pass through the API queue, so this backfills tx hashes
   * without creating duplicate rows on repeated indexing polls.
   */
  function upsertConfirmedUpdate(params: {
    chainId: number;
    contractAddress: string | null;
    iterationNumber: number | null;
    projectAddress: string | null;
    cid: string;
    txHash: string;
    blockNumber: number | null;
    logIndex: number;
    confirmations: number;
  }): MetadataUpdate {
    const now = Date.now();

    if (params.logIndex !== 0) {
      const legacyRow = db.prepare(`
        SELECT id FROM pob_metadata_history
        WHERE tx_hash = ?
          AND log_index = 0
          AND cid = ?
          AND COALESCE(contract_address, '') = COALESCE(?, '')
          AND COALESCE(project_address, '') = COALESCE(?, '')
        LIMIT 1
      `).get(
        params.txHash,
        params.cid,
        params.contractAddress,
        params.projectAddress
      ) as { id: number } | undefined;

      const exactRow = db.prepare(`
        SELECT id FROM pob_metadata_history
        WHERE tx_hash = ? AND log_index = ?
        LIMIT 1
      `).get(params.txHash, params.logIndex) as { id: number } | undefined;

      if (legacyRow && !exactRow) {
        db.prepare(`
          UPDATE pob_metadata_history
          SET chain_id = ?,
              contract_address = ?,
              iteration_number = ?,
              project_address = ?,
              cid = ?,
              log_index = ?,
              tx_sent_height = COALESCE(?, tx_sent_height),
              confirmations = MAX(confirmations, ?),
              confirmed = 1,
              updated_at = ?
          WHERE id = ?
        `).run(
          params.chainId,
          params.contractAddress,
          params.iterationNumber,
          params.projectAddress,
          params.cid,
          params.logIndex,
          params.blockNumber,
          params.confirmations,
          now,
          legacyRow.id
        );

        const adopted = db.prepare('SELECT * FROM pob_metadata_history WHERE id = ?')
          .get(legacyRow.id) as MetadataUpdate | undefined;
        if (adopted) return adopted;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO pob_metadata_history (
        chain_id, contract_address, iteration_number, project_address, cid,
        tx_hash, log_index, tx_sent_height, confirmations, confirmed, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(tx_hash, log_index) DO UPDATE SET
        chain_id = excluded.chain_id,
        contract_address = excluded.contract_address,
        iteration_number = excluded.iteration_number,
        project_address = excluded.project_address,
        cid = excluded.cid,
        tx_sent_height = COALESCE(excluded.tx_sent_height, pob_metadata_history.tx_sent_height),
        confirmations = MAX(pob_metadata_history.confirmations, excluded.confirmations),
        confirmed = 1,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      params.chainId,
      params.contractAddress,
      params.iterationNumber,
      params.projectAddress,
      params.cid,
      params.txHash,
      params.logIndex,
      params.blockNumber,
      params.confirmations,
      now,
      now
    );

    const row = db.prepare('SELECT * FROM pob_metadata_history WHERE tx_hash = ? AND log_index = ?')
      .get(params.txHash, params.logIndex) as MetadataUpdate | undefined;

    if (!row) {
      throw new Error(`Failed to upsert metadata update ${params.txHash}`);
    }

    return row;
  }

  /**
   * Get pending metadata updates (not yet confirmed)
   */
  function getPendingUpdates(limit = 100): MetadataUpdate[] {
    const stmt = db.prepare(`
      SELECT * FROM pob_metadata_history
      WHERE confirmed = 0
      ORDER BY created_at ASC
      LIMIT ?
    `);

    return stmt.all(limit) as MetadataUpdate[];
  }

  /**
   * Update confirmation status for a metadata update
   */
  function updateConfirmations(txHash: string, confirmations: number): void {
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE pob_metadata_history
      SET confirmations = ?, updated_at = ?
      WHERE tx_hash = ?
    `);

    stmt.run(confirmations, now, txHash);
  }

  /**
   * Mark a metadata update as confirmed
   */
  function markConfirmed(txHash: string): MetadataUpdate | null {
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE pob_metadata_history
      SET confirmed = 1, updated_at = ?
      WHERE tx_hash = ?
    `);

    stmt.run(now, txHash);

    return db.prepare('SELECT * FROM pob_metadata_history WHERE tx_hash = ?')
      .get(txHash) as MetadataUpdate | undefined || null;
  }

  /**
   * Get metadata update by transaction hash
   */
  function getUpdateByTxHash(txHash: string): MetadataUpdate | null {
    const stmt = db.prepare('SELECT * FROM pob_metadata_history WHERE tx_hash = ?');
    return (stmt.get(txHash) as MetadataUpdate | undefined) || null;
  }

  /**
   * Get pending metadata update for a project
   */
  function getPendingUpdateForProject(
    chainId: number,
    projectAddress: string
  ): MetadataUpdate | null {
    const stmt = db.prepare(`
      SELECT * FROM pob_metadata_history
      WHERE chain_id = ?
        AND project_address = ?
        AND confirmed = 0
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return (stmt.get(chainId, projectAddress) as MetadataUpdate | undefined) || null;
  }

  /**
   * Get latest metadata update for a project by CID
   */
  function getLatestProjectUpdateForCID(
    chainId: number,
    contractAddress: string,
    projectAddress: string,
    cid: string
  ): MetadataUpdate | null {
    const stmt = db.prepare(`
      SELECT * FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address = ?
        AND project_address = ?
        AND cid = ?
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(chainId, contractAddress, projectAddress, cid) as MetadataUpdate | undefined;
    if (row) return row;

    // Fallback: check for records without contract_address (legacy)
    const fallback = db.prepare(`
      SELECT * FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address IS NULL
        AND project_address = ?
        AND cid = ?
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    return (fallback.get(chainId, projectAddress, cid) as MetadataUpdate | undefined) || null;
  }

  /**
   * Get latest confirmed CID for a project
   */
  function getLatestProjectCID(
    chainId: number,
    contractAddress: string,
    projectAddress: string
  ): string | null {
    const stmt = db.prepare(`
      SELECT cid FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address = ?
        AND project_address = ?
        AND confirmed = 1
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(chainId, contractAddress, projectAddress) as { cid: string } | undefined;
    if (row) return row.cid;

    // Fallback: check for records without contract_address (legacy)
    const fallback = db.prepare(`
      SELECT cid FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address IS NULL
        AND project_address = ?
        AND confirmed = 1
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    const fallbackRow = fallback.get(chainId, projectAddress) as { cid: string } | undefined;
    return fallbackRow?.cid || null;
  }

  /**
   * Get latest metadata update for an iteration by CID
   */
  function getLatestIterationUpdateForCID(
    chainId: number,
    contractAddress: string,
    cid: string
  ): MetadataUpdate | null {
    const stmt = db.prepare(`
      SELECT * FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address = ?
        AND project_address IS NULL
        AND cid = ?
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(chainId, contractAddress, cid) as MetadataUpdate | undefined;
    if (row) return row;

    // Fallback: check for records without contract_address (legacy)
    const fallback = db.prepare(`
      SELECT * FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address IS NULL
        AND project_address IS NULL
        AND cid = ?
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    return (fallback.get(chainId, cid) as MetadataUpdate | undefined) || null;
  }

  /**
   * Get latest confirmed CID for an iteration
   */
  function getLatestIterationCID(
    chainId: number,
    contractAddress: string
  ): string | null {
    const stmt = db.prepare(`
      SELECT cid FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address = ?
        AND project_address IS NULL
        AND confirmed = 1
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(chainId, contractAddress) as { cid: string } | undefined;
    if (row) return row.cid;

    // Fallback: check for records without contract_address (legacy)
    const fallback = db.prepare(`
      SELECT cid FROM pob_metadata_history
      WHERE chain_id = ?
        AND contract_address IS NULL
        AND project_address IS NULL
        AND confirmed = 1
      ORDER BY COALESCE(tx_sent_height, 0) DESC, log_index DESC, created_at DESC
      LIMIT 1
    `);

    const fallbackRow = fallback.get(chainId) as { cid: string } | undefined;
    return fallbackRow?.cid || null;
  }

  /**
   * Cache IPFS content locally
   */
  function cacheIPFSContent(cid: string, content: string, contentType = 'application/json'): IPFSCacheItem {
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO pob_ipfs_cache (cid, content, content_type, fetched_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cid) DO NOTHING
    `);

    stmt.run(cid, content, contentType, now);

    return {
      cid,
      content,
      content_type: contentType,
      fetched_at: now
    };
  }

  /**
   * Get cached IPFS content
   */
  function getCachedIPFSContent(cid: string): IPFSCacheItem | null {
    const stmt = db.prepare('SELECT * FROM pob_ipfs_cache WHERE cid = ?');
    return (stmt.get(cid) as IPFSCacheItem | undefined) || null;
  }

  /**
   * Get multiple cached IPFS contents
   */
  function getBatchCachedIPFSContent(cids: string[]): Map<string, IPFSCacheItem> {
    const result = new Map<string, IPFSCacheItem>();

    if (cids.length === 0) return result;

    const placeholders = cids.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM pob_ipfs_cache WHERE cid IN (${placeholders})`);
    const rows = stmt.all(...cids) as IPFSCacheItem[];

    for (const row of rows) {
      result.set(row.cid, row);
    }

    return result;
  }

  /**
   * Delete cached IPFS content (used when unpinning)
   */
  function deleteCachedIPFSContent(cid: string): void {
    const stmt = db.prepare('DELETE FROM pob_ipfs_cache WHERE cid = ?');
    stmt.run(cid);
  }

  return {
    createUpdate,
    upsertConfirmedUpdate,
    getPendingUpdates,
    updateConfirmations,
    markConfirmed,
    getUpdateByTxHash,
    getPendingUpdateForProject,
    getLatestProjectUpdateForCID,
    getLatestProjectCID,
    getLatestIterationUpdateForCID,
    getLatestIterationCID,
    cacheIPFSContent,
    getCachedIPFSContent,
    getBatchCachedIPFSContent,
    deleteCachedIPFSContent
  };
}
