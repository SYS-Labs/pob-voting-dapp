<script lang="ts">
  import type { Badge } from '~/interfaces';
  import BadgeCard from '~/components/BadgeCard.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    badges: Badge[];
    walletAddress: string | null;
    loading: boolean;
  }

  let { badges, walletAddress, loading }: Props = $props();

  const showLoader = $derived(loading && badges.length === 0 && walletAddress);
</script>

<div class="pob-stack" id="badges-page">
  <section class="pob-pane pob-pane--subtle">
    {#if walletAddress}
      {#if showLoader}
        <div class="flex flex-col items-center justify-center py-12">
          <ProgressSpinner size={48} className="mb-4" />
          <p class="text-sm text-[var(--pob-text-muted)]">
            Loading your badges...
          </p>
        </div>
      {:else}
        {#if badges.length > 0}
          <p class="text-sm text-[var(--pob-text-muted)] mb-4">
            These are your footprints in Syscoin history:
          </p>
          <div class="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
            {#each badges as badge (`${badge.iteration}-${badge.round || 'main'}-${badge.tokenId}`)}
              <BadgeCard {badge} />
            {/each}
          </div>
        {:else}
          <div class="text-center py-12">
            <p class="text-sm text-[var(--pob-text-muted)] mb-4">
              You don't have any badges yet.
            </p>
            <p class="text-sm text-[var(--pob-text-muted)]">
              Participate in an iteration to earn your first badge!
            </p>
          </div>
        {/if}
      {/if}
    {:else}
      <p class="text-sm text-[var(--pob-text-muted)]">
        Connect your wallet to view your badges.
      </p>
    {/if}
  </section>
</div>
