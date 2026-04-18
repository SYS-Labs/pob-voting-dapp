import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Iteration, Project } from '~/interfaces';

vi.mock('svelte-routing', async () => ({
  Link: (await import('~/test/LinkStub.svelte')).default,
  navigate: vi.fn(),
}));

vi.mock('~/components/MarkdownRenderer.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/VoteConfirmationModal.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/components/ProgressSpinner.svelte', async () => ({
  default: (await import('~/test/ComponentStub.svelte')).default,
}));

vi.mock('~/stores/registryStatus', () => ({
  createRegistryStatusStore: vi.fn(() => ({
    registryAvailable: false,
    initializationComplete: {
      subscribe: (callback: (value: boolean | null) => void) => {
        callback(null);
        return () => {};
      },
    },
    registryOwner: {
      subscribe: (callback: (value: string | null) => void) => {
        callback(null);
        return () => {};
      },
    },
    destroy: () => {},
  })),
}));

vi.mock('~/stores/projectMetadataManager', () => ({
  createProjectMetadataManager: vi.fn(() => ({
    subscribe: (callback: (value: {
      currentCID: string | null;
      currentTxHash: string | null;
      pendingCID: string | null;
      pendingTxHash: string | null;
      pendingConfirmations: number;
      metadata: Project['metadata'] | null;
    }) => void) => {
      callback({
        currentCID: null,
        currentTxHash: null,
        pendingCID: null,
        pendingTxHash: null,
        pendingConfirmations: 0,
        metadata: null,
      });
      return () => {};
    },
    destroy: () => {},
  })),
}));

import ProjectPage from './ProjectPage.svelte';

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
    projectAddress: projects[0].address,
    currentIteration,
    projects,
    loading: false,
    roles: { community: false, smt: false, dao_hic: false, project: false },
    isOwner: false,
    projectsLocked: false,
    statusFlags: { isActive: true, votingEnded: false },
    communityBadges: [],
    badges: [],
    smtVote: null,
    daoHicVote: null,
    pendingAction: null,
    walletAddress: null,
    chainId: 57,
    signer: null,
    getProjectLabel: (address: string | null) => address,
    executeMint: vi.fn(async () => undefined),
    executeVote: vi.fn(),
    refreshVotingData: vi.fn(async () => undefined),
    refreshBadges: vi.fn(async () => undefined),
    onConnect: vi.fn(),
    ...overrides,
  };
}

describe('ProjectPage voting button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    });
  });

  it('shows the vote button for disconnected users during active voting and connects on click', async () => {
    const onConnect = vi.fn();

    render(ProjectPage, {
      props: createProps({ onConnect }),
    });

    expect(screen.queryByText(/Connect your wallet to vote for/i)).toBeNull();

    const voteButton = screen.getByRole('button', { name: 'Vote' });
    await fireEvent.click(voteButton);

    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('shows the vote action instead of the connect wallet CTA for connected users', () => {
    render(ProjectPage, {
      props: createProps({ walletAddress: '0x4444444444444444444444444444444444444444' }),
    });

    expect(screen.queryByRole('button', { name: 'Connect Wallet' })).toBeNull();
    expect(screen.queryByText(/Connect your wallet to vote for/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Vote' })).toBeTruthy();
  });

  it('hides the vote action when voting has ended', () => {
    render(ProjectPage, {
      props: createProps({ statusFlags: { isActive: false, votingEnded: true } }),
    });

    expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull();
  });
});
