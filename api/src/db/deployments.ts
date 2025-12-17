import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger.js';

export interface DeploymentRecord {
  id: number;
  contract_address: string;
  created_by: string;
  signature: string | null;
  message: string | null;
  created_at: string;
}

export class DeploymentDatabase {
  constructor(private db: Database.Database) {}

  /**
   * Store a deployment record and return it
   */
  createDeployment(params: {
    createdBy: string;
    signature?: string;
    message?: string;
  }): DeploymentRecord {
    const contractAddress = this.generateMockAddress();

    const stmt = this.db.prepare(
      `INSERT INTO deployments (contract_address, created_by, signature, message)
       VALUES (@contract_address, @created_by, @signature, @message)`
    );

    const result = stmt.run({
      contract_address: contractAddress,
      created_by: params.createdBy,
      signature: params.signature || null,
      message: params.message || null
    });

    logger.info('Stored deployment record', {
      contractAddress,
      createdBy: params.createdBy
    });

    return {
      id: Number(result.lastInsertRowid),
      contract_address: contractAddress,
      created_by: params.createdBy,
      signature: params.signature || null,
      message: params.message || null,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Retrieve recent deployments
   */
  listDeployments(limit: number = 25): DeploymentRecord[] {
    const stmt = this.db.prepare(
      `SELECT * FROM deployments
       ORDER BY created_at DESC
       LIMIT ?`
    );
    return stmt.all(limit) as DeploymentRecord[];
  }

  /**
   * Mock a contract address by generating 20 random bytes
   */
  private generateMockAddress(): string {
    return `0x${randomBytes(20).toString('hex')}`;
  }
}

export function createDeploymentDatabase(db: Database.Database): DeploymentDatabase {
  return new DeploymentDatabase(db);
}
