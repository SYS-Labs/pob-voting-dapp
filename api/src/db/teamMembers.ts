import Database from 'better-sqlite3';

export type TeamMemberStatus = 'proposed' | 'approved' | 'rejected';

export interface TeamMemberSnapshot {
  id?: number;
  chain_id: number;
  iteration: number;
  project_address: string;
  member_address: string;
  status: TeamMemberStatus;
  full_name: string;
  last_updated_at: number;
}

export interface TeamMemberSnapshotAPI {
  chainId: number;
  iteration: number;
  projectAddress: string;
  memberAddress: string;
  status: TeamMemberStatus;
  fullName: string;
  lastUpdatedAt: number;
}

function toAPIFormat(row: TeamMemberSnapshot): TeamMemberSnapshotAPI {
  return {
    chainId: row.chain_id,
    iteration: row.iteration,
    projectAddress: row.project_address,
    memberAddress: row.member_address,
    status: row.status,
    fullName: row.full_name,
    lastUpdatedAt: row.last_updated_at,
  };
}

export function createTeamMembersDatabase(db: Database.Database) {
  function upsertTeamMember(member: Omit<TeamMemberSnapshot, 'id'>): TeamMemberSnapshot {
    const stmt = db.prepare(`
      INSERT INTO team_member_snapshots (
        chain_id, iteration, project_address, member_address,
        status, full_name, last_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chain_id, iteration, project_address, member_address) DO UPDATE SET
        status = excluded.status,
        full_name = excluded.full_name,
        last_updated_at = excluded.last_updated_at
    `);

    const result = stmt.run(
      member.chain_id,
      member.iteration,
      member.project_address,
      member.member_address,
      member.status,
      member.full_name,
      member.last_updated_at
    );

    return { id: Number(result.lastInsertRowid), ...member };
  }

  function getTeamMembersForProject(
    chainId: number,
    iteration: number,
    projectAddress: string
  ): TeamMemberSnapshot[] {
    const stmt = db.prepare(`
      SELECT * FROM team_member_snapshots
      WHERE chain_id = ? AND iteration = ? AND LOWER(project_address) = LOWER(?)
      ORDER BY id ASC
    `);
    return stmt.all(chainId, iteration, projectAddress) as TeamMemberSnapshot[];
  }

  function getTeamMembersForMember(
    chainId: number,
    memberAddress: string
  ): TeamMemberSnapshot[] {
    const stmt = db.prepare(`
      SELECT * FROM team_member_snapshots
      WHERE chain_id = ? AND LOWER(member_address) = LOWER(?)
      ORDER BY iteration ASC, project_address ASC
    `);
    return stmt.all(chainId, memberAddress) as TeamMemberSnapshot[];
  }

  function getPendingMembers(chainId: number): TeamMemberSnapshot[] {
    const stmt = db.prepare(`
      SELECT * FROM team_member_snapshots
      WHERE chain_id = ? AND status = 'proposed'
      ORDER BY iteration ASC, project_address ASC
    `);
    return stmt.all(chainId) as TeamMemberSnapshot[];
  }

  function toAPI(row: TeamMemberSnapshot): TeamMemberSnapshotAPI {
    return toAPIFormat(row);
  }

  return {
    upsertTeamMember,
    getTeamMembersForProject,
    getTeamMembersForMember,
    getPendingMembers,
    toAPI,
  };
}
