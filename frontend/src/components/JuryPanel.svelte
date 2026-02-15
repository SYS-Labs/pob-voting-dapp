<script lang="ts">
  import type { Badge } from '~/interfaces';
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
  import { NETWORKS } from '~/constants/networks';

  interface CommunityBadge {
    tokenId: string;
    hasVoted: boolean;
    vote: string | null;
    claimed?: boolean;
  }

  interface RoleStatuses {
    community: boolean;
    smt: boolean;
    dao_hic: boolean;
    project: boolean;
  }

  interface StatusFlags {
    isActive: boolean;
    votingEnded: boolean;
  }

  interface Props {
    roles: RoleStatuses;
    statusFlags: StatusFlags;
    communityBadges: CommunityBadge[];
    badges: Badge[];
    smtVote: string | null;
    daoHicVote: string | null;
    pendingAction: string | null;
    walletAddress: string | null;
    chainId: number | null;
    getProjectLabel: (address: string | null) => string | null;
  }

  let {
    roles,
    statusFlags,
    communityBadges,
    badges,
    smtVote,
    daoHicVote,
    pendingAction,
    walletAddress,
    chainId,
    getProjectLabel,
  }: Props = $props();

  const hasJuryRole = $derived(roles.smt || roles.dao_hic || roles.community);
  const canBecomeCommunity = $derived(!roles.project && !roles.smt && !roles.dao_hic && !roles.community);

  const showPanel = $derived(hasJuryRole || canBecomeCommunity);

  const network = $derived(chainId ? NETWORKS[chainId] : null);
  const mintAmount = $derived(network?.mintAmount ?? '30');
  const tokenSymbol = $derived(network?.tokenSymbol ?? 'TSYS');

  const headerRoleTag = $derived.by(() => {
    if (roles.smt) return { label: ROLE_LABELS.smt, color: ROLE_COLORS.smt };
    if (roles.dao_hic) return { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic };
    if (roles.community) return { label: ROLE_LABELS.community, color: ROLE_COLORS.community };
    if (canBecomeCommunity) return { label: ROLE_LABELS.community, color: ROLE_COLORS.community };
    return null;
  });
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
      <!-- SMT Role (v003) -->
      {#if roles.smt}
        <p class="text-sm text-[var(--pob-text-muted)]">
          As an SMT voter, you are part of the SMT entity. Cast your vote during the active voting period. The entity's decision is determined by majority consensus.
        </p>
        <p class="text-sm text-[var(--pob-text-muted)]">
          {#if smtVote}
            Voted for
            <span class="italic">
              {getProjectLabel(smtVote) ?? 'Unknown project'}
            </span>
          {:else}
            Not voted yet
          {/if}
        </p>
      {/if}

      <!-- DAO HIC Role -->
      {#if roles.dao_hic}
        <p class="text-sm text-[var(--pob-text-muted)]">
          As a DAO HIC voter, you are part of the high-integrity council. Cast your vote during the active voting period. The council's decision is determined by majority consensus.
        </p>
        <p class="text-sm text-[var(--pob-text-muted)]">
          {#if daoHicVote}
            Voted for
            <span class="italic">
              {getProjectLabel(daoHicVote) ?? 'Unknown project'}
            </span>
          {:else}
            Not voted yet
          {/if}
        </p>
      {/if}

      <!-- Community Role -->
      {#if roles.community || canBecomeCommunity}
        {#if communityBadges.length === 0}
          <p class="text-sm text-[var(--pob-text-muted)]">
            As a community juror, mint your badge ({mintAmount} {tokenSymbol} deposit) during the active voting period to participate. After voting ends, you can reclaim your deposit.
          </p>
        {:else if roles.community && !communityBadges.some(b => b.hasVoted)}
          <p class="text-sm text-[var(--pob-text-muted)]">
            Badge minted successfully! You can now vote on projects below.
          </p>
          <p class="text-sm text-[var(--pob-text-muted)]">
            You can <span class="underline">change your vote at any time</span> during the voting period.
          </p>
        {:else if roles.community && communityBadges.some(b => b.hasVoted)}
          <p class="text-sm text-[var(--pob-text-muted)]">
            Voted for
            <span class="font-semibold text-white italic">
              {getProjectLabel(communityBadges.find(b => b.hasVoted)?.vote ?? null) ?? 'Unknown project'}
            </span>
          </p>
          <p class="text-xs text-[var(--pob-text-muted)] italic">
            You can change your vote at any time during the voting period.
          </p>
        {/if}
      {/if}
    </div>
  </section>
{/if}
