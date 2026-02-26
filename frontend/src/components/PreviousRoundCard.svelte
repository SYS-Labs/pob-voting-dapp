<script lang="ts">
  import type { PreviousRound, ParticipantRole, Badge } from '~/interfaces';
  import { formatDate } from '~/utils';
  import { createWriteDispatcher } from '~/utils/writeDispatch';
  import { createPreviousRoundDataStore } from '~/stores/previousRoundData';
  import FinalResultsPanel from './FinalResultsPanel.svelte';
  import ContractAddress from './ContractAddress.svelte';

  interface Props {
    round: PreviousRound;
    chainId: number;
    publicProvider: any;
    isOwner: boolean;
    walletAddress: string | null;
    signer: any;
    pendingAction: string | null;
    getProjectLabel: (address: string | null) => string | null;
    runTransaction: (label: string, txFn: () => Promise<any>, refreshFn?: () => Promise<void>) => Promise<boolean>;
    refreshBadges: () => Promise<void>;
    iterationNumber?: number;
    userBadges?: Badge[];
    hasMintedStatus?: boolean | null;
  }

  let {
    round,
    chainId,
    publicProvider,
    isOwner,
    walletAddress,
    signer,
    pendingAction,
    getProjectLabel,
    runTransaction,
    refreshBadges,
    iterationNumber,
    userBadges = [],
    hasMintedStatus = null,
  }: Props = $props();

  let isExpanded = $state(false);
  const hasKnownBadge = $derived(userBadges.length > 0 || hasMintedStatus === true);

  // Can the user mint a badge for this round? (computed from parent data, no RPC needed)
  const canMintEagerly = $derived.by(() => {
    if (!walletAddress || hasKnownBadge) return false;
    const w = walletAddress.toLowerCase();
    if (round.smtVoters?.some(v => v.toLowerCase() === w)) return true;
    if (round.daoHicVoters?.some(v => v.toLowerCase() === w)) return true;
    if (round.projects?.some(p => p.address.toLowerCase() === w)) return true;
    return false;
  });

  // Reactive store that loads when expanded
  const { loading, roundData } = $derived(
    createPreviousRoundDataStore(round, chainId, iterationNumber ?? 0, publicProvider, isExpanded, walletAddress)
  );

  // Create local getProjectLabel that uses round's project metadata
  function localGetProjectLabel(address: string | null): string | null {
    if (!address) return null;
    const data = $roundData;
    if (data?.projects) {
      const project = data.projects.find(
        p => p.address.toLowerCase() === address.toLowerCase()
      );
      if (project?.metadata?.name) {
        return project.metadata.name;
      }
    }
    return getProjectLabel(address);
  }

  function getUserRole(): ParticipantRole | null {
    if (!walletAddress) return null;
    const w = walletAddress.toLowerCase();
    if (round.smtVoters?.some(v => v.toLowerCase() === w)) return 'smt';
    if (round.daoHicVoters?.some(v => v.toLowerCase() === w)) return 'dao_hic';
    if (round.projects?.some(p => p.address.toLowerCase() === w)) return 'project';
    return null;
  }

  async function handleMintBadge() {
    if (!signer) return;
    const role = getUserRole();
    if (!role) return;

    const writer = createWriteDispatcher(round, signer);
    let tx: () => Promise<unknown>;
    let label: string;

    switch (role) {
      case 'smt':
        tx = () => writer.mintSmt();
        label = `Mint SMT Badge (Round ${round.round})`;
        break;
      case 'dao_hic':
        tx = () => writer.mintDaoHic();
        label = `Mint DAO HIC Badge (Round ${round.round})`;
        break;
      case 'project':
        tx = () => writer.mintProject();
        label = `Mint Project Badge (Round ${round.round})`;
        break;
      default:
        return;
    }

    await runTransaction(label, tx, refreshBadges);
  }

  async function handleClaimDeposit(tokenId: string) {
    if (!signer) return;
    const writer = createWriteDispatcher(round, signer);
    await runTransaction(
      `Claim deposit for token ${tokenId} (Round ${round.round})`,
      () => writer.claim(tokenId),
      refreshBadges,
    );
  }

  function handleCardClick() {
    if (isExpanded) return;
    console.log('[PreviousRoundCard] Card clicked, expanding round', round.round);
    isExpanded = true;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ' ') && !isExpanded) {
      e.preventDefault();
      isExpanded = true;
    }
  }

  function handleMintClick(e: MouseEvent) {
    e.stopPropagation();
    void handleMintBadge();
  }

  function handleClaimClick(e: MouseEvent, tokenId: string) {
    e.stopPropagation();
    void handleClaimDeposit(tokenId);
  }
</script>

<section
  class="pob-pane {!isExpanded ? 'cursor-pointer' : ''}"
  onclick={handleCardClick}
  role="button"
  tabindex="0"
  onkeydown={handleKeyDown}
  style={!isExpanded ? 'padding-bottom: 0.75rem;' : ''}
>
  <div class="pob-pane__heading {!isExpanded ? 'mb-0' : ''}">
    <div>
      <h3 class="pob-pane__title inline">
        Round #{round.round}
        {#if isExpanded && $roundData}
          <span class="pob-pill text-xs {$roundData.winner.hasWinner ? 'pob-pill--success' : 'pob-pill--failure'}">
            {$roundData.votingMode === 0 ? 'Consensus' : 'Weighted'} {$roundData.winner.hasWinner ? '✓' : '✗'}
          </span>
        {:else if round.votingMode !== undefined}
          <span class="pob-pill pob-pill--neutral text-xs">
            {round.votingMode === 0 ? 'Consensus' : 'Weighted'}
          </span>
        {/if}
      </h3>
      {#if !isExpanded}
        <span class="text-xs text-[var(--pob-primary)]" style="margin-left: 0.5rem;">(click for details)</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if walletAddress && hasKnownBadge}
        {@const communityBadge = userBadges.find(b => b.role === 'community')}
        {#if isExpanded && communityBadge && !communityBadge.claimed}
          <button
            type="button"
            onclick={(e) => handleClaimClick(e, communityBadge.tokenId)}
            disabled={pendingAction !== null}
            class="pob-button text-xs"
          >
            {pendingAction?.includes(communityBadge.tokenId) ? 'Claiming…' : 'Claim deposit'}
          </button>
        {/if}
        <span class="pob-pill pob-pill--active">Badge minted</span>
      {:else if canMintEagerly}
        <button
          type="button"
          onclick={handleMintClick}
          disabled={pendingAction !== null}
          class="pob-button text-xs"
        >
          {pendingAction?.includes(`Round ${round.round}`) ? 'Minting…' : 'Mint badge'}
        </button>
      {/if}
      <span class="pob-pill pob-pill--ended">Ended</span>
    </div>
  </div>

  {#if isExpanded}
    <div class="mt-4 space-y-4">
      {#if $loading}
        <p class="text-sm text-[var(--pob-text-muted)]">Loading round data...</p>
      {:else if $roundData}
        <dl class="pob-pane__grid text-sm text-[var(--pob-text-muted)] sm:grid-cols-2">
          <div>
            <dt class="pob-label">Start Time</dt>
            <dd>{formatDate($roundData.startTime || undefined)}</dd>
          </div>
          <div>
            <dt class="pob-label">End Time</dt>
            <dd>{formatDate($roundData.endTime || undefined)}</dd>
          </div>
          <div>
            <dt class="pob-label">Jury Contract</dt>
            <dd><ContractAddress address={round.jurySC} {chainId} /></dd>
          </div>
          <div>
            <dt class="pob-label">PoB Contract</dt>
            <dd><ContractAddress address={round.pob} {chainId} /></dd>
          </div>
        </dl>

        <!-- Final Results -->
        <FinalResultsPanel
          winner={$roundData.winner}
          entityVotes={$roundData.entityVotes}
          daoHicIndividualVotes={$roundData.daoHicIndividualVotes}
          votingMode={$roundData.votingMode}
          projects={$roundData.projects}
          projectScores={$roundData.projectScores}
          getProjectLabel={localGetProjectLabel}
          {isOwner}
          {iterationNumber}
        />
      {:else}
        <p class="text-sm text-[var(--pob-text-muted)]">No data available</p>
      {/if}
    </div>
  {/if}
</section>
