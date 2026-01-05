import Database from 'better-sqlite3';

export interface MetadataUpdate {
  id?: number;
  chain_id: number;
  contract_address: string | null;
  iteration_number: number | null;
  project_address: string | null;
  cid: string;
  tx_hash: string;
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
      tx_sent_height: params.txSentHeight,
      confirmations: 0,
      confirmed: false,
      created_at: now,
      updated_at: now
    };
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
      ORDER BY created_at DESC
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
      ORDER BY created_at DESC
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
      ORDER BY created_at DESC
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
      ORDER BY created_at DESC
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
      ORDER BY created_at DESC
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
      ORDER BY created_at DESC
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
      ORDER BY created_at DESC
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
      ORDER BY created_at DESC
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
