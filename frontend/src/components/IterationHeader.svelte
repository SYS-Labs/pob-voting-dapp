<script lang="ts">
  import type { Iteration, ParticipantRole, Badge, IterationMetadata } from '~/interfaces';
  import { formatDate } from '~/utils';
  import FinalResultsPanel from './FinalResultsPanel.svelte';
  import ContractAddress from './ContractAddress.svelte';
  import MarkdownRenderer from './MarkdownRenderer.svelte';
  import { Link } from 'svelte-routing';
  import { metadataAPI } from '~/utils/metadata-api';

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
    pendingAction?: string | null;
    roles?: RoleStatuses;
    badges?: Badge[];
    executeMint?: (role: ParticipantRole, refreshCallback?: () => Promise<void>) => Promise<void>;
    refreshBadges?: () => Promise<void>;
    votingMode?: number;
    projects?: { id: number; address: string; metadata?: any }[];
    projectScores?: { addresses: string[]; scores: string[]; totalPossible: string } | null;
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
    pendingAction,
    roles,
    badges,
    executeMint,
    refreshBadges,
    votingMode = 0,
    projects = [],
    projectScores = null,
  }: Props = $props();

  let metadata = $state<IterationMetadata | null>(null);

  // Load iteration metadata
  $effect(() => {
    if (!iteration) return;

    const loadMetadata = async () => {
      try {
        const data = await metadataAPI.getIterationMetadata(
          iteration!.chainId,
          iteration!.jurySC
        );
        metadata = data;
      } catch (error) {
        console.error('Failed to load iteration metadata:', error);
      }
    };

    loadMetadata();
  });

  // Determine user's role and mint button visibility
  let hasSmtBadge = $derived(badges?.some(badge => badge.role === 'smt') ?? false);
  let hasDaoHicBadge = $derived(badges?.some(badge => badge.role === 'dao_hic') ?? false);
  let hasProjectBadge = $derived(badges?.some(badge => badge.role === 'project') ?? false);

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
    iteration && (iteration.link || metadata?.link || isOwner || (walletAddress && executeMint))
  );

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
        <p class="pob-pane__meta">Current iteration</p>
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
      <div class="pob-fieldset" style="margin-top: 1rem;">
        <MarkdownRenderer content={metadata.description} />
      </div>
    {/if}

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
      </div>
    {/if}

    <!-- Winner Section - Only show when voting has ended -->
    {#if votingEnded && winner && entityVotes}
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
    {/if}
  </section>
{/if}
