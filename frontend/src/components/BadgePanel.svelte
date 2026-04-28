<script lang="ts">
  import type { Badge } from '~/interfaces';
  import BadgeCard from './BadgeCard.svelte';

  interface CommunityBadge {
    tokenId: string;
    hasVoted: boolean;
    vote: string | null;
    claimed?: boolean;
  }

  interface Props {
    badges: Badge[];
    communityBadges: CommunityBadge[];
    walletAddress: string | null;
    statusFlags: { isActive: boolean; votingEnded: boolean };
    pendingAction: string | null;
    voteCounts?: { smt: number; daoHic: number; community: number };
    smtVoters?: string[];
    daoHicVoters?: string[];
    totalCommunityVoters?: number;
  }

  let {
    badges,
    communityBadges,
    walletAddress,
    statusFlags,
    pendingAction,
    voteCounts,
    smtVoters = [],
    daoHicVoters = [],
    totalCommunityVoters = 0,
  }: Props = $props();

  const showBadges = $derived(walletAddress && badges.length > 0);
  const showVotingProgress = $derived((statusFlags.isActive || statusFlags.votingEnded) && voteCounts);

  const votingRows = $derived.by(() => {
    if (!voteCounts) return [];
    const communityCap =
      Number.isFinite(totalCommunityVoters) && totalCommunityVoters > 0 ? totalCommunityVoters.toString() : '\u221E';
    const rows = [
      { label: 'Community', value: `${voteCounts.community}/${communityCap}` },
      { label: 'DAO HIC', value: `${voteCounts.daoHic}/${daoHicVoters.length}` },
      { label: 'SMT', value: `${voteCounts.smt}/${Math.max(smtVoters.length, 1)}` },
    ];
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  });
</script>

{#if showBadges || showVotingProgress}
  <section class="pob-pane pob-surface--quiet badge-panel">
    <div class="pob-pane__heading">
      <div>
        <p class="pob-eyebrow pob-eyebrow--muted mb-1">Sidebar summary</p>
        <h3 class="pob-pane__title">Badges & Progress</h3>
      </div>
    </div>

    <!-- Grid layout: badges on left, voting progress on right -->
    <div class="badge-panel__grid">
      <!-- Badge section - Left column -->
      <div class="space-y-4">
        {#if showBadges}
          {#each badges as badge (badge.tokenId)}
            {@const communityBadge = badge.role === 'community'
              ? communityBadges.find((cb) => cb.tokenId === badge.tokenId)
              : null}
            <div class="space-y-3">
              <BadgeCard {badge} />

            </div>
          {/each}
        {/if}
      </div>

      <!-- Voting progress section - Right column -->
      <div class="space-y-3">
        {#if showVotingProgress}
          <p class="pob-eyebrow pob-eyebrow--muted" style="margin-top: 0;">Voting progress</p>
          <div class="badge-panel__progress-list">
            {#each votingRows as row (row.label)}
              <div class="badge-panel__row">
                <span class="text-sm text-[var(--pob-text-muted)]">{row.label}</span>
                <span class="badge-panel__value pob-mono text-base font-semibold text-white">{row.value}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  .badge-panel__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.1rem;
  }

  .badge-panel__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0;
  }

  .badge-panel__value {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .badge-panel__row + .badge-panel__row {
    border-top: 1px solid var(--pob-border-subtle);
  }

  .badge-panel__progress-list {
    border-top: 1px solid var(--pob-border-subtle);
    border-bottom: 1px solid var(--pob-border-subtle);
  }

  @media (max-width: 767px) {
    .badge-panel__grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
  }
</style>
