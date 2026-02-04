<script lang="ts">
  import { Contract } from 'ethers';
  import type { PreviousRound, ParticipantRole } from '~/interfaces';
  import { PoB_01ABI, PoB_02ABI } from '~/abis';
  import { formatDate } from '~/utils';
  import { createPreviousRoundDataStore } from '~/stores/previousRoundData';
  import FinalResultsPanel from './FinalResultsPanel.svelte';
  import ContractAddress from './ContractAddress.svelte';

  function getPoBContractABI(version: string | undefined) {
    if (version === '001' || version === '002') return PoB_01ABI;
    return PoB_02ABI;
  }

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
  }: Props = $props();

  let isExpanded = $state(false);

  // Reactive store that loads when expanded
  const { loading, roundData } = $derived(
    createPreviousRoundDataStore(round, chainId, publicProvider, isExpanded, walletAddress)
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

  async function getUserRole(): Promise<ParticipantRole | null> {
    if (!walletAddress || !signer) return null;
    try {
      const contract = new Contract(round.jurySC, ['function devRelAccount() view returns (address)', 'function getDaoHicVoters() view returns (address[])', 'function getProjects() view returns (address[])'], publicProvider);
      const [devRel, daoHicVoters, projects] = await Promise.all([
        contract.devRelAccount(),
        contract.getDaoHicVoters(),
        contract.getProjects(),
      ]);
      const walletLower = walletAddress.toLowerCase();
      if (devRel && devRel.toLowerCase() === walletLower) return 'devrel';
      if (daoHicVoters.some((v: string) => v.toLowerCase() === walletLower)) return 'dao_hic';
      if (projects.some((p: string) => p.toLowerCase() === walletLower)) return 'project';
    } catch (err) {
      console.error('[PreviousRoundCard] Failed to determine user role', err);
    }
    return null;
  }

  async function handleMintBadge() {
    if (!signer) return;
    const role = await getUserRole();
    if (!role) {
      console.error('[PreviousRoundCard] Could not determine role for minting');
      return;
    }

    const pobABI = getPoBContractABI(round.version);
    const contract = new Contract(round.pob, pobABI, signer);
    let tx: () => Promise<unknown>;
    let label: string;

    switch (role) {
      case 'devrel':
        tx = () => contract.mintDevRel();
        label = `Mint DevRel Badge (Round ${round.round})`;
        break;
      case 'dao_hic':
        tx = () => contract.mintDaoHic();
        label = `Mint DAO HIC Badge (Round ${round.round})`;
        break;
      case 'project':
        tx = () => contract.mintProject();
        label = `Mint Project Badge (Round ${round.round})`;
        break;
      default:
        return;
    }

    await runTransaction(label, tx, refreshBadges);
  }

  async function handleClaimDeposit(tokenId: string) {
    if (!signer) return;
    const pobABI = getPoBContractABI(round.version);
    const contract = new Contract(round.pob, pobABI, signer);
    await runTransaction(
      `Claim deposit for token ${tokenId} (Round ${round.round})`,
      () => contract.claim(tokenId),
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
      {#if isExpanded && $roundData && walletAddress}
        {@const badges = $roundData.userBadges}
        {@const hasBadge = badges.length > 0}
        {@const communityBadge = badges.find(b => b.role === 'community')}

        {#if hasBadge}
          {#if communityBadge && !communityBadge.claimed}
            <button
              type="button"
              onclick={(e) => handleClaimClick(e, communityBadge.tokenId)}
              disabled={pendingAction !== null}
              class="pob-button text-xs"
            >
              {pendingAction?.includes(communityBadge.tokenId) ? 'Claiming…' : 'Claim deposit'}
            </button>
            <span class="pob-pill pob-pill--active">Minted</span>
          {:else}
            <span class="pob-pill pob-pill--active">Minted already</span>
          {/if}
        {:else if $roundData.canMint}
          <button
            type="button"
            onclick={handleMintClick}
            disabled={pendingAction !== null}
            class="pob-button text-xs"
          >
            {pendingAction?.includes(`Round ${round.round}`) ? 'Minting…' : 'Mint badge'}
          </button>
        {/if}
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
