import Database from 'better-sqlite3';

export type JuryState = 'deployed' | 'activated' | 'active' | 'ended' | 'locked';

export interface IterationSnapshot {
  id?: number;
  iteration_id: number;
  chain_id: number;
  round: number;
  registry_address: string;
  pob_address: string;
  jury_address: string;
  deploy_block_hint: number;
  jury_state: JuryState;
  start_time: number | null;
  end_time: number | null;
  voting_mode: number;
  projects_locked: number;
  contract_locked: number;
  winner_address: string | null;
  has_winner: number;
  devrel_vote: string | null;
  daohic_vote: string | null;
  community_vote: string | null;
  project_scores: string | null;  // JSON
  devrel_count: number;
  daohic_count: number;
  community_count: number;
  devrel_account: string | null;
  daohic_voters: string | null;  // JSON array
  daohic_individual_votes: string | null;  // JSON object: { voterAddress: projectAddress }
  projects: string | null;  // JSON array
  last_block: number;
  last_updated_at: number;
}

export interface PreviousRoundAPI {
  round: number;
  jurySC: string;
  pob: string;
  version: string;
  deployBlockHint: number;
  votingMode: number;
  juryState: JuryState;
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
  devRelAccount: string | null;
  daoHicVoters: string[];
  daoHicIndividualVotes: Record<string, string>;
  projects: ProjectSnapshot[];
}

export interface IterationSnapshotAPI {
  iterationId: number;
  chainId: number;
  round: number;
  registryAddress: string;
  pobAddress: string;
  juryAddress: string;
  deployBlockHint: number;
  juryState: JuryState;
  startTime: number | null;
  endTime: number | null;
  votingMode: number;
  projectsLocked: boolean;
  contractLocked: boolean;
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
  projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null;
  totals: { devRel: number; daoHic: number; community: number };
  devRelAccount: string | null;
  daoHicVoters: string[];
  daoHicIndividualVotes: Record<string, string>;  // voterAddress -> projectAddress
  projects: ProjectSnapshot[];
  lastBlock: number;
  lastUpdatedAt: number;
  prevRounds?: PreviousRoundAPI[];
}

export interface ProjectSnapshot {
  address: string;
  metadataCID: string | null;
  metadata: Record<string, unknown> | null;
}

function toAPIFormat(row: IterationSnapshot): IterationSnapshotAPI {
  return {
    iterationId: row.iteration_id,
    chainId: row.chain_id,
    round: row.round,
    registryAddress: row.registry_address,
    pobAddress: row.pob_address,
    juryAddress: row.jury_address,
    deployBlockHint: row.deploy_block_hint,
    juryState: row.jury_state,
    startTime: row.start_time,
    endTime: row.end_time,
    votingMode: row.voting_mode,
    projectsLocked: row.projects_locked === 1,
    contractLocked: row.contract_locked === 1,
    winner: {
      projectAddress: row.winner_address,
      hasWinner: row.has_winner === 1
    },
    entityVotes: {
      devRel: row.devrel_vote,
      daoHic: row.daohic_vote,
      community: row.community_vote
    },
    projectScores: row.project_scores ? JSON.parse(row.project_scores) : null,
    totals: {
      devRel: row.devrel_count,
      daoHic: row.daohic_count,
      community: row.community_count
    },
    devRelAccount: row.devrel_account,
    daoHicVoters: row.daohic_voters ? JSON.parse(row.daohic_voters) : [],
    daoHicIndividualVotes: row.daohic_individual_votes ? JSON.parse(row.daohic_individual_votes) : {},
    projects: row.projects ? JSON.parse(row.projects) : [],
    lastBlock: row.last_block,
    lastUpdatedAt: row.last_updated_at
  };
}

export function createIterationsDatabase(db: Database.Database) {
  /**
   * Upsert an iteration snapshot (insert or update)
   */
  function upsertSnapshot(snapshot: Omit<IterationSnapshot, 'id'>): IterationSnapshot {
    const stmt = db.prepare(`
      INSERT INTO iteration_snapshots (
        iteration_id, chain_id, round, registry_address, pob_address, jury_address,
        deploy_block_hint, jury_state, start_time, end_time, voting_mode, projects_locked, contract_locked,
        winner_address, has_winner, devrel_vote, daohic_vote, community_vote,
        project_scores, devrel_count, daohic_count, community_count,
        devrel_account, daohic_voters, daohic_individual_votes, projects, last_block, last_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chain_id, iteration_id, round) DO UPDATE SET
        registry_address = excluded.registry_address,
        pob_address = excluded.pob_address,
        jury_address = excluded.jury_address,
        deploy_block_hint = excluded.deploy_block_hint,
        jury_state = excluded.jury_state,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        voting_mode = excluded.voting_mode,
        projects_locked = excluded.projects_locked,
        contract_locked = excluded.contract_locked,
        winner_address = excluded.winner_address,
        has_winner = excluded.has_winner,
        devrel_vote = excluded.devrel_vote,
        daohic_vote = excluded.daohic_vote,
        community_vote = excluded.community_vote,
        project_scores = excluded.project_scores,
        devrel_count = excluded.devrel_count,
        daohic_count = excluded.daohic_count,
        community_count = excluded.community_count,
        devrel_account = excluded.devrel_account,
        daohic_voters = excluded.daohic_voters,
        daohic_individual_votes = excluded.daohic_individual_votes,
        projects = excluded.projects,
        last_block = excluded.last_block,
        last_updated_at = excluded.last_updated_at
    `);

    const result = stmt.run(
      snapshot.iteration_id,
      snapshot.chain_id,
      snapshot.round,
      snapshot.registry_address,
      snapshot.pob_address,
      snapshot.jury_address,
      snapshot.deploy_block_hint,
      snapshot.jury_state,
      snapshot.start_time,
      snapshot.end_time,
      snapshot.voting_mode,
      snapshot.projects_locked,
      snapshot.contract_locked,
      snapshot.winner_address,
      snapshot.has_winner,
      snapshot.devrel_vote,
      snapshot.daohic_vote,
      snapshot.community_vote,
      snapshot.project_scores,
      snapshot.devrel_count,
      snapshot.daohic_count,
      snapshot.community_count,
      snapshot.devrel_account,
      snapshot.daohic_voters,
      snapshot.daohic_individual_votes,
      snapshot.projects,
      snapshot.last_block,
      snapshot.last_updated_at
    );

    return {
      id: Number(result.lastInsertRowid),
      ...snapshot
    };
  }

  /**
   * Get a specific iteration snapshot
   */
  function getSnapshot(chainId: number, iterationId: number, round?: number): IterationSnapshot | null {
    let stmt;
    if (round !== undefined) {
      stmt = db.prepare(`
        SELECT * FROM iteration_snapshots
        WHERE chain_id = ? AND iteration_id = ? AND round = ?
      `);
      return (stmt.get(chainId, iterationId, round) as IterationSnapshot | undefined) || null;
    } else {
      // Get the latest round for this iteration
      stmt = db.prepare(`
        SELECT * FROM iteration_snapshots
        WHERE chain_id = ? AND iteration_id = ?
        ORDER BY round DESC
        LIMIT 1
      `);
      return (stmt.get(chainId, iterationId) as IterationSnapshot | undefined) || null;
    }
  }

  /**
   * Get all snapshots for all iterations (latest round per iteration)
   */
  function getAllSnapshots(): IterationSnapshot[] {
    const stmt = db.prepare(`
      SELECT s1.* FROM iteration_snapshots s1
      INNER JOIN (
        SELECT chain_id, iteration_id, MAX(round) as max_round
        FROM iteration_snapshots
        GROUP BY chain_id, iteration_id
      ) s2 ON s1.chain_id = s2.chain_id
           AND s1.iteration_id = s2.iteration_id
           AND s1.round = s2.max_round
      ORDER BY s1.chain_id, s1.iteration_id DESC
    `);
    return stmt.all() as IterationSnapshot[];
  }

  /**
   * Get all snapshots for a specific chain
   */
  function getSnapshotsByChain(chainId: number): IterationSnapshot[] {
    const stmt = db.prepare(`
      SELECT s1.* FROM iteration_snapshots s1
      INNER JOIN (
        SELECT chain_id, iteration_id, MAX(round) as max_round
        FROM iteration_snapshots
        WHERE chain_id = ?
        GROUP BY chain_id, iteration_id
      ) s2 ON s1.chain_id = s2.chain_id
           AND s1.iteration_id = s2.iteration_id
           AND s1.round = s2.max_round
      ORDER BY s1.iteration_id DESC
    `);
    return stmt.all(chainId) as IterationSnapshot[];
  }

  /**
   * Get all rounds for an iteration
   */
  function getAllRounds(chainId: number, iterationId: number): IterationSnapshot[] {
    const stmt = db.prepare(`
      SELECT * FROM iteration_snapshots
      WHERE chain_id = ? AND iteration_id = ?
      ORDER BY round ASC
    `);
    return stmt.all(chainId, iterationId) as IterationSnapshot[];
  }

  /**
   * Delete old snapshots (for cleanup if needed)
   */
  function deleteOldSnapshots(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const stmt = db.prepare(`
      DELETE FROM iteration_snapshots
      WHERE last_updated_at < ?
    `);
    const result = stmt.run(cutoff);
    return result.changes;
  }

  /**
   * Convert snapshot to API format
   */
  function toAPI(snapshot: IterationSnapshot): IterationSnapshotAPI {
    return toAPIFormat(snapshot);
  }

  /**
   * Get snapshot in API format
   */
  function getSnapshotAPI(chainId: number, iterationId: number, round?: number): IterationSnapshotAPI | null {
    const snapshot = getSnapshot(chainId, iterationId, round);
    return snapshot ? toAPIFormat(snapshot) : null;
  }

  /**
   * Get all snapshots in API format (with previous rounds)
   */
  function getAllSnapshotsAPI(): IterationSnapshotAPI[] {
    const latestSnapshots = getAllSnapshots();

    return latestSnapshots.map(snapshot => {
      const apiSnapshot = toAPIFormat(snapshot);

      // Get all rounds for this iteration and build prev_rounds
      const allRounds = getAllRounds(snapshot.chain_id, snapshot.iteration_id);
      const prevRounds: PreviousRoundAPI[] = allRounds
        .filter(r => r.round > 0 && r.round < snapshot.round)
        .map(r => ({
          round: r.round,
          jurySC: r.jury_address,
          pob: r.pob_address,
          version: '001', // Historical rounds
          deployBlockHint: r.deploy_block_hint,
          votingMode: r.voting_mode,
          juryState: r.jury_state,
          winner: {
            projectAddress: r.winner_address,
            hasWinner: r.has_winner === 1
          },
          entityVotes: {
            devRel: r.devrel_vote,
            daoHic: r.daohic_vote,
            community: r.community_vote
          },
          devRelAccount: r.devrel_account,
          daoHicVoters: r.daohic_voters ? JSON.parse(r.daohic_voters) : [],
          daoHicIndividualVotes: r.daohic_individual_votes ? JSON.parse(r.daohic_individual_votes) : {},
          projects: r.projects ? JSON.parse(r.projects) : []
        }));

      if (prevRounds.length > 0) {
        apiSnapshot.prevRounds = prevRounds;
      }

      return apiSnapshot;
    });
  }

  return {
    upsertSnapshot,
    getSnapshot,
    getAllSnapshots,
    getSnapshotsByChain,
    getAllRounds,
    deleteOldSnapshots,
    toAPI,
    getSnapshotAPI,
    getAllSnapshotsAPI
  };
}
