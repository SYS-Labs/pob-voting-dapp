<script lang="ts">
  import type { Iteration, ParticipantRole, Badge, IterationMetadata } from '~/interfaces';
  import { formatDate } from '~/utils';
  import FinalResultsPanel from './FinalResultsPanel.svelte';
  import ContractAddress from './ContractAddress.svelte';
  import MarkdownRenderer from './MarkdownRenderer.svelte';
  import { Link } from 'svelte-routing';
  import { getPublicProvider } from '~/utils/provider';
  import { getResolvedIterationMetadata } from '~/utils/iterationMetadata';

  interface RoleStatuses {
    community: boolean;
    smt: boolean;
    dao_hic: boolean;
    project: boolean;
  }

  interface Props {
    iteration: Iteration | null;
    statusBadge: { label: string; color: string };
    iterationTimes: { startTime: number | null; endTime: number | null };
    votingEnded?: boolean;
    projectsLocked?: boolean;
    winner?: { projectAddress: string | null; hasWinner: boolean };
    entityVotes?: { smt: string | null; daoHic: string | null; community: string | null };
    daoHicIndividualVotes?: Record<string, string>;
    getProjectLabel?: (address: string | null) => string | null;
    isOwner?: boolean;
    walletAddress?: string | null;
    chainId?: number | null;
    hasMintedStatus?: boolean | null;
    pendingAction?: string | null;
    roles?: RoleStatuses;
    badges?: Badge[];
    executeMint?: (role: ParticipantRole, refreshCallback?: () => Promise<void>, communityAmount?: string) => Promise<void>;
    refreshBadges?: () => Promise<void>;
    votingMode?: number;
    projects?: { id: number; address: string; metadata?: any }[];
    projectScores?: { addresses: string[]; scores: string[]; totalPossible: string } | null;
    onConnect?: () => void;
  }

  interface ActionGuide {
    title: string;
    body: string;
    action: 'connect' | 'projects' | 'manage' | 'mint' | 'results' | null;
    cta?: string;
  }

  let {
    iteration,
    statusBadge,
    iterationTimes,
    votingEnded,
    projectsLocked,
    winner,
    entityVotes,
    daoHicIndividualVotes,
    getProjectLabel,
    isOwner = false,
    walletAddress,
    hasMintedStatus = null,
    pendingAction,
    roles,
    badges,
    executeMint,
    refreshBadges,
    votingMode = 0,
    projects = [],
    projectScores = null,
    onConnect,
  }: Props = $props();

  let metadata = $state<IterationMetadata | null>(null);

  // Load iteration metadata
  $effect(() => {
    if (!iteration) {
      metadata = null;
      return;
    }

    let cancelled = false;
    const currentIteration = iteration;
    const provider = getPublicProvider(currentIteration.chainId);

    const loadMetadata = async () => {
      try {
        const data = await getResolvedIterationMetadata(
          currentIteration.chainId,
          currentIteration.jurySC,
          provider
        );
        if (!cancelled) metadata = data;
      } catch (error) {
        console.error('Failed to load iteration metadata:', error);
        if (!cancelled) metadata = null;
      }
    };

    void loadMetadata();

    return () => {
      cancelled = true;
    };
  });

  // Determine user's role and mint button visibility
  let hasSmtBadge = $derived((badges?.some(badge => badge.role === 'smt') ?? false) || (roles?.smt && hasMintedStatus === true));
  let hasDaoHicBadge = $derived((badges?.some(badge => badge.role === 'dao_hic') ?? false) || (roles?.dao_hic && hasMintedStatus === true));
  let hasProjectBadge = $derived((badges?.some(badge => badge.role === 'project') ?? false) || (roles?.project && hasMintedStatus === true));

  // Has the user already minted their non-community badge?
  let hasMintedBadge = $derived(
    (roles?.smt && hasSmtBadge) ||
    (roles?.dao_hic && hasDaoHicBadge) ||
    (roles?.project && hasProjectBadge)
  );

  // Determine which mint button to show (non-community roles only)
  let mintButtonType = $derived.by((): 'smt' | 'dao_hic' | 'project' | null => {
    if (!walletAddress || !executeMint || isOwner) return null;

    if (roles?.smt && !hasSmtBadge && votingEnded) return 'smt';
    if (roles?.dao_hic && !hasDaoHicBadge && votingEnded) return 'dao_hic';
    if (roles?.project && !hasProjectBadge && projectsLocked) return 'project';

    return null;
  });

  // Show the action row?
  let showActionRow = $derived(
    iteration && (iteration.link || metadata?.link || isOwner)
  );

  let isActiveRound = $derived(statusBadge.label === 'Active' && !votingEnded);
  let isUpcomingRound = $derived(statusBadge.label === 'Upcoming');
  let hasCommunityBadge = $derived(badges?.some(badge => badge.role === 'community') ?? false);
  let hasAnyBadge = $derived(Boolean((badges?.length ?? 0) > 0 || hasMintedBadge));
  let userRoleLabel = $derived.by(() => {
    if (isOwner) return 'Owner';
    if (roles?.smt) return 'SMT juror';
    if (roles?.dao_hic) return 'DAO HIC juror';
    if (roles?.project) return 'Project';
    if (walletAddress) return 'Community voter';
    return 'Visitor';
  });

  let actionGuide = $derived.by((): ActionGuide => {
    if (!walletAddress) {
      return {
        title: 'Connect to see your next action',
        body: 'Wallet state determines whether you can mint, vote, claim, manage a round, or review recognition.',
        action: 'connect',
        cta: 'Connect wallet',
      };
    }

    if (isOwner) {
      return {
        title: 'Owner workspace',
        body: 'Manage metadata, voters, projects, lifecycle controls, and historical round setup from the admin panels.',
        action: 'manage',
        cta: 'Manage iteration',
      };
    }

    if (mintButtonType) {
      return {
        title: `Mint your ${userRoleLabel} badge`,
        body: 'This role badge preserves your participation after the round state allows minting.',
        action: 'mint',
        cta: 'Mint badge',
      };
    }

    if (isUpcomingRound) {
      return {
        title: 'Round is waiting to start',
        body: 'Activation opens the community minting and voting window. You can review projects and round details now.',
        action: 'projects',
        cta: 'Review projects',
      };
    }

    if (isActiveRound) {
      if (roles?.project) {
        return {
          title: 'Project account detected',
          body: 'Project wallets cannot vote in their own round. Track voting progress and final recognition from here.',
          action: 'projects',
          cta: 'View projects',
        };
      }

      if (roles?.smt || roles?.dao_hic) {
        return {
          title: 'Cast or update your jury vote',
          body: 'Open a project card to submit your vote while the round is active.',
          action: 'projects',
          cta: 'Choose a project',
        };
      }

      if (hasCommunityBadge) {
        return {
          title: 'Use your community badge to vote',
          body: 'Your badge is ready. Pick a project and submit or update your community vote before voting ends.',
          action: 'projects',
          cta: 'Choose a project',
        };
      }

      return {
        title: 'Mint a community badge, then vote',
        body: 'Community voters start from the project cards. The vote flow handles badge minting when needed.',
        action: 'projects',
        cta: 'Start with projects',
      };
    }

    if (votingEnded) {
      return {
        title: winner?.hasWinner ? 'Round results are final' : 'Round ended without a winner',
        body: winner?.hasWinner
          ? 'Review the final result and keep your badge or certificate history connected to your profile.'
          : 'The round remains readable for audit and history even without a winning project.',
        action: 'results',
        cta: 'View results',
      };
    }

    return {
      title: 'Review the round state',
      body: 'Projects, contracts, badges, and timing are available from this workspace.',
      action: 'projects',
      cta: 'View projects',
    };
  });

  let journeySteps = $derived.by(() => [
    {
      label: 'Mint badge',
      state: hasAnyBadge || votingEnded ? 'complete' : isActiveRound ? 'active' : 'idle',
    },
    {
      label: 'Vote',
      state: votingEnded ? 'complete' : isActiveRound ? 'active' : 'idle',
    },
    {
      label: 'Results',
      state: votingEnded ? 'active' : 'idle',
    },
    {
      label: 'Recognition',
      state: votingEnded && hasAnyBadge ? 'active' : 'idle',
    },
  ]);

  function getJourneyStepClass(state: string) {
    if (state === 'complete') return 'pob-journey__step pob-journey__step--complete';
    if (state === 'active') return 'pob-journey__step pob-journey__step--active';
    return 'pob-journey__step';
  }

  function handleMint() {
    if (!executeMint || !mintButtonType) return;
    void executeMint(mintButtonType, refreshBadges);
  }
</script>

{#if !iteration}
  <section class="pob-pane">
    <div>
      <p class="pob-pane__title text-xl">Select a program iteration to get started</p>
    </div>
  </section>
{:else}
  <section class="pob-pane">
    <div class="pob-pane__heading">
      <div>
        <p class="pob-eyebrow pob-eyebrow--muted">Current iteration</p>
        <h2 class="pob-pane__title text-3xl">{metadata?.name || iteration.name}</h2>
        <p class="mt-1 text-sm text-[var(--pob-text-muted)]">
          Iteration #{iteration.iteration}{iteration.round ? ` - Round #${iteration.round}` : ''}
          {#if votingEnded}
            {#if winner?.hasWinner}
              <span class="pob-pill pob-pill--success text-xs">
                {votingMode === 0 ? 'Consensus' : 'Weighted'} ✓
              </span>
            {:else}
              <span class="pob-pill pob-pill--failure text-xs">
                {votingMode === 0 ? 'Consensus' : 'Weighted'} ✗
              </span>
            {/if}
          {:else}
            <span class="pob-pill pob-pill--neutral text-xs">
              {votingMode === 0 ? 'Consensus' : 'Weighted'}
            </span>
          {/if}
        </p>
      </div>
      <div class="flex items-center gap-2">
        {#if hasMintedBadge}
          <span class="pob-pill pob-pill--active">Badge minted</span>
        {/if}
        <span class={statusBadge.color}>{statusBadge.label}</span>
      </div>
    </div>
    <dl class="pob-pane__grid text-sm text-[var(--pob-text-muted)] sm:grid-cols-2">
      {#if statusBadge.label !== 'Upcoming'}
        <div>
          <dt class="pob-label">Start Time</dt>
          <dd>{formatDate(iterationTimes.startTime || undefined)}</dd>
        </div>
        <div>
          <dt class="pob-label">End Time</dt>
          <dd>{formatDate(iterationTimes.endTime || undefined)}</dd>
        </div>
      {/if}
      <div>
        <dt class="pob-label">Jury Contract</dt>
        <dd><ContractAddress address={iteration.jurySC} chainId={iteration.chainId} /></dd>
      </div>
      <div>
        <dt class="pob-label">PoB Contract</dt>
        <dd><ContractAddress address={iteration.pob} chainId={iteration.chainId} /></dd>
      </div>
    </dl>

    <!-- Iteration description -->
    {#if metadata?.description}
      <div class="pob-fieldset pob-surface--quiet" style="margin-top: 1rem;">
        <p class="pob-eyebrow pob-eyebrow--muted mb-2">Overview</p>
        <MarkdownRenderer content={metadata.description} />
      </div>
    {/if}

    <div class="pob-action-guide" aria-label="Next action guidance">
      <div class="pob-action-guide__copy">
        <p class="pob-eyebrow pob-eyebrow--muted">Next action</p>
        <h3>{actionGuide.title}</h3>
        <p>{actionGuide.body}</p>
      </div>

      {#if actionGuide.action === 'connect' && onConnect}
        <button type="button" class="pob-button pob-button--compact" onclick={onConnect}>
          {actionGuide.cta}
        </button>
      {:else if actionGuide.action === 'projects'}
        <a href="#iteration-projects" class="pob-button pob-button--compact">
          {actionGuide.cta}
        </a>
      {:else if actionGuide.action === 'manage'}
        <Link to="/iteration/{iteration.iteration}/details" class="pob-button pob-button--compact">
          {actionGuide.cta}
        </Link>
      {:else if actionGuide.action === 'mint' && mintButtonType}
        <button
          type="button"
          onclick={handleMint}
          class="pob-button pob-button--compact"
          disabled={pendingAction !== null}
        >
          {pendingAction ? 'Minting...' : actionGuide.cta}
        </button>
      {:else if actionGuide.action === 'results'}
        <a href="#final-results" class="pob-button pob-button--compact pob-button--outline">
          {actionGuide.cta}
        </a>
      {/if}
    </div>

    <ol class="pob-journey" aria-label="Round lifecycle">
      {#each journeySteps as step (step.label)}
        <li class={getJourneyStepClass(step.state)}>
          <span></span>
          <p>{step.label}</p>
        </li>
      {/each}
    </ol>

    <!-- Program brief (left) and Mint button (right) on same line -->
    {#if showActionRow}
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          {#if metadata?.link || iteration.link}
            <a
              href={metadata?.link || iteration.link}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-button pob-button--compact"
            >
              Program brief
            </a>
          {/if}

          {#if isOwner}
            <Link
              to="/iteration/{iteration.iteration}/details"
              class="pob-button pob-button--compact pob-button--outline"
            >
              Manage iteration
            </Link>
          {/if}
        </div>

        {#if actionGuide.action !== 'mint'}
          {#if mintButtonType === 'smt'}
            <button
              type="button"
              onclick={handleMint}
              class="pob-button pob-button--compact"
              disabled={pendingAction !== null}
            >
              {pendingAction === 'Mint SMT Badge' ? 'Minting...' : 'Mint SMT badge'}
            </button>
          {:else if mintButtonType === 'dao_hic'}
            <button
              type="button"
              onclick={handleMint}
              class="pob-button pob-button--compact"
              disabled={pendingAction !== null}
            >
              {pendingAction === 'Mint DAO HIC Badge' ? 'Minting...' : 'Mint DAO HIC badge'}
            </button>
          {:else if mintButtonType === 'project'}
            <button
              type="button"
              onclick={handleMint}
              class="pob-button pob-button--compact"
              disabled={pendingAction !== null}
            >
              {pendingAction === 'Mint Project Badge' ? 'Minting...' : 'Mint Project badge'}
            </button>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Winner Section - Only show when voting has ended -->
    {#if votingEnded && winner && entityVotes}
      <div id="final-results">
        <FinalResultsPanel
          {winner}
          {entityVotes}
          {daoHicIndividualVotes}
          {votingMode}
          {projects}
          {projectScores}
          {getProjectLabel}
          {isOwner}
          iterationNumber={iteration?.iteration}
        />
      </div>
    {/if}
  </section>
{/if}
