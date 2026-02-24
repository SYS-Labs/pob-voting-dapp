import Database from 'better-sqlite3';

export type CertStatus = 'pending' | 'minted' | 'cancelled' | 'requested';

export interface CertSnapshot {
  id?: number;
  chain_id: number;
  cert_nft_address: string;
  token_id: number;
  iteration: number;
  account: string;
  cert_type: string;
  status: CertStatus;
  request_time: number;
  middleware_address: string | null;
  template_cid: string | null;
  last_updated_at: number;
}

export interface CertSnapshotAPI {
  chainId: number;
  certNFTAddress: string;
  tokenId: number;
  iteration: number;
  account: string;
  certType: string;
  status: CertStatus;
  requestTime: number;
  middlewareAddress: string | null;
  templateCID: string | null;
  lastUpdatedAt: number;
}

function toAPIFormat(row: CertSnapshot): CertSnapshotAPI {
  return {
    chainId: row.chain_id,
    certNFTAddress: row.cert_nft_address,
    tokenId: row.token_id,
    iteration: row.iteration,
    account: row.account,
    certType: row.cert_type,
    status: row.status,
    requestTime: row.request_time,
    middlewareAddress: row.middleware_address,
    templateCID: row.template_cid,
    lastUpdatedAt: row.last_updated_at,
  };
}

export function createCertsDatabase(db: Database.Database) {
  function upsertCert(cert: Omit<CertSnapshot, 'id'>): CertSnapshot {
    const stmt = db.prepare(`
      INSERT INTO cert_snapshots (
        chain_id, cert_nft_address, token_id, iteration, account,
        cert_type, status, request_time,
        middleware_address, template_cid, last_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chain_id, token_id) DO UPDATE SET
        cert_nft_address = excluded.cert_nft_address,
        iteration = excluded.iteration,
        account = excluded.account,
        cert_type = excluded.cert_type,
        status = excluded.status,
        request_time = excluded.request_time,
        middleware_address = excluded.middleware_address,
        template_cid = excluded.template_cid,
        last_updated_at = excluded.last_updated_at
    `);

    const result = stmt.run(
      cert.chain_id,
      cert.cert_nft_address,
      cert.token_id,
      cert.iteration,
      cert.account,
      cert.cert_type,
      cert.status,
      cert.request_time,
      cert.middleware_address,
      cert.template_cid,
      cert.last_updated_at
    );

    return { id: Number(result.lastInsertRowid), ...cert };
  }

  function getCert(chainId: number, tokenId: number): CertSnapshot | null {
    const stmt = db.prepare(
      'SELECT * FROM cert_snapshots WHERE chain_id = ? AND token_id = ?'
    );
    return (stmt.get(chainId, tokenId) as CertSnapshot | undefined) || null;
  }

  function getCertsForAccount(chainId: number, account: string): CertSnapshot[] {
    const stmt = db.prepare(`
      SELECT * FROM cert_snapshots
      WHERE chain_id = ? AND LOWER(account) = LOWER(?)
      ORDER BY token_id ASC
    `);
    return stmt.all(chainId, account) as CertSnapshot[];
  }

  function getCertsForIteration(chainId: number, iteration: number): CertSnapshot[] {
    const stmt = db.prepare(`
      SELECT * FROM cert_snapshots
      WHERE chain_id = ? AND iteration = ? AND status != 'cancelled'
      ORDER BY token_id ASC
    `);
    return stmt.all(chainId, iteration) as CertSnapshot[];
  }

  function getActiveCertCount(chainId: number): number {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM cert_snapshots
      WHERE chain_id = ? AND status != 'cancelled'
    `);
    const row = stmt.get(chainId) as { count: number };
    return row.count;
  }

  function getNonFinalCerts(chainId: number): CertSnapshot[] {
    const stmt = db.prepare(`
      SELECT * FROM cert_snapshots
      WHERE chain_id = ? AND status IN ('requested', 'pending', 'cancelled')
      ORDER BY token_id ASC
    `);
    return stmt.all(chainId) as CertSnapshot[];
  }

  function getHighestTokenId(chainId: number): number {
    const stmt = db.prepare(`
      SELECT MAX(token_id) as max_id FROM cert_snapshots
      WHERE chain_id = ?
    `);
    const row = stmt.get(chainId) as { max_id: number | null };
    return row.max_id || 0;
  }

  function toAPI(row: CertSnapshot): CertSnapshotAPI {
    return toAPIFormat(row);
  }

  return {
    upsertCert,
    getCert,
    getCertsForAccount,
    getCertsForIteration,
    getActiveCertCount,
    getNonFinalCerts,
    getHighestTokenId,
    toAPI,
  };
}
