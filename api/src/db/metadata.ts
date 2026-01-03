import Database from 'better-sqlite3';

export interface MetadataUpdate {
  id?: number;
  chain_id: number;
  iteration_number: number;
  project_address: string | null;
  old_cid: string | null;
  new_cid: string;
  tx_hash: string;
  tx_sent_height: number | null;
  confirmations: number;
  confirmed: boolean;
  created_at: number;
  updated_at: number;
}

export interface UnpinQueueItem {
  id?: number;
  cid: string;
  reason: string | null;
  created_at: number;
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
    iterationNumber: number;
    projectAddress: string | null;
    oldCid: string | null;
    newCid: string;
    txHash: string;
    txSentHeight: number | null;
  }): MetadataUpdate {
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO metadata_updates (
        chain_id, iteration_number, project_address, old_cid, new_cid,
        tx_hash, tx_sent_height, confirmations, confirmed, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `);

    const result = stmt.run(
      params.chainId,
      params.iterationNumber,
      params.projectAddress,
      params.oldCid,
      params.newCid,
      params.txHash,
      params.txSentHeight,
      now,
      now
    );

    return {
      id: Number(result.lastInsertRowid),
      chain_id: params.chainId,
      iteration_number: params.iterationNumber,
      project_address: params.projectAddress,
      old_cid: params.oldCid,
      new_cid: params.newCid,
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
      SELECT * FROM metadata_updates
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
      UPDATE metadata_updates
      SET confirmations = ?, updated_at = ?
      WHERE tx_hash = ?
    `);

    stmt.run(confirmations, now, txHash);
  }

  /**
   * Mark a metadata update as confirmed and queue old CID for unpinning
   */
  function markConfirmed(txHash: string): MetadataUpdate | null {
    const now = Date.now();

    const stmt = db.prepare(`
      UPDATE metadata_updates
      SET confirmed = 1, updated_at = ?
      WHERE tx_hash = ?
    `);

    stmt.run(now, txHash);

    const update = db.prepare('SELECT * FROM metadata_updates WHERE tx_hash = ?')
      .get(txHash) as MetadataUpdate | undefined;

    if (!update) return null;

    // Queue old CID for unpinning if it exists
    if (update.old_cid) {
      try {
        queueForUnpin(
          update.old_cid,
          update.project_address ? 'project_update' : 'iteration_update'
        );
      } catch (error) {
        // Ignore duplicate errors
      }
    }

    return update;
  }

  /**
   * Get metadata update by transaction hash
   */
  function getUpdateByTxHash(txHash: string): MetadataUpdate | null {
    const stmt = db.prepare('SELECT * FROM metadata_updates WHERE tx_hash = ?');
    return (stmt.get(txHash) as MetadataUpdate | undefined) || null;
  }


  /**
   * Queue a CID for unpinning
   */
  function queueForUnpin(cid: string, reason: string | null = null): UnpinQueueItem {
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO unpin_queue (cid, reason, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cid) DO NOTHING
    `);

    const result = stmt.run(cid, reason, now);

    return {
      id: Number(result.lastInsertRowid),
      cid,
      reason,
      created_at: now
    };
  }

  /**
   * Get items queued for unpinning
   */
  function getUnpinQueue(limit = 10): UnpinQueueItem[] {
    const stmt = db.prepare(`
      SELECT * FROM unpin_queue
      ORDER BY created_at ASC
      LIMIT ?
    `);

    return stmt.all(limit) as UnpinQueueItem[];
  }

  /**
   * Remove item from unpin queue
   */
  function removeFromUnpinQueue(cid: string): void {
    const stmt = db.prepare('DELETE FROM unpin_queue WHERE cid = ?');
    stmt.run(cid);
  }

  /**
   * Cache IPFS content locally
   */
  function cacheIPFSContent(cid: string, content: string, contentType = 'application/json'): IPFSCacheItem {
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO ipfs_cache (cid, content, content_type, fetched_at)
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
    const stmt = db.prepare('SELECT * FROM ipfs_cache WHERE cid = ?');
    return (stmt.get(cid) as IPFSCacheItem | undefined) || null;
  }

  /**
   * Get multiple cached IPFS contents
   */
  function getBatchCachedIPFSContent(cids: string[]): Map<string, IPFSCacheItem> {
    const result = new Map<string, IPFSCacheItem>();

    if (cids.length === 0) return result;

    const placeholders = cids.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM ipfs_cache WHERE cid IN (${placeholders})`);
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
    const stmt = db.prepare('DELETE FROM ipfs_cache WHERE cid = ?');
    stmt.run(cid);
  }

  return {
    createUpdate,
    getPendingUpdates,
    updateConfirmations,
    markConfirmed,
    getUpdateByTxHash,
    queueForUnpin,
    getUnpinQueue,
    removeFromUnpinQueue,
    cacheIPFSContent,
    getCachedIPFSContent,
    getBatchCachedIPFSContent,
    deleteCachedIPFSContent
  };
}
