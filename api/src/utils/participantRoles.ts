export type CanonicalParticipantRole = 'community' | 'dao_hic' | 'smt' | 'project';

const ROLE_MAP: Record<string, CanonicalParticipantRole> = {
  community: 'community',
  smt: 'smt',
  devrel: 'smt',
  daohic: 'dao_hic',
  project: 'project',
};

export function normalizeParticipantRole(rawRole: string): CanonicalParticipantRole | null {
  const key = rawRole.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return ROLE_MAP[key] ?? null;
}
