/**
 * IterationsAPI - Client for interacting with the iterations API
 *
 * This utility fetches iteration snapshots from the API indexer,
 * providing a faster alternative to direct RPC calls.
 */

export type JuryState = 'deployed' | 'activated' | 'active' | 'ended' | 'locked';

export interface ProjectSnapshot {
  address: string;
  metadataCID: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PreviousRoundSnapshot {
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

export interface IterationSnapshot {
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
  prevRounds?: PreviousRoundSnapshot[];
}

function getApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
  return envBaseUrl ? `${envBaseUrl}/api` : '/api';
}

export class IterationsAPI {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getApiBaseUrl();
  }

  /**
   * Fetch all iteration snapshots
   */
  async getAllIterations(): Promise<IterationSnapshot[]> {
    const response = await fetch(`${this.baseUrl}/iterations`);

    if (!response.ok) {
      throw new Error(`Failed to fetch iterations: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.iterations || [];
  }

  /**
   * Fetch a single iteration snapshot
   */
  async getIteration(chainId: number, iterationId: number): Promise<IterationSnapshot | null> {
    const response = await fetch(`${this.baseUrl}/iterations/${chainId}/${iterationId}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch iteration: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.iteration || null;
  }

  /**
   * Check if the API is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace('/api', '')}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const iterationsAPI = new IterationsAPI();
