import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createIterationsDatabase } from '../../src/db/iterations.js';

describe('Iterations Database - SMT voters', () => {
  let db: Database.Database;
  let iterationsDb: ReturnType<typeof createIterationsDatabase>;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = path.join(process.cwd(), 'src/db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    iterationsDb = createIterationsDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  it('includes smtVoters in API snapshots', () => {
    iterationsDb.upsertSnapshot({
      iteration_id: 3,
      chain_id: 5700,
      round: 1,
      registry_address: '0x1111111111111111111111111111111111111111',
      pob_address: '0x2222222222222222222222222222222222222222',
      jury_address: '0x3333333333333333333333333333333333333333',
      deploy_block_hint: 123,
      round_version: 4,
      jury_state: 'active',
      start_time: 100,
      end_time: 200,
      voting_mode: 0,
      projects_locked: 1,
      contract_locked: 0,
      winner_address: null,
      has_winner: 0,
      devrel_vote: null,
      daohic_vote: null,
      community_vote: null,
      project_scores: null,
      devrel_count: 1,
      daohic_count: 2,
      community_count: 3,
      devrel_account: null,
      smt_voters: JSON.stringify([
        '0xe77065D802b460CF32caA448558cD398dEe9e9ea',
        '0x4444444444444444444444444444444444444444',
      ]),
      daohic_voters: JSON.stringify(['0x5555555555555555555555555555555555555555']),
      daohic_individual_votes: JSON.stringify({}),
      projects: JSON.stringify([]),
      last_block: 999,
      last_updated_at: 1111,
    });

    const snapshot = iterationsDb.getSnapshotAPI(5700, 3);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.version).toBe('004');
    expect(snapshot?.smtVoters).toEqual([
      '0xe77065D802b460CF32caA448558cD398dEe9e9ea',
      '0x4444444444444444444444444444444444444444',
    ]);
  });

  it('includes previous rounds in iteration detail snapshots', () => {
    iterationsDb.upsertSnapshot({
      iteration_id: 1,
      chain_id: 5700,
      round: 1,
      registry_address: '0x1111111111111111111111111111111111111111',
      pob_address: '0x2222222222222222222222222222222222222222',
      jury_address: '0x3333333333333333333333333333333333333333',
      deploy_block_hint: 123,
      round_version: 4,
      jury_state: 'locked',
      start_time: 100,
      end_time: 200,
      voting_mode: 0,
      projects_locked: 1,
      contract_locked: 1,
      winner_address: null,
      has_winner: 0,
      devrel_vote: '0x4444444444444444444444444444444444444444',
      daohic_vote: null,
      community_vote: '0x5555555555555555555555555555555555555555',
      project_scores: null,
      devrel_count: 1,
      daohic_count: 2,
      community_count: 3,
      devrel_account: null,
      smt_voters: JSON.stringify(['0xe77065D802b460CF32caA448558cD398dEe9e9ea']),
      daohic_voters: JSON.stringify(['0x6666666666666666666666666666666666666666']),
      daohic_individual_votes: JSON.stringify({
        '0x6666666666666666666666666666666666666666': '0x7777777777777777777777777777777777777777',
      }),
      projects: JSON.stringify([{ address: '0x8888888888888888888888888888888888888888', metadataCID: null, metadata: null }]),
      last_block: 999,
      last_updated_at: 1111,
    });

    iterationsDb.upsertSnapshot({
      iteration_id: 1,
      chain_id: 5700,
      round: 2,
      registry_address: '0x1111111111111111111111111111111111111111',
      pob_address: '0x9999999999999999999999999999999999999999',
      jury_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      deploy_block_hint: 456,
      round_version: 4,
      jury_state: 'locked',
      start_time: 300,
      end_time: 400,
      voting_mode: 1,
      projects_locked: 1,
      contract_locked: 1,
      winner_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      has_winner: 1,
      devrel_vote: null,
      daohic_vote: '0xcccccccccccccccccccccccccccccccccccccccc',
      community_vote: '0xdddddddddddddddddddddddddddddddddddddddd',
      project_scores: null,
      devrel_count: 0,
      daohic_count: 2,
      community_count: 6,
      devrel_account: null,
      smt_voters: JSON.stringify(['0xe77065D802b460CF32caA448558cD398dEe9e9ea']),
      daohic_voters: JSON.stringify(['0x6666666666666666666666666666666666666666']),
      daohic_individual_votes: JSON.stringify({}),
      projects: JSON.stringify([]),
      last_block: 1000,
      last_updated_at: 2222,
    });

    const snapshot = iterationsDb.getSnapshotAPI(5700, 1);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.round).toBe(2);
    expect(snapshot?.prevRounds).toEqual([
      {
        round: 1,
        jurySC: '0x3333333333333333333333333333333333333333',
        pob: '0x2222222222222222222222222222222222222222',
        version: '004',
        deployBlockHint: 123,
        votingMode: 0,
        juryState: 'locked',
        winner: {
          projectAddress: null,
          hasWinner: false,
        },
        entityVotes: {
          devRel: '0x4444444444444444444444444444444444444444',
          daoHic: null,
          community: '0x5555555555555555555555555555555555555555',
        },
        devRelAccount: null,
        smtVoters: ['0xe77065D802b460CF32caA448558cD398dEe9e9ea'],
        daoHicVoters: ['0x6666666666666666666666666666666666666666'],
        daoHicIndividualVotes: {
          '0x6666666666666666666666666666666666666666': '0x7777777777777777777777777777777777777777',
        },
        projects: [{ address: '0x8888888888888888888888888888888888888888', metadataCID: null, metadata: null }],
      },
    ]);
  });

  it('adds the smt_voters column for existing databases', () => {
    const legacyDb = new Database(':memory:');
    legacyDb.exec(`
      CREATE TABLE iteration_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        iteration_id INTEGER NOT NULL,
        chain_id INTEGER NOT NULL,
        round INTEGER NOT NULL,
        registry_address TEXT NOT NULL,
        pob_address TEXT NOT NULL,
        jury_address TEXT NOT NULL,
        deploy_block_hint INTEGER NOT NULL DEFAULT 0,
        jury_state TEXT NOT NULL,
        start_time INTEGER,
        end_time INTEGER,
        voting_mode INTEGER NOT NULL DEFAULT 0,
        projects_locked INTEGER NOT NULL DEFAULT 0,
        contract_locked INTEGER NOT NULL DEFAULT 0,
        winner_address TEXT,
        has_winner INTEGER NOT NULL DEFAULT 0,
        devrel_vote TEXT,
        daohic_vote TEXT,
        community_vote TEXT,
        project_scores TEXT,
        devrel_count INTEGER NOT NULL DEFAULT 0,
        daohic_count INTEGER NOT NULL DEFAULT 0,
        community_count INTEGER NOT NULL DEFAULT 0,
        devrel_account TEXT,
        daohic_voters TEXT,
        daohic_individual_votes TEXT,
        projects TEXT,
        last_block INTEGER NOT NULL,
        last_updated_at INTEGER NOT NULL,
        UNIQUE(chain_id, iteration_id, round)
      );
    `);

    createIterationsDatabase(legacyDb);

    const columns = legacyDb.prepare(`PRAGMA table_info(iteration_snapshots)`).all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'round_version')).toBe(true);
    expect(columns.some((column) => column.name === 'smt_voters')).toBe(true);

    legacyDb.close();
  });
});
