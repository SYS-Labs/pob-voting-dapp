<script lang="ts">
  import type { Cert, CertEligibility } from '~/interfaces';
  import type { JsonRpcSigner } from 'ethers';
  import CertCard from '~/components/CertCard.svelte';
  import CertRequestForm from '~/components/CertRequestForm.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    certs: Cert[];
    eligibility: Record<number, CertEligibility>;
    walletAddress: string | null;
    loading: boolean;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    onRefresh: () => void;
  }

  let {
    certs,
    eligibility,
    walletAddress,
    loading,
    chainId,
    signer,
    onRefresh,
  }: Props = $props();

  const showLoader = $derived(loading && certs.length === 0 && walletAddress);

  const eligibleIterations = $derived(
    Object.entries(eligibility)
      .filter(([_, e]) => e.eligible)
      .map(([iter, e]) => ({ iteration: Number(iter), certType: e.certType }))
      .sort((a, b) => a.iteration - b.iteration)
  );

  const hasCerts = $derived(certs.length > 0);
  const hasEligible = $derived(eligibleIterations.length > 0);
</script>

<div class="pob-stack" id="certs-page">
  {#if walletAddress}
    {#if showLoader}
      <section class="pob-pane pob-pane--subtle">
        <div class="flex flex-col items-center justify-center py-12">
          <ProgressSpinner size={48} className="mb-4" />
          <p class="text-sm text-[var(--pob-text-muted)]">
            Loading your certificates...
          </p>
        </div>
      </section>
    {:else}
      <!-- Your Certificates section -->
      <section class="pob-pane pob-pane--subtle">
        <div class="pob-pane__heading">
          <h2 class="pob-pane__title">Your Certificates</h2>
        </div>
        {#if hasCerts}
          <p class="text-sm text-[var(--pob-text-muted)] mb-4">
            Certificates earned through your participation:
          </p>
          <div class="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
            {#each certs as cert (`${cert.iteration}-${cert.certType}-${cert.tokenId}`)}
              <CertCard {cert} />
            {/each}
          </div>
        {:else}
          <p class="text-sm text-[var(--pob-text-muted)]">
            You don't have any certificates yet.
          </p>
        {/if}
      </section>

      <!-- Eligible Iterations section -->
      {#if hasEligible && chainId !== null}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Eligible Iterations</h2>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)] mb-4">
            You can request certificates for these iterations:
          </p>
          <div class="space-y-4">
            {#each eligibleIterations as { iteration, certType } (iteration)}
              <div>
                <h3 class="text-sm font-medium text-[var(--pob-text-secondary)] mb-2">
                  Iteration {iteration}
                </h3>
                <CertRequestForm
                  {iteration}
                  {certType}
                  chainId={chainId}
                  {signer}
                  onRequestComplete={onRefresh}
                />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Empty state: no certs and no eligible iterations -->
      {#if !hasCerts && !hasEligible}
        <section class="pob-pane pob-pane--subtle">
          <div class="text-center py-12">
            <p class="text-sm text-[var(--pob-text-muted)] mb-4">
              You don't have any certificates yet.
            </p>
            <p class="text-sm text-[var(--pob-text-muted)]">
              Participate in an iteration to become eligible for a certificate.
            </p>
          </div>
        </section>
      {/if}
    {/if}
  {:else}
    <section class="pob-pane pob-pane--subtle">
      <p class="text-sm text-[var(--pob-text-muted)]">
        Connect your wallet to view your certificates.
      </p>
    </section>
  {/if}
</div>
