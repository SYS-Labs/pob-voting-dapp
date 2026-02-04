import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import IterationCard from './IterationCard.svelte';
import type { Iteration } from '~/interfaces';

// Mock the metadata API
vi.mock('~/utils/metadata-api', () => ({
  metadataAPI: {
    getIterationMetadata: vi.fn().mockResolvedValue(null),
  },
}));

// Mock svelte-routing
vi.mock('svelte-routing', () => ({
  Link: {
    $$render: () => '',
  },
}));

describe('IterationCard', () => {
  const mockIteration: Iteration = {
    iteration: 3,
    name: 'Test Iteration',
    jurySC: '0x1234567890abcdef1234567890abcdef12345678',
    pob: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    chainId: 57,
    version: '001',
  };

  it('renders iteration name', () => {
    const { getByText } = render(IterationCard, {
      props: {
        iteration: mockIteration,
        isActive: false,
        disableLink: true,
      },
    });
    expect(getByText('Test Iteration')).toBeTruthy();
  });

  it('renders iteration number', () => {
    const { getByText } = render(IterationCard, {
      props: {
        iteration: mockIteration,
        isActive: false,
        disableLink: true,
      },
    });
    expect(getByText('Iteration #3')).toBeTruthy();
  });

  it('renders iteration with round number when provided', () => {
    const iterationWithRound = { ...mockIteration, round: 2 };
    const { getByText } = render(IterationCard, {
      props: {
        iteration: iterationWithRound,
        isActive: false,
        disableLink: true,
      },
    });
    expect(getByText('Iteration #3 - Round #2')).toBeTruthy();
  });

  it('shows "Round not registered yet" when no round', () => {
    const { getByText } = render(IterationCard, {
      props: {
        iteration: mockIteration,
        isActive: false,
        disableLink: true,
      },
    });
    expect(getByText('Round not registered yet.')).toBeTruthy();
  });

  it('does not show "Round not registered yet" when round is present', () => {
    const iterationWithRound = { ...mockIteration, round: 1 };
    const { queryByText } = render(IterationCard, {
      props: {
        iteration: iterationWithRound,
        isActive: false,
        disableLink: true,
      },
    });
    expect(queryByText('Round not registered yet.')).toBeFalsy();
  });

  it('renders status badge when provided', () => {
    const { getByText } = render(IterationCard, {
      props: {
        iteration: mockIteration,
        isActive: false,
        disableLink: true,
        statusBadge: { label: 'Active', color: 'pob-pill--active' },
      },
    });
    expect(getByText('Active')).toBeTruthy();
  });

  it('renders Add round button when onAddRound is provided', () => {
    const onAddRound = vi.fn();
    const { getByText } = render(IterationCard, {
      props: {
        iteration: mockIteration,
        isActive: false,
        disableLink: true,
        onAddRound,
      },
    });
    expect(getByText('Add round')).toBeTruthy();
  });

  it('calls onAddRound when Add round button is clicked', async () => {
    const onAddRound = vi.fn();
    const { getByText } = render(IterationCard, {
      props: {
        iteration: mockIteration,
        isActive: false,
        disableLink: true,
        onAddRound,
      },
    });
    await fireEvent.click(getByText('Add round'));
    expect(onAddRound).toHaveBeenCalled();
  });

  it('applies active styling when isActive is true', () => {
    const { container } = render(IterationCard, {
      props: {
        iteration: mockIteration,
        isActive: true,
        disableLink: true,
      },
    });
    const card = container.querySelector('.pob-pane');
    expect(card?.classList.contains('shadow-[0_0_22px_rgba(247,147,26,0.35)]')).toBe(true);
  });
});
