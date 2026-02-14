export type IterationStatus = 'upcoming' | 'active' | 'ended';

export type PageType = 'iterations' | 'iteration' | 'project' | 'badges' | 'certs' | 'profile' | 'faq' | 'forum';

export interface PreviousRound {
  round: number;
  jurySC: string;
  pob: string;
  version: string; // Contract version: "001", "002", etc. (mandatory)
  deployBlockHint?: number;
  votingMode?: number; // Optional: if set, overrides contract votingMode() call (0=CONSENSUS, 1=WEIGHTED)
  // Full round data from API (optional - populated when available from indexer)
  juryState?: 'deployed' | 'activated' | 'active' | 'ended' | 'locked';
  winner?: { projectAddress: string | null; hasWinner: boolean };
  entityVotes?: { devRel: string | null; daoHic: string | null; community: string | null };
  // Role eligibility data from API (used for badge minting)
  devRelAccount?: string | null;
  daoHicVoters?: string[];
  daoHicIndividualVotes?: Record<string, string>;
  projects?: { address: string; metadataCID: string | null; metadata: Record<string, unknown> | null }[];
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

export interface ProjectSocials {
  x?: string; // X (formerly Twitter)
  instagram?: string;
  tiktok?: string;
  linkedin?: string;
}

export interface ProjectMetadata {
  chainId: number;
  account: string;
  name?: string;
  description?: string;
  yt_vid?: string;
  proposal?: string;
  socials?: ProjectSocials;
  txHash?: string; // Transaction hash when this metadata was set on-chain
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

export interface CommunityBadge {
  tokenId: string;
  hasVoted: boolean;
  vote: string | null;
  claimed?: boolean;
  iteration: number;
  round?: number;
}

export interface RoleStatuses {
  community: boolean;
  devrel: boolean;
  dao_hic: boolean;
  project: boolean;
}

export interface StatusFlags {
  isActive: boolean;
  votingEnded: boolean;
}

/**
 * Iteration metadata stored on IPFS
 * This is the full metadata for an iteration, including previous rounds
 */
export interface IterationMetadata {
  iteration: number;
  round: number;
  name: string;
  description?: string; // Round description/details
  chainId: number;
  votingMode: number; // 0 = CONSENSUS, 1 = WEIGHTED
  link?: string; // Social media link (Twitter, etc.)
  txHash?: string; // Transaction hash when this metadata was set on-chain
  prev_rounds?: Array<{
    round: number;
    jurySC: string;
    pob: string;
    version: string;
    deployBlockHint: number;
    votingMode: number;
    metadataCID?: string; // CID of previous round metadata
  }>;
}

// ========== Certificate Types ==========

export type CertType = 'participant' | 'winner' | 'organizer' | 'speaker' | string;

export type CertStatus = 'Pending' | 'Minted' | 'Cancelled';

export interface Cert {
  tokenId: string;
  iteration: number;
  account: string;
  certType: CertType;
  infoCID: string;
  status: CertStatus;
  requestTime: number; // Unix timestamp
}

export interface CertEligibility {
  eligible: boolean;
  certType: CertType;
}

// ========== Team Member Types ==========

export type MemberStatus = 'Proposed' | 'Approved' | 'Rejected';

export interface TeamMember {
  memberAddress: string;
  status: MemberStatus;
  fullName: string;
}

// ========== Profile Types ==========

export interface UserProfile {
  address: string;
  pictureCID: string;
  bioCID: string;
}

export interface ProfileBio {
  name?: string;
  bio?: string;
}
