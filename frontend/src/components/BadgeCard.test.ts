import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import BadgeCard from './BadgeCard.svelte';
import type { Badge } from '~/interfaces';

describe('BadgeCard', () => {
  const mockBadge: Badge = {
    tokenId: '42',
    role: 'community',
    iteration: 3,
  };

  it('renders badge with iteration number', () => {
    const { getByText } = render(BadgeCard, { props: { badge: mockBadge } });
    expect(getByText('Iteration 3')).toBeTruthy();
  });

  it('renders badge with round number when provided', () => {
    const badgeWithRound: Badge = { ...mockBadge, round: 2 };
    const { getByText } = render(BadgeCard, { props: { badge: badgeWithRound } });
    expect(getByText('Iteration 3 - Round #2')).toBeTruthy();
  });

  it('renders token ID', () => {
    const { getByText } = render(BadgeCard, { props: { badge: mockBadge } });
    expect(getByText('#42')).toBeTruthy();
  });

  it('renders role label for community', () => {
    const { getByText } = render(BadgeCard, { props: { badge: mockBadge } });
    expect(getByText('Community')).toBeTruthy();
  });

  it('renders role label for devrel', () => {
    const devrelBadge: Badge = { ...mockBadge, role: 'devrel' };
    const { getByText } = render(BadgeCard, { props: { badge: devrelBadge } });
    expect(getByText('DevRel')).toBeTruthy();
  });

  it('renders role label for dao_hic', () => {
    const daoHicBadge: Badge = { ...mockBadge, role: 'dao_hic' };
    const { getByText } = render(BadgeCard, { props: { badge: daoHicBadge } });
    expect(getByText('DAO HIC')).toBeTruthy();
  });

  it('renders role label for project', () => {
    const projectBadge: Badge = { ...mockBadge, role: 'project' };
    const { getByText } = render(BadgeCard, { props: { badge: projectBadge } });
    expect(getByText('Project')).toBeTruthy();
  });

  it('renders medal emoji', () => {
    const { container } = render(BadgeCard, { props: { badge: mockBadge } });
    expect(container.textContent).toContain('🏅');
  });
});
