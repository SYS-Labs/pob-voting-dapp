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
    onClaim: (tokenId: string) => void;
    pendingAction: string | null;
    voteCounts?: { devRel: number; daoHic: number; community: number };
    daoHicVoters?: string[];
    totalCommunityVoters?: number;
  }

  let {
    badges,
    communityBadges,
    walletAddress,
    statusFlags,
    onClaim,
    pendingAction,
    voteCounts,
    daoHicVoters = [],
    totalCommunityVoters = 0,
  }: Props = $props();

  const showBadges = $derived(walletAddress && badges.length > 0);
  const showVotingProgress = $derived((statusFlags.isActive || statusFlags.votingEnded) && voteCounts);

  const votingRows = $derived.by(() => {
    if (!voteCounts) return [];
    const communityCap =
      Number.isFinite(totalCommunityVoters) && totalCommunityVoters > 0 ? totalCommunityVoters.toString() : '\u221E';
    return [
      { label: 'Community', value: `${voteCounts.community}/${communityCap}` },
      { label: 'DAO HIC', value: `${voteCounts.daoHic}/${daoHicVoters.length}` },
      { label: 'DevRel', value: `${voteCounts.devRel}/1` },
    ].sort((a, b) => a.label.localeCompare(b.label));
  });
</script>

{#if showBadges || showVotingProgress}
  <section class="pob-pane">
    <!-- Grid layout: badges on left, voting progress on right -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2.1rem;">
      <!-- Badge section - Left column -->
      <div class="space-y-4">
        {#if showBadges}
          {#each badges as badge (badge.tokenId)}
            {@const communityBadge = badge.role === 'community'
              ? communityBadges.find((cb) => cb.tokenId === badge.tokenId)
              : null}
            <div class="space-y-3">
              <BadgeCard {badge} />

              <!-- Claim button for community badges -->
              {#if communityBadge?.claimed === false && statusFlags.votingEnded}
                <button
                  type="button"
                  onclick={() => onClaim(communityBadge.tokenId)}
                  disabled={pendingAction !== null}
                  class="pob-button w-full justify-center text-xs"
                >
                  {pendingAction === `Claim deposit for token ${communityBadge.tokenId}`
                    ? 'Claiming\u2026'
                    : 'Claim deposit'}
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <!-- Voting progress section - Right column -->
      <div class="space-y-3">
        {#if showVotingProgress}
          <h4 class="text-sm font-semibold text-white" style="margin-top: 0;">Voting progress</h4>
          {#each votingRows as row (row.label)}
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm text-[var(--pob-text-muted)]">{row.label}</span>
              <span class="pob-mono text-base font-semibold text-white">{row.value}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </section>
{/if}
