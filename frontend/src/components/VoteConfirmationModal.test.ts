import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import VoteConfirmationModal from './VoteConfirmationModal.svelte';
import type { ParticipantRole } from '~/interfaces';

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    projectName: 'Example Project',
    projectAddress: '0x1111111111111111111111111111111111111111',
    votingRole: 'community' as ParticipantRole,
    hasVotedForProject: false,
    hasBadge: false,
    executeMint: vi.fn(async () => undefined),
    refreshBadges: vi.fn(async () => undefined),
    tokenSymbol: 'TSYS',
    isPending: false,
    pendingAction: null,
    ...overrides,
  };
}

describe('VoteConfirmationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('prevents negative donation amounts and keeps the free mint label', async () => {
    const executeMint = vi.fn(async () => undefined);

    render(VoteConfirmationModal, {
      props: createProps({ executeMint }),
    });

    const amountInput = screen.getByLabelText('Optional donation amount (TSYS)') as HTMLInputElement;
    await fireEvent.input(amountInput, { target: { value: '-5' } });

    expect(amountInput.value).toBe('0');
    expect(screen.getByRole('button', { name: 'Mint Badge for Free' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Mint Badge for Free' }));
    expect(executeMint).toHaveBeenCalledWith('community', expect.any(Function), '');
  });

  it('updates the mint button label when the donation amount is greater than zero', async () => {
    render(VoteConfirmationModal, {
      props: createProps(),
    });

    const amountInput = screen.getByLabelText('Optional donation amount (TSYS)') as HTMLInputElement;
    await fireEvent.input(amountInput, { target: { value: '1.25' } });

    expect(screen.queryByRole('button', { name: 'Mint Badge for Free' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mint Badge + Donate 1.25 TSYS' })).toBeTruthy();
  });
});
