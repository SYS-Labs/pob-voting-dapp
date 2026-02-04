<script lang="ts">
  import { Contract } from 'ethers';
  import type { ParticipantRole, PreviousRound, Badge } from '~/interfaces';
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
  import { NETWORKS } from '~/constants/networks';
  import { PoB_01ABI, PoB_02ABI } from '~/abis';

  function getPoBContractABI(version: string | undefined) {
    if (version === '001' || version === '002') return PoB_01ABI;
    return PoB_02ABI;
  }

  interface CommunityBadge {
    tokenId: string;
    hasVoted: boolean;
    vote: string | null;
    claimed?: boolean;
  }

  interface RoleStatuses {
    community: boolean;
    devrel: boolean;
    dao_hic: boolean;
    project: boolean;
  }

  interface StatusFlags {
    isActive: boolean;
    votingEnded: boolean;
  }

  interface RoundEligibility {
    round: number;
    pobAddress: string;
    version: string;
    isDevRel: boolean;
    isDaoHic: boolean;
    hasMinted: boolean;
  }

  interface Props {
    roles: RoleStatuses;
    statusFlags: StatusFlags;
    communityBadges: CommunityBadge[];
    badges: Badge[];
    allBadges: Badge[];
    devRelVote: string | null;
    daoHicVote: string | null;
    pendingAction: string | null;
    walletAddress: string | null;
    chainId: number | null;
    getProjectLabel: (address: string | null) => string | null;
    executeMint: (role: ParticipantRole) => void;
    previousRounds?: PreviousRound[];
    signer?: any;
    runTransaction?: (label: string, txFn: () => Promise<any>, refreshFn?: () => Promise<void>) => Promise<boolean>;
    refreshBadges?: () => Promise<void>;
  }

  let {
    roles,
    statusFlags,
    communityBadges,
    badges,
    allBadges,
    devRelVote,
    daoHicVote,
    pendingAction,
    walletAddress,
    chainId,
    getProjectLabel,
    executeMint,
    previousRounds,
    signer,
    runTransaction,
    refreshBadges,
  }: Props = $props();

  // Compute eligibility for previous rounds
  const roundEligibilities = $derived.by((): RoundEligibility[] => {
    if (!walletAddress || !previousRounds || previousRounds.length === 0) {
      return [];
    }

    const walletLower = walletAddress.toLowerCase();

    return previousRounds.map(round => {
      const hasMinted = allBadges.some(
        badge => badge.round === round.round && (badge.role === 'devrel' || (badge.role as string) === 'dao-hic')
      );

      const isDevRel = round.devRelAccount?.toLowerCase() === walletLower;
      const isDaoHic = Array.isArray(round.daoHicVoters) &&
        round.daoHicVoters.some(v => v.toLowerCase() === walletLower);

      return {
        round: round.round,
        pobAddress: round.pob,
        version: round.version,
        isDevRel: hasMinted ? false : isDevRel,
        isDaoHic: hasMinted ? false : isDaoHic,
        hasMinted,
      };
    }).filter(e => e.isDevRel || e.isDaoHic || e.hasMinted);
  });

  async function handlePreviousRoundMint(eligibility: RoundEligibility) {
    if (!signer || !runTransaction || !refreshBadges) return;

    const pobABI = getPoBContractABI(eligibility.version);
    const contract = new Contract(eligibility.pobAddress, pobABI, signer);

    let tx: () => Promise<unknown>;
    let label: string;

    if (eligibility.isDevRel) {
      tx = () => contract.mintDevRel();
      label = `Mint DevRel Badge (Round ${eligibility.round})`;
    } else if (eligibility.isDaoHic) {
      tx = () => contract.mintDaoHic();
      label = `Mint DAO HIC Badge (Round ${eligibility.round})`;
    } else {
      return;
    }

    await runTransaction(label, tx, refreshBadges);
  }

  const hasJuryRole = $derived(roles.devrel || roles.dao_hic || roles.community);
  const hasPreviousRoundMints = $derived(roundEligibilities.some(e => !e.hasMinted && (e.isDevRel || e.isDaoHic)));
  const hasPreviousRoundEarnedRole = $derived(roundEligibilities.some(e => e.isDevRel || e.isDaoHic));
  const canBecomeCommunity = $derived(!roles.project && !roles.devrel && !roles.dao_hic && !roles.community && !hasPreviousRoundEarnedRole);
  const hasDevRelBadge = $derived(badges?.some(badge => badge.role === 'devrel') ?? false);
  const hasDaoHicBadge = $derived(badges?.some(badge => (badge.role as string) === 'dao-hic') ?? false);

  const showPanel = $derived(hasJuryRole || canBecomeCommunity || hasPreviousRoundMints);

  const network = $derived(chainId ? NETWORKS[chainId] : null);
  const mintAmount = $derived(network?.mintAmount ?? '30');
  const tokenSymbol = $derived(network?.tokenSymbol ?? 'TSYS');

  const previousRoundRole = $derived(roundEligibilities.find(e => e.isDevRel || e.isDaoHic));
  const headerRoleTag = $derived.by(() => {
    if (roles.devrel) return { label: ROLE_LABELS.devrel, color: ROLE_COLORS.devrel };
    if (roles.dao_hic) return { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic };
    if (roles.community) return { label: ROLE_LABELS.community, color: ROLE_COLORS.community };
    if (previousRoundRole?.isDevRel) return { label: ROLE_LABELS.devrel, color: ROLE_COLORS.devrel };
    if (previousRoundRole?.isDaoHic) return { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic };
    if (canBecomeCommunity) return { label: ROLE_LABELS.community, color: ROLE_COLORS.community };
    return null;
  });

  const unmintedEligibilities = $derived(roundEligibilities.filter(e => !e.hasMinted && (e.isDevRel || e.isDaoHic)));
</script>

{#if showPanel}
  <section class="pob-pane">
    <div class="pob-pane__heading">
      <h3 class="pob-pane__title">Jury Panel</h3>
      {#if headerRoleTag}
        <span class="pob-pill {headerRoleTag.color}">
          {headerRoleTag.label}
        </span>
      {/if}
    </div>

    <div class="space-y-3">
      <!-- DevRel Role -->
      {#if roles.devrel}
        <p class="text-sm text-[var(--pob-text-muted)]">
          As DevRel, you represent the developer relations entity and cast one vote for a project during the active voting period. Mint your commemorative badge after voting ends.
        </p>
        <p class="text-sm text-[var(--pob-text-muted)]">
          {#if devRelVote}
            Voted for{' '}
            <span class="italic">
              {getProjectLabel(devRelVote) ?? 'Unknown project'}
            </span>
          {:else}
            Not voted yet
          {/if}
        </p>
        {#if !hasDevRelBadge}
          {#if statusFlags.votingEnded}
            <button
              type="button"
              onclick={() => void executeMint('devrel')}
              class="pob-button w-full justify-center text-xs"
              disabled={pendingAction !== null || !walletAddress}
            >
              {pendingAction === 'Mint DevRel Badge' ? 'Minting…' : 'Mint DevRel badge'}
            </button>
          {:else}
            <p class="text-xs text-[var(--pob-text-muted)] italic">
              Badge minting available after voting ends
            </p>
          {/if}
        {/if}
      {/if}

      <!-- DAO HIC Role -->
      {#if roles.dao_hic}
        <p class="text-sm text-[var(--pob-text-muted)]">
          As a DAO HIC voter, you are part of the high-integrity council. Cast your vote during the active voting period. The council's decision is determined by majority consensus. Mint your commemorative badge after voting ends.
        </p>
        <p class="text-sm text-[var(--pob-text-muted)]">
          {#if daoHicVote}
            Voted for{' '}
            <span class="italic">
              {getProjectLabel(daoHicVote) ?? 'Unknown project'}
            </span>
          {:else}
            Not voted yet
          {/if}
        </p>
        {#if !hasDaoHicBadge}
          {#if statusFlags.votingEnded}
            <button
              type="button"
              onclick={() => void executeMint('dao_hic')}
              class="pob-button w-full justify-center text-xs"
              disabled={pendingAction !== null || !walletAddress}
            >
              {pendingAction === 'Mint DAO HIC Badge' ? 'Minting…' : 'Mint DAO HIC badge'}
            </button>
          {:else}
            <p class="text-xs text-[var(--pob-text-muted)] italic">
              Badge minting available after voting ends
            </p>
          {/if}
        {/if}
      {/if}

      <!-- Community Role -->
      {#if roles.community || canBecomeCommunity}
        {#if communityBadges.length === 0}
          <p class="text-sm text-[var(--pob-text-muted)]">
            As a community juror, mint your badge ({mintAmount} {tokenSymbol} deposit) during the active voting period to participate. After voting ends, you can reclaim your deposit.
          </p>
          {#if statusFlags.isActive && walletAddress}
            <button
              type="button"
              onclick={() => void executeMint('community')}
              class="pob-button w-full justify-center text-xs"
              disabled={pendingAction !== null}
            >
              {pendingAction === 'Mint Community Badge' ? 'Minting…' : `Mint community badge (${mintAmount} ${tokenSymbol})`}
            </button>
          {/if}
          {#if !statusFlags.isActive && !statusFlags.votingEnded}
            <p class="text-xs text-[var(--pob-text-muted)] italic">
              Badge minting available when voting starts
            </p>
          {/if}
        {:else if roles.community && !communityBadges.some(b => b.hasVoted)}
          <p class="text-sm text-[var(--pob-text-muted)]">
            Badge minted successfully! You can now vote on projects below.
          </p>
          <p class="text-sm text-[var(--pob-text-muted)]">
            You can <span class="underline">change your vote at any time</span> during the voting period.
          </p>
        {:else if roles.community && communityBadges.some(b => b.hasVoted)}
          <p class="text-sm text-[var(--pob-text-muted)]">
            Voted for{' '}
            <span class="font-semibold text-white italic">
              {getProjectLabel(communityBadges.find(b => b.hasVoted)?.vote ?? null) ?? 'Unknown project'}
            </span>
          </p>
          <p class="text-xs text-[var(--pob-text-muted)] italic">
            You can change your vote at any time during the voting period.
          </p>
        {/if}
      {/if}

      <!-- Previous Round Role context -->
      {#if !roles.devrel && !roles.dao_hic && !roles.community && !canBecomeCommunity && hasPreviousRoundEarnedRole}
        <p class="text-sm text-[var(--pob-text-muted)]">
          You participated as {previousRoundRole?.isDevRel ? 'DevRel' : 'DAO HIC'} in a previous round of this iteration. Mint your commemorative badge below.
        </p>
      {/if}

      <!-- Previous Rounds Badge Minting -->
      {#if unmintedEligibilities.length > 0}
        <div class="{hasJuryRole || canBecomeCommunity ? 'pt-3 border-t border-[var(--pob-border)]' : ''}">
          <p class="text-xs text-[var(--pob-text-muted)] mb-2">
            Previous round badges available:
          </p>
          <div class="space-y-2">
            {#each unmintedEligibilities as eligibility (eligibility.round)}
              <div class="flex items-center justify-between gap-2 p-2 bg-[var(--pob-surface)] rounded">
                <span class="text-xs text-[var(--pob-text-muted)]">
                  Round {eligibility.round} - {eligibility.isDevRel ? 'DevRel' : 'DAO HIC'}
                </span>
                <button
                  type="button"
                  onclick={() => void handlePreviousRoundMint(eligibility)}
                  class="pob-button text-xs"
                  disabled={pendingAction !== null || !walletAddress}
                >
                  {pendingAction?.includes(`Round ${eligibility.round}`) ? 'Minting…' : 'Mint badge'}
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>
{/if}
