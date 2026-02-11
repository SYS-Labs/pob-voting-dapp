import Database from 'better-sqlite3';

export interface ProfileSnapshot {
  id?: number;
  chain_id: number;
  account: string;
  picture_cid: string;
  bio_cid: string;
  last_updated_at: number;
}

export interface ProfileSnapshotAPI {
  chainId: number;
  account: string;
  pictureCID: string;
  bioCID: string;
  lastUpdatedAt: number;
}

function toAPIFormat(row: ProfileSnapshot): ProfileSnapshotAPI {
  return {
    chainId: row.chain_id,
    account: row.account,
    pictureCID: row.picture_cid || '',
    bioCID: row.bio_cid || '',
    lastUpdatedAt: row.last_updated_at,
  };
}

export function createProfilesDatabase(db: Database.Database) {
  function upsertProfile(profile: Omit<ProfileSnapshot, 'id'>): ProfileSnapshot {
    const stmt = db.prepare(`
      INSERT INTO profile_snapshots (
        chain_id, account, picture_cid, bio_cid, last_updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chain_id, account) DO UPDATE SET
        picture_cid = excluded.picture_cid,
        bio_cid = excluded.bio_cid,
        last_updated_at = excluded.last_updated_at
    `);

    const result = stmt.run(
      profile.chain_id,
      profile.account,
      profile.picture_cid,
      profile.bio_cid,
      profile.last_updated_at
    );

    return { id: Number(result.lastInsertRowid), ...profile };
  }

  function getProfile(chainId: number, account: string): ProfileSnapshot | null {
    const stmt = db.prepare(`
      SELECT * FROM profile_snapshots
      WHERE chain_id = ? AND LOWER(account) = LOWER(?)
    `);
    return (stmt.get(chainId, account) as ProfileSnapshot | undefined) || null;
  }

  function getProfiles(chainId: number, accounts: string[]): ProfileSnapshot[] {
    if (accounts.length === 0) return [];

    const placeholders = accounts.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT * FROM profile_snapshots
      WHERE chain_id = ? AND LOWER(account) IN (${placeholders})
    `);

    const lowerAccounts = accounts.map((a) => a.toLowerCase());
    return stmt.all(chainId, ...lowerAccounts) as ProfileSnapshot[];
  }

  function toAPI(row: ProfileSnapshot): ProfileSnapshotAPI {
    return toAPIFormat(row);
  }

  return {
    upsertProfile,
    getProfile,
    getProfiles,
    toAPI,
  };
}
