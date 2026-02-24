<script lang="ts">
  import type { JsonRpcSigner, Provider } from 'ethers';
  import type { Cert, CertEligibility } from '~/interfaces';
  import { getCertNFTContract, getUserCert, resubmitCert, checkCertEligibility } from '~/utils/certNFT';
  import { checkIsProject, hasNamedTeamMembers } from '~/utils/teamMembers';
  import { runTransaction, pendingAction } from '~/stores/transactions';
  import TeamMemberManager from '~/components/TeamMemberManager.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    iteration: number;
    walletAddress: string | null;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    publicProvider: Provider | null;
    onRefresh: () => void;
  }

  let {
    iteration,
    walletAddress,
    chainId,
    signer,
    publicProvider,
    onRefresh,
  }: Props = $props();

  let loading = $state(true);
  let eligibility: CertEligibility | null = $state(null);
  let existingCert: Cert | null = $state(null);
  let isProject = $state(false);
  let hasNamed = $state(false);
  let requestSuccess = $state(false);

  function getApiBaseUrl(): string {
    const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
    return envBaseUrl ? `${envBaseUrl}/api` : '/api';
  }

  const certStage = $derived(
    !existingCert                        ? 1 :
    existingCert.status === 'Cancelled'  ? 1 :
    existingCert.status === 'Requested'  ? 2 :
    existingCert.status === 'Pending'    ? 3 : 4
  );

  const needsNamedTeamMember = $derived(isProject && !hasNamed);

  const canRequest = $derived(
    walletAddress &&
    chainId !== null &&
    eligibility?.eligible &&
    $pendingAction === null &&
    !requestSuccess &&
    certStage === 1 &&
    !needsNamedTeamMember
  );

  const canResubmit = $derived(
    !!existingCert &&
    !!signer &&
    $pendingAction === null &&
    !requestSuccess &&
    certStage === 1 &&
    !needsNamedTeamMember
  );

  async function fetchData() {
    if (!walletAddress || chainId === null || !publicProvider) {
      loading = false;
      return;
    }

    loading = true;

    try {
      const apiBaseUrl = getApiBaseUrl();

      // Fetch eligibility from API
      const eligRes = await fetch(`${apiBaseUrl}/certs/${chainId}/eligible/${walletAddress}`);
      if (eligRes.ok) {
        const data = await eligRes.json();
        const rows: Array<CertEligibility & { iteration: number }> = data.eligibility || [];
        const entry = rows.find((e) => e.iteration === iteration);
        eligibility = entry ?? null;
      } else {
        eligibility = null;
      }

      // Fetch existing cert (to detect Cancelled state for resubmit UI)
      existingCert = await getUserCert(chainId, iteration, walletAddress, publicProvider);

      // Live eligibility fallback: accounts with registered roles may not be in the
      // eligibility index (indexer only covers devrel/daohic/project candidates).
      // If the API returned nothing and there is no existing cert, check on-chain.
      if (!eligibility && !existingCert) {
        const liveElig = await checkCertEligibility(chainId, iteration, walletAddress, publicProvider);
        if (liveElig?.eligible) {
          eligibility = { ...liveElig, iteration };
        }
      }

      // Check if this account is a project
      isProject = await checkIsProject(chainId, iteration, walletAddress, publicProvider);

      // If project, check for named team members
      if (isProject) {
        hasNamed = await hasNamedTeamMembers(chainId, iteration, walletAddress, publicProvider);
      } else {
        hasNamed = false;
      }

    } catch (err: any) {
      eligibility = null;
    } finally {
      loading = false;
    }
  }

  function refreshData() {
    fetchData();
    onRefresh();
  }

  async function handleRequest() {
    if (!signer || chainId === null) return;

    const certNFT = getCertNFTContract(chainId, signer);
    if (!certNFT) throw new Error('CertNFT contract not available for this network.');

    await runTransaction(
      'Request certificate',
      () => certNFT.requestCert(iteration),
      async () => {
        requestSuccess = true;
        onRefresh();
      }
    );
  }

  async function handleResubmit() {
    if (!signer || chainId === null || !existingCert) return;
    await runTransaction(
      'Resubmit certificate',
      () => resubmitCert(chainId!, existingCert!.tokenId, signer!),
      async () => {
        requestSuccess = true;
        onRefresh();
      }
    );
  }

  $effect(() => {
    if (walletAddress && chainId !== null && publicProvider) {
      fetchData();
    }
  });
</script>

<div class="pob-stack" id="cert-request-page">
  <a
    href="/certs"
    class="text-sm text-[var(--pob-primary)] hover:underline"
  >
    ← Back to Certificates
  </a>

  <section class="pob-pane pob-pane--subtle">
    <div class="pob-pane__heading">
      <h2 class="pob-pane__title">Request Certificate — Iteration {iteration}</h2>
    </div>

    {#if !walletAddress}
      <div class="text-center py-8">
        <p class="text-sm text-[var(--pob-text-muted)]">
          Connect your wallet to request a certificate.
        </p>
      </div>
    {:else if loading}
      <div class="flex flex-col items-center justify-center py-12">
        <ProgressSpinner size={48} className="mb-4" />
        <p class="text-sm text-[var(--pob-text-muted)]">
          Loading eligibility data...
        </p>
      </div>
    {:else if (!eligibility || !eligibility.eligible) && !existingCert}
      <div class="text-center py-8">
        <p class="text-sm text-[var(--pob-text-muted)]">
          You are not eligible for a certificate for this iteration.
        </p>
      </div>
    {:else}
      {#if eligibility}
        <p class="text-sm text-[var(--pob-text-muted)]">
          Certificate type: <strong class="text-[var(--pob-text)]">{eligibility.certType}</strong>
        </p>
      {/if}

      {#if certStage === 1}
        {#if existingCert}
          <!-- Stage 1: Cancelled cert — resubmit flow -->
          <div class="pob-status-block mt-4">
            <p class="text-sm font-semibold text-[var(--pob-text)]">
              Certificate cancelled — update your team and resubmit.
            </p>
          </div>
        {/if}

        {#if isProject && chainId !== null}
          <div class="mt-6">
            <TeamMemberManager
              {iteration}
              chainId={chainId}
              {signer}
              walletAddress={walletAddress}
              provider={publicProvider}
              onTeamChange={refreshData}
            />
          </div>
        {/if}

        <div class="mt-6">
          {#if requestSuccess}
            <div class="pob-status-block pob-status-block--success">
              <p class="text-sm">
                Certificate {existingCert ? 'resubmitted' : 'requested'} successfully! Awaiting owner review.
              </p>
            </div>
          {:else if existingCert}
            <button
              class="pob-button pob-button--full"
              disabled={!canResubmit}
              onclick={handleResubmit}
            >
              {#if $pendingAction === 'Resubmit certificate'}
                Resubmitting...
              {:else}
                Resubmit Certificate
              {/if}
            </button>
          {:else}
            <button
              class="pob-button pob-button--full"
              disabled={!canRequest}
              onclick={handleRequest}
            >
              {#if $pendingAction === 'Request certificate'}
                Requesting...
              {:else}
                Request Certificate
              {/if}
            </button>
          {/if}

          {#if needsNamedTeamMember}
            <p class="mt-2 text-xs text-[var(--pob-text-dim)]">
              Add and name at least one team member before requesting or resubmitting.
            </p>
          {/if}
        </div>
      {:else if certStage === 2}
        <div class="pob-status-block mt-4">
          <p class="text-sm text-[var(--pob-text-muted)]">
            Certificate requested — awaiting owner review.
          </p>
        </div>
      {:else if certStage === 3}
        <div class="pob-status-block mt-4">
          {#if existingCert}
            {@const remaining = (existingCert.requestTime + 48 * 3600) - Math.floor(Date.now() / 1000)}
            {@const hours = Math.max(0, Math.floor(remaining / 3600))}
            {@const minutes = Math.max(0, Math.floor((remaining % 3600) / 60))}
            <p class="text-sm text-[var(--pob-text-muted)]">
              Certificate approved — finalizing in {remaining > 0 ? `${hours}h ${minutes}m` : 'moments'}.
            </p>
          {:else}
            <p class="text-sm text-[var(--pob-text-muted)]">Certificate approved — finalizing.</p>
          {/if}
        </div>
      {:else}
        <div class="pob-status-block pob-status-block--success mt-4">
          <p class="text-sm font-semibold text-[var(--pob-text)]">Certificate minted!</p>
        </div>
      {/if}
    {/if}
  </section>
</div>
