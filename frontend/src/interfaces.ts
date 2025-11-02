export type IterationStatus = 'upcoming' | 'active' | 'ended';

export interface Iteration {
  iteration: number;
  name: string;
  jurySC: string;
  pob: string;
  chainId: number;
  deployBlockHint?: number;
  link?: string;
  status?: IterationStatus; // Optional: if set in JSON, overrides contract state
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
  claimed?: boolean;
}
