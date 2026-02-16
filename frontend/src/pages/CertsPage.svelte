<script lang="ts">
  import type { Cert, CertEligibility } from '~/interfaces';
  import { type JsonRpcSigner, type Provider } from 'ethers';
  import { getCertNFTContract } from '~/utils/certNFT';
  import CertCard from '~/components/CertCard.svelte';
  import TeamMemberNameForm from '~/components/TeamMemberNameForm.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    certs: Cert[];
    eligibility: Record<number, CertEligibility>;
    walletAddress: string | null;
    loading: boolean;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    publicProvider: Provider | null;
    onRefresh: () => void;
  }

  let {
    certs,
    eligibility,
    walletAddress,
    loading,
    chainId,
    signer,
    publicProvider,
    onRefresh,
  }: Props = $props();

  interface MembershipEntry {
    iteration: number;
    project: string;
    fullName: string;
  }

  let memberships: MembershipEntry[] = $state([]);
  let isOwner: boolean = $state(false);
  let pendingIterations: number[] = $state([]);

  function getApiBaseUrl(): string {
    const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
    return envBaseUrl ? `${envBaseUrl}/api` : '/api';
  }

  async function fetchMemberships() {
    if (!walletAddress || chainId === null) return;
    try {
      const apiBaseUrl = getApiBaseUrl();
      const res = await fetch(`${apiBaseUrl}/team-members/${chainId}/member/${walletAddress}`);
      if (!res.ok) return;
      const data = await res.json();
      const entries: Array<{ iteration: number; projectAddress: string; memberAddress: string; status: string; fullName: string }> = data.memberships || [];
      memberships = entries
        .filter((m) => m.status === 'approved')
        .map((m) => ({ iteration: m.iteration, project: m.projectAddress, fullName: m.fullName }));
    } catch {
      memberships = [];
    }
  }

  async function fetchOwnerData() {
    if (!walletAddress || chainId === null || !publicProvider) {
      isOwner = false;
      pendingIterations = [];
      return;
    }
    try {
      const certNFT = getCertNFTContract(chainId, publicProvider);
      if (!certNFT) {
        isOwner = false;
        pendingIterations = [];
        return;
      }
      const owner: string = await certNFT.owner();
      isOwner = owner.toLowerCase() === walletAddress.toLowerCase();

      if (isOwner) {
        const apiBaseUrl = getApiBaseUrl();
        const res = await fetch(`${apiBaseUrl}/team-members/${chainId}/pending`);
        if (!res.ok) {
          pendingIterations = [];
          return;
        }
        const data = await res.json();
        const entries: Array<{ iteration: number }> = data.pending || data.members || [];
        const unique = [...new Set(entries.map((e) => e.iteration))].sort((a, b) => a - b);
        pendingIterations = unique;
      } else {
        pendingIterations = [];
      }
    } catch {
      isOwner = false;
      pendingIterations = [];
    }
  }

  const unnamedMemberships = $derived(
    memberships.filter((m) => !m.fullName)
  );

  $effect(() => {
    if (walletAddress && chainId !== null) {
      fetchMemberships();
      fetchOwnerData();
    }
  });

  const showLoader = $derived(loading && certs.length === 0 && walletAddress);

  const eligibleIterations = $derived(
    Object.entries(eligibility)
      .filter(([_, e]) => e.eligible)
      .map(([iter, e]) => ({ iteration: Number(iter), certType: e.certType }))
      .sort((a, b) => a.iteration - b.iteration)
  );

  const hasCerts = $derived(certs.length > 0);
  const hasEligible = $derived(eligibleIterations.length > 0);
  const hasPending = $derived(isOwner && pendingIterations.length > 0);
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
      {#if hasCerts}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Your Certificates</h2>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)] mb-4">
            Certificates earned through your participation:
          </p>
          <div class="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
            {#each certs as cert (`${cert.iteration}-${cert.certType}-${cert.tokenId}`)}
              <CertCard {cert} />
            {/each}
          </div>
        </section>
      {/if}

      <!-- Team Member Name Form: shown when the wallet is an approved member without a name -->
      {#if unnamedMemberships.length > 0 && chainId !== null}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Set Your Name</h2>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            You have been approved as a team member. Set your name for the certificate:
          </p>
          <div class="space-y-3 mt-4">
            {#each unnamedMemberships as { iteration, project } (iteration)}
              <div>
                <p class="pob-pane__meta mb-2">
                  Iteration {iteration}
                </p>
                <TeamMemberNameForm
                  {iteration}
                  {project}
                  chainId={chainId}
                  {signer}
                  currentName=""
                  onNameSet={() => { fetchMemberships(); onRefresh(); }}
                />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Request Certificate: links to per-iteration request pages -->
      {#if hasEligible && chainId !== null}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Request Certificate</h2>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            You can request certificates for these iterations:
          </p>
          <div class="space-y-2 mt-4">
            {#each eligibleIterations as { iteration, certType } (iteration)}
              <a
                href="/certs/request/{iteration}"
                class="pob-fieldset flex items-center justify-between no-underline cursor-pointer"
              >
                <span class="text-sm text-[var(--pob-text)]">Iteration {iteration} — <span class="text-[var(--pob-text-muted)]">{certType}</span></span>
                <span class="text-[var(--pob-text-muted)]">→</span>
              </a>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Pending Approvals: shown to the contract owner when there are pending team members -->
      {#if hasPending}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Pending Approvals</h2>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            These iterations have team members waiting for approval:
          </p>
          <div class="space-y-2 mt-4">
            {#each pendingIterations as iteration (iteration)}
              <a
                href="/certs/request/{iteration}"
                class="pob-fieldset flex items-center justify-between no-underline cursor-pointer"
              >
                <span class="text-sm text-[var(--pob-text)]">Iteration {iteration} — <span class="text-[var(--pob-text-muted)]">pending members</span></span>
                <span class="text-[var(--pob-text-muted)]">→</span>
              </a>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Empty state: no certs and no eligible iterations and no pending approvals -->
      {#if !hasCerts && !hasEligible && !hasPending}
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
