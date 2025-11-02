import type { Badge } from '~/interfaces';

export type IterationStatus = 'upcoming' | 'active' | 'ended';

export interface EntityVotes {
  devRel: string | null;
  daoHic: string | null;
  community: string | null;
}

export interface RoleStatuses {
  community: boolean;
  devrel: boolean;
  dao_hic: boolean;
  project: boolean;
}

export interface CommunityBadgeState extends Badge {
  hasVoted: boolean;
  vote: string | null;
}
