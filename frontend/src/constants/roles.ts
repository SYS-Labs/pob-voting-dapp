import type { ParticipantRole } from '~/interfaces';

export const ROLE_LABELS: Record<ParticipantRole, string> = {
  community: 'Community',
  devrel: 'DevRel',
  dao_hic: 'DAO HIC',
  project: 'Project',
};

export const ROLE_COLORS: Record<ParticipantRole, string> = {
  community: 'border border-[rgba(247,147,26,0.45)] bg-[rgba(247,147,26,0.12)] text-[var(--pob-primary)]',
  devrel: 'border border-[rgba(247,147,26,0.4)] bg-[rgba(247,147,26,0.1)] text-[var(--pob-primary)]',
  dao_hic: 'border border-[rgba(247,147,26,0.35)] bg-[rgba(247,147,26,0.08)] text-[var(--pob-primary)]',
  project: 'border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] text-[var(--pob-text-muted)]',
};
