import Database from 'better-sqlite3';

export interface EligibilityRow {
  chain_id: number;
  iteration: number;
  account: string;
  eligible: number; // 0 or 1
  cert_type: string;
  is_project: number; // 0 or 1
  has_named_team_members: number; // 0 or 1
  last_updated_at: number;
}

export interface EligibilityAPI {
  chainId: number;
  iteration: number;
  account: string;
  eligible: boolean;
  certType: string;
  isProject: boolean;
  hasNamedTeamMembers: boolean;
}

function toAPIFormat(row: EligibilityRow): EligibilityAPI {
  return {
    chainId: row.chain_id,
    iteration: row.iteration,
    account: row.account,
    eligible: row.eligible === 1,
    certType: row.cert_type,
    isProject: row.is_project === 1,
    hasNamedTeamMembers: row.has_named_team_members === 1,
  };
}

export function createEligibilityDatabase(db: Database.Database) {
  function upsertEligibility(row: EligibilityRow): void {
    const stmt = db.prepare(`
      INSERT INTO cert_eligibility (
        chain_id, iteration, account, eligible, cert_type,
        is_project, has_named_team_members, last_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chain_id, iteration, account) DO UPDATE SET
        eligible = excluded.eligible,
        cert_type = excluded.cert_type,
        is_project = excluded.is_project,
        has_named_team_members = excluded.has_named_team_members,
        last_updated_at = excluded.last_updated_at
    `);

    stmt.run(
      row.chain_id,
      row.iteration,
      row.account,
      row.eligible,
      row.cert_type,
      row.is_project,
      row.has_named_team_members,
      row.last_updated_at
    );
  }

  function getEligibleForAccount(chainId: number, account: string): EligibilityRow[] {
    const stmt = db.prepare(`
      SELECT * FROM cert_eligibility
      WHERE chain_id = ? AND LOWER(account) = LOWER(?) AND eligible = 1
      ORDER BY iteration ASC
    `);
    return stmt.all(chainId, account) as EligibilityRow[];
  }

  function toAPI(row: EligibilityRow): EligibilityAPI {
    return toAPIFormat(row);
  }

  return {
    upsertEligibility,
    getEligibleForAccount,
    toAPI,
  };
}
