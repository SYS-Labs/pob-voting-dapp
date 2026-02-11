<script lang="ts">
  import type { Cert, Badge } from '~/interfaces';
  import CertCard from '~/components/CertCard.svelte';
  import BadgeCard from '~/components/BadgeCard.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    address: string;
    certs: Cert[];
    badges: Badge[];
    walletAddress: string | null;
    chainId: number | null;
    loading: boolean;
  }

  let {
    address,
    certs,
    badges,
    walletAddress,
    chainId,
    loading,
  }: Props = $props();

  const isOwnProfile = $derived(
    walletAddress !== null && address.toLowerCase() === walletAddress.toLowerCase()
  );

  const truncatedAddress = $derived(
    address.slice(0, 6) + '...' + address.slice(-4)
  );

  const badgeCount = $derived(badges.length);
  const certCount = $derived(certs.length);

  const showLoader = $derived(loading && badgeCount === 0 && certCount === 0);
</script>

<div class="pob-stack" id="profile-page">
  <!-- Profile Header -->
  <section class="pob-pane pob-pane--subtle">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="pob-pane__title text-lg">Profile</h1>
        <p class="pob-mono text-sm text-[var(--pob-text-muted)] mt-1" title={address}>
          {truncatedAddress}
        </p>
      </div>
      {#if isOwnProfile}
        <span class="pob-pill border border-[rgba(247,147,26,0.45)] bg-[rgba(247,147,26,0.12)] text-[var(--pob-primary)]">
          Your Profile
        </span>
      {/if}
    </div>
  </section>

  <!-- Stats Row -->
  <section class="pob-pane pob-pane--subtle">
    <div class="flex gap-6">
      <div class="text-center">
        <p class="text-2xl font-semibold">{badgeCount}</p>
        <p class="text-xs text-[var(--pob-text-muted)]">
          {badgeCount === 1 ? 'Badge' : 'Badges'}
        </p>
      </div>
      <div class="text-center">
        <p class="text-2xl font-semibold">{certCount}</p>
        <p class="text-xs text-[var(--pob-text-muted)]">
          {certCount === 1 ? 'Certificate' : 'Certificates'}
        </p>
      </div>
    </div>
  </section>

  {#if showLoader}
    <section class="pob-pane pob-pane--subtle">
      <div class="flex flex-col items-center justify-center py-12">
        <ProgressSpinner size={48} className="mb-4" />
        <p class="text-sm text-[var(--pob-text-muted)]">
          Loading profile data...
        </p>
      </div>
    </section>
  {:else}
    <!-- Certificates Section -->
    <section class="pob-pane pob-pane--subtle">
      <div class="pob-pane__heading">
        <h2 class="pob-pane__title">Certificates</h2>
      </div>
      {#if certCount > 0}
        <div class="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
          {#each certs as cert (`${cert.iteration}-${cert.certType}-${cert.tokenId}`)}
            <CertCard {cert} />
          {/each}
        </div>
      {:else}
        <div class="text-center py-8">
          <p class="text-sm text-[var(--pob-text-muted)]">
            No certificates yet.
          </p>
        </div>
      {/if}
    </section>

    <!-- Badges Section -->
    <section class="pob-pane pob-pane--subtle">
      <div class="pob-pane__heading">
        <h2 class="pob-pane__title">Badges</h2>
      </div>
      {#if badgeCount > 0}
        <div class="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
          {#each badges as badge (`${badge.iteration}-${badge.round || 'main'}-${badge.tokenId}`)}
            <BadgeCard {badge} />
          {/each}
        </div>
      {:else}
        <div class="text-center py-8">
          <p class="text-sm text-[var(--pob-text-muted)]">
            No badges yet.
          </p>
        </div>
      {/if}
    </section>
  {/if}
</div>
