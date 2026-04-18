import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Iteration, Project } from '~/interfaces';

vi.mock('svelte-routing', async () => ({
  Link: (await import('~/test/LinkStub.svelte')).default,
}));

vi.mock('~/components/IterationHeader.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/PreviousRoundCard.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/OwnerPanel.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/JuryPanel.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/ParticipantPanel.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/BadgePanel.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/DateTimePanel.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/ToolboxCard.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/ProgressSpinner.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/Modal.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/VoteConfirmationModal.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/utils/iterations-api', () => ({
  iterationsAPI: {
    getUserIterationBadgeStatus: vi.fn(),
  },
}));

import IterationPage from './IterationPage.svelte';

const currentIteration: Iteration = {
  iteration: 1,
  round: 1,
  name: 'Iteration One',
  jurySC: '0x1111111111111111111111111111111111111111',
  pob: '0x2222222222222222222222222222222222222222',
  chainId: 57,
  version: '004',
};

const projects: Project[] = [
  {
    id: 1,
    address: '0x3333333333333333333333333333333333333333',
    metadata: {
      chainId: 57,
      account: '0x3333333333333333333333333333333333333333',
      name: 'Example Project',
      description: 'Example description',
    },
  },
];

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    currentIteration,
    statusBadge: { label: 'Active', color: 'pob-pill--active' },
    iterationTimes: { startTime: null, endTime: null },
    projects,
    shuffledProjects: projects,
    loading: false,
    roles: { community: false, smt: false, dao_hic: false, project: false },
    rolesLoading: false,
    isOwner: false,
    statusFlags: { isActive: true, votingEnded: false },
    communityBadges: [],
    badges: [],
    smtVote: null,
    daoHicVote: null,
    entityVotes: { smt: null, daoHic: null, community: null },
    pendingAction: null,
    walletAddress: null,
    chainId: 57,
    projectsLocked: false,
    contractLocked: false,
    smtVoters: [],
    daoHicVoters: [],
    daoHicIndividualVotes: {},
    winner: { projectAddress: null, hasWinner: false },
    voteCounts: { smt: 0, daoHic: 0, community: 0 },
    totalCommunityVoters: 0,
    votingMode: 0,
    projectScores: null,
    openAdminSection: null,
    signer: null,
    publicProvider: null,
    getProjectLabel: (address: string | null) => address,
    executeMint: vi.fn(async () => undefined),
    executeVote: vi.fn(),
    handleToggleAdminSection: vi.fn(),
    runTransaction: vi.fn(async () => true),
    refreshVotingData: vi.fn(async () => undefined),
    refreshProjects: vi.fn(async () => undefined),
    refreshOwnerData: vi.fn(async () => undefined),
    refreshBadges: vi.fn(async () => undefined),
    setPendingRemovalProject: vi.fn(),
    setPendingRemovalVoter: vi.fn(),
    setError: vi.fn(),
    setVotingMode: vi.fn(async () => undefined),
    onOpenDisconnect: vi.fn(),
    onConnect: vi.fn(),
    ...overrides,
  };
}

describe('IterationPage voting button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    });
  });

  it('shows the vote button when voting is active and connects on click for disconnected users', async () => {
    const onConnect = vi.fn();

    render(IterationPage, {
      props: createProps({ onConnect }),
    });

    expect(screen.queryByText('Voting is open. Connect your wallet to vote on any project.')).toBeNull();

    const voteButtons = screen.getAllByRole('button', { name: 'VOTE' });
    expect(voteButtons).toHaveLength(1);

    await fireEvent.click(voteButtons[0]);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the project vote button visible without disconnected prompt copy when a wallet is connected', () => {
    render(IterationPage, {
      props: createProps({ walletAddress: '0x4444444444444444444444444444444444444444' }),
    });

    expect(screen.queryByText('Voting is open. Connect your wallet to vote on any project.')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'VOTE' })).toHaveLength(1);
  });

  it('hides the project vote button when voting is not active', () => {
    render(IterationPage, {
      props: createProps({ statusFlags: { isActive: false, votingEnded: false } }),
    });

    expect(screen.queryByText('Voting is open. Connect your wallet to vote on any project.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'VOTE' })).toBeNull();
  });
});
