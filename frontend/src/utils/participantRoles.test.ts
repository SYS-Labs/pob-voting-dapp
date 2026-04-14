import { describe, expect, it } from 'vitest';
import { normalizeParticipantRole } from './participantRoles';

describe('normalizeParticipantRole', () => {
  it('maps legacy and canonical entity-0 labels to smt', () => {
    expect(normalizeParticipantRole('SMT')).toBe('smt');
    expect(normalizeParticipantRole('DevRel')).toBe('smt');
  });

  it('maps DAO-HIC variants to dao_hic', () => {
    expect(normalizeParticipantRole('DAO-HIC')).toBe('dao_hic');
    expect(normalizeParticipantRole('dao_hic')).toBe('dao_hic');
    expect(normalizeParticipantRole('DAO HIC')).toBe('dao_hic');
  });

  it('maps the remaining canonical roles directly', () => {
    expect(normalizeParticipantRole('Community')).toBe('community');
    expect(normalizeParticipantRole('Project')).toBe('project');
  });

  it('returns null for unknown roles', () => {
    expect(normalizeParticipantRole('Organizer')).toBeNull();
  });
});
