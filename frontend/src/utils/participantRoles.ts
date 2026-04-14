import type { ParticipantRole } from '~/interfaces';

const ROLE_MAP: Record<string, ParticipantRole> = {
  community: 'community',
  smt: 'smt',
  devrel: 'smt',
  daohic: 'dao_hic',
  project: 'project',
};

export function normalizeParticipantRole(rawRole: string): ParticipantRole | null {
  const key = rawRole.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return ROLE_MAP[key] ?? null;
}
