export type IterationStatus = 'upcoming' | 'active' | 'ended';

export interface PreviousRound {
  round: number;
  jurySC: string;
  pob: string;
  version: string; // Contract version: "001", "002", etc. (mandatory)
  deployBlockHint?: number;
  votingMode?: number; // Optional: if set, overrides contract votingMode() call (0=CONSENSUS, 1=WEIGHTED)
}

export interface Iteration {
  iteration: number;
  round?: number; // Current round number (optional)
  name: string;
  jurySC: string;
  pob: string;
  chainId: number;
  version: string; // Contract version: "001", "002", etc. (mandatory)
  deployBlockHint?: number;
  link?: string;
  status?: IterationStatus; // Optional: if set in JSON, overrides contract state
  votingMode?: number; // Optional: if set, overrides contract votingMode() call (0=CONSENSUS, 1=WEIGHTED)
  prev_rounds?: PreviousRound[]; // Array of previous voting rounds for this iteration
}

export type ParticipantRole = 'community' | 'devrel' | 'dao_hic' | 'project';

export interface ProjectMetadata {
  chainId: number;
  account: string;
  name?: string;
  description?: string;
  yt_vid?: string;
  proposal?: string;
}

export interface Project {
  id: number;
  address: string;
  metadata?: ProjectMetadata;
}

export interface Badge {
  tokenId: string;
  role: ParticipantRole;
  iteration: number;
  round?: number; // Round number within the iteration (optional)
  claimed?: boolean;
}
