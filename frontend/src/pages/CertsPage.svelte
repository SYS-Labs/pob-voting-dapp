<script lang="ts">
  import type { Cert, CertEligibility, Iteration } from '~/interfaces';
  import { type JsonRpcSigner, type Provider } from 'ethers';
  import { getCertNFTContract } from '~/utils/certNFT';
  import { metadataAPI } from '~/utils/metadata-api';
  import { formatAddress } from '~/utils';
  import { runTransaction, pendingAction } from '~/stores/transactions';
  import CertCard from '~/components/CertCard.svelte';
  import TeamMemberNameForm from '~/components/TeamMemberNameForm.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    certs: Cert[];
    eligibility: Record<number, CertEligibility>;
    iterations: Iteration[];
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
    iterations,
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
    status: string;
  }

  let memberships: MembershipEntry[] = $state([]);
  let stage1Pairs: Set<string> = $state(new Set());
  let stageVersion = $state(0);
  let namedLocally: Set<string> = $state(new Set());
  let isOwner: boolean = $state(false);
  let pendingCerts: Array<{
    tokenId: number;
    iteration: number;
    account: string;
    certType: string;
    requestTime: number;
    status: string;
  }> = $state([]);

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
        .filter((m) => m.status === 'approved' || m.status === 'proposed')
        .map((m) => ({ iteration: m.iteration, project: m.projectAddress, fullName: m.fullName, status: m.status }));
      fetchProjectNames();
      fetchMembershipStages();
    } catch {
      memberships = [];
    }
  }

  /**
   * Check cert stage for each membership's project+iteration.
   * setTeamMemberName only works at stage 1 (no cert or cancelled).
   * Fails closed: RPC errors exclude the pair (form not shown).
   */
  async function fetchMembershipStages() {
    const version = ++stageVersion;
    stage1Pairs = new Set();

    if (chainId === null || !publicProvider || memberships.length === 0) return;

    const certNFT = getCertNFTContract(chainId, publicProvider);
    if (!certNFT) return;

    const pairs = [...new Map(
      memberships.map((m) => [`${m.iteration}-${m.project}`, { iteration: m.iteration, project: m.project }])
    ).values()];

    const results = new Set<string>();
    await Promise.all(
      pairs.map(async ({ iteration, project }) => {
        try {
          const tokenId: bigint = await certNFT.certOf(project, iteration);
          if (tokenId === 0n) {
            // Genuinely no cert — stage 1
            results.add(`${iteration}-${project}`);
            return;
          }
          const statusEnum: bigint = await certNFT.certStatus(tokenId);
          // Cancelled (enum 2) = stage 1
          if (Number(statusEnum) === 2) {
            results.add(`${iteration}-${project}`);
          }
        } catch {
          // RPC error — fail closed, don't add to stage1Pairs
        }
      })
    );

    // Only apply if this is still the latest request
    if (version === stageVersion) {
      stage1Pairs = results;
    }
  }

  async function fetchOwnerData() {
    if (!walletAddress || chainId === null || !publicProvider) {
      isOwner = false;
      return;
    }
    try {
      const certNFT = getCertNFTContract(chainId, publicProvider);
      if (!certNFT) {
        isOwner = false;
        return;
      }
      const owner: string = await certNFT.owner();
      isOwner = owner.toLowerCase() === walletAddress.toLowerCase();

      if (isOwner) {
        const apiBaseUrl = getApiBaseUrl();
        try {
          const certsRes = await fetch(`${apiBaseUrl}/certs/${chainId}/pending`);
          if (certsRes.ok) {
            const certsData = await certsRes.json();
            pendingCerts = certsData.certs || [];
            fetchPendingCertNames();
          } else {
            pendingCerts = [];
          }
        } catch {
          pendingCerts = [];
        }
      } else {
        pendingCerts = [];
      }
    } catch {
      isOwner = false;
      pendingCerts = [];
    }
  }

  // Project name resolution: iteration+project → display name
  let projectNames: Record<string, string> = $state({});

  function getJurySCForIteration(iterNum: number): string | null {
    const iter = iterations.find((i) => i.iteration === iterNum);
    return iter?.jurySC ?? null;
  }

  function projectLabel(iteration: number, project: string): string {
    const key = `${iteration}-${project}`;
    return projectNames[key] || formatAddress(project);
  }

  function projectPageUrl(iteration: number, project: string): string {
    return `/iteration/${iteration}/project/${project}`;
  }

  async function fetchProjectNames() {
    if (!chainId || memberships.length === 0) return;

    const pairs = memberships.map((m) => ({ iteration: m.iteration, project: m.project }));
    const unique = [...new Map(pairs.map((p) => [`${p.iteration}-${p.project}`, p])).values()];
    const resolved: Record<string, string> = {};

    await Promise.all(
      unique.map(async ({ iteration, project }) => {
        const jurySC = getJurySCForIteration(iteration);
        if (!jurySC) return;
        try {
          const meta = await metadataAPI.getProjectMetadata(chainId!, jurySC, project);
          if (meta?.name) resolved[`${iteration}-${project}`] = meta.name;
        } catch { /* ignore */ }
      })
    );

    projectNames = { ...projectNames, ...resolved };
  }

  async function fetchPendingCertNames() {
    if (!chainId || pendingCerts.length === 0) return;

    const pairs = pendingCerts.map((c) => ({ iteration: c.iteration, project: c.account }));
    const unique = [...new Map(pairs.map((p) => [`${p.iteration}-${p.project}`, p])).values()];
    const resolved: Record<string, string> = {};

    await Promise.all(
      unique.map(async ({ iteration, project }) => {
        const jurySC = getJurySCForIteration(iteration);
        if (!jurySC) return;
        try {
          const meta = await metadataAPI.getProjectMetadata(chainId!, jurySC, project);
          if (meta?.name) resolved[`${iteration}-${project}`] = meta.name;
        } catch { /* ignore */ }
      })
    );

    if (Object.keys(resolved).length > 0) {
      projectNames = { ...projectNames, ...resolved };
    }
  }

  function certTypeLabel(certType: string): string {
    if (certType === 'winner') return 'Winner';
    if (certType === 'participant') return 'Participant';
    if (certType === 'organizer') return 'Organizer';
    if (certType === 'speaker') return 'Speaker';
    return certType;
  }

  function timeRemaining(requestTime: number): string {
    const PENDING_PERIOD = 48 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    const remaining = (requestTime + PENDING_PERIOD) - now;
    if (remaining <= 0) return 'Auto-finalizing';
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    return `${hours}h ${minutes}m remaining`;
  }

  const proposedMemberships = $derived(memberships.filter((m) => m.status === 'proposed' && stage1Pairs.has(`${m.iteration}-${m.project}`)));
  const unnamedMemberships = $derived(memberships.filter((m) => m.status === 'approved' && !m.fullName && !namedLocally.has(`${m.iteration}-${m.project}`) && stage1Pairs.has(`${m.iteration}-${m.project}`)));

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
  const hasProposed = $derived(proposedMemberships.length > 0);
  const hasUnnamed = $derived(unnamedMemberships.length > 0);
  const hasMemberships = $derived(memberships.length > 0);
  const hasPendingCerts = $derived(isOwner && pendingCerts.length > 0);
  const requestedCerts = $derived(pendingCerts.filter((c) => c.status === 'requested'));
  const awaitingFinalizeCerts = $derived(pendingCerts.filter((c) => c.status === 'pending'));

  async function handleFinalizeCert(tokenId: number) {
    if (!signer || chainId === null) return;
    try {
      await runTransaction(
        'Finalize certificate',
        () => {
          const certNFT = getCertNFTContract(chainId!, signer!);
          if (!certNFT) throw new Error('CertNFT not available');
          return certNFT.finalizeCert(tokenId);
        },
        async () => {
          pendingCerts = pendingCerts.filter((c) => c.tokenId !== tokenId);
          onRefresh();
        }
      );
    } catch (err) {
      console.error('Failed to finalize cert:', err);
    }
  }

  async function handleCancelCert(tokenId: number) {
    if (!signer || chainId === null) return;
    try {
      await runTransaction(
        'Cancel certificate',
        () => {
          const certNFT = getCertNFTContract(chainId!, signer!);
          if (!certNFT) throw new Error('CertNFT not available');
          return certNFT.cancelCert(tokenId);
        },
        async () => {
          pendingCerts = pendingCerts.filter((c) => c.tokenId !== tokenId);
          onRefresh();
        }
      );
    } catch (err) {
      console.error('Failed to cancel cert:', err);
    }
  }
</script>

<div class="pob-stack" id="certs-page">
  {#if walletAddress}
    {#if showLoader}
      <section class="pob-pane pob-pane--subtle">
        <div class="flex flex-col items-center justify-center py-12">
          <ProgressSpinner size={48} className="mb-4" />
          <p class="text-sm text-[var(--pob-text-muted)]">Loading your certificates...</p>
        </div>
      </section>
    {:else}
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

      {#if hasUnnamed && chainId !== null}
        <section class="pob-pane pob-pane--subtle" style="border-color: rgba(234, 179, 8, 0.4);">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Set Your Name</h2>
            <span class="pob-pill pob-pill--warning">Action required</span>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            You have been approved as a team member. Set your name below — it will appear on the certificate.
          </p>
          <div class="space-y-3 mt-4">
            {#each unnamedMemberships as { iteration, project } (`${iteration}-${project}`)}
              <div>
                <p class="pob-pane__meta mb-2">
                  Iteration {iteration} — <a href={projectPageUrl(iteration, project)} class="text-[var(--pob-primary)] hover:underline" style="text-transform: none; letter-spacing: normal;">{projectLabel(iteration, project)}</a>
                </p>
                <TeamMemberNameForm
                  {iteration}
                  {project}
                  chainId={chainId}
                  {signer}
                  currentName=""
                  onNameSet={() => { namedLocally.add(`${iteration}-${project}`); namedLocally = namedLocally; fetchMemberships(); onRefresh(); }}
                />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if hasProposed}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Team Membership</h2>
            <span class="pob-pill pob-pill--warning">Pending</span>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)] mb-4">
            You have been proposed as a team member. Set your name below — it will appear on the certificate once the owner approves your membership.
          </p>
          <div class="space-y-4">
            {#each proposedMemberships as m (`${m.iteration}-${m.project}`)}
              <div class="pob-fieldset">
                <div class="flex items-center justify-between mb-2">
                  <div>
                    <span class="text-sm text-[var(--pob-text)]">Iteration {m.iteration}</span>
                    <span class="text-xs text-[var(--pob-text-dim)]"> — </span>
                    <a href={projectPageUrl(m.iteration, m.project)} class="text-sm text-[var(--pob-primary)] hover:underline">
                      {projectLabel(m.iteration, m.project)}
                    </a>
                  </div>
                  <span class="pob-pill pob-pill--warning">Awaiting approval</span>
                </div>
                {#if m.fullName}
                  <p class="text-xs text-[var(--pob-text-muted)]">Name set: <strong class="text-[var(--pob-text)]">{m.fullName}</strong></p>
                {:else}
                  <TeamMemberNameForm
                    iteration={m.iteration}
                    project={m.project}
                    chainId={chainId}
                    {signer}
                    currentName=""
                    onNameSet={() => fetchMemberships()}
                  />
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}

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
              <a href="/certs/request/{iteration}" class="pob-fieldset flex items-center justify-between no-underline cursor-pointer">
                <span class="text-sm text-[var(--pob-text)]">Iteration {iteration} — <span class="text-[var(--pob-text-muted)]">{certType}</span></span>
                <span class="text-[var(--pob-text-muted)]">→</span>
              </a>
            {/each}
          </div>
        </section>
      {/if}

      {#if isOwner && requestedCerts.length > 0}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Requested Certificates</h2>
            <span class="pob-pill pob-pill--admin">Admin</span>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            Select a certificate to review team members and approve.
          </p>
          {#each requestedCerts as cert (cert.tokenId)}
            {@const resolvedName = projectLabel(cert.iteration, cert.account)}
            {@const hasName = resolvedName !== formatAddress(cert.account)}
            <a href="/certs/review/{cert.tokenId}" class="cert-list-item">
              <span class="text-sm text-[var(--pob-text)]">{hasName ? resolvedName : formatAddress(cert.account)}</span>
              <span class="pob-pill pob-pill--active" style="font-size: 0.6rem; padding: 0.1rem 0.45rem;">{certTypeLabel(cert.certType)}</span>
              <span class="pob-admin-voter__label">Iter {cert.iteration}</span>
              <span class="cert-list-item__arrow">→</span>
            </a>
          {/each}
        </section>
      {/if}

      {#if isOwner && awaitingFinalizeCerts.length > 0}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Pending Certificates</h2>
            <span class="pob-pill pob-pill--admin">Admin</span>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            Certificates in the 48-hour finalization window.
          </p>
          {#each awaitingFinalizeCerts as cert (cert.tokenId)}
            {@const resolvedName = projectLabel(cert.iteration, cert.account)}
            {@const hasName = resolvedName !== formatAddress(cert.account)}
            <div class="cert-detail" style="margin-top: 0.5rem;">
              <a href={projectPageUrl(cert.iteration, cert.account)} class="cert-detail__name">{hasName ? resolvedName : formatAddress(cert.account)}</a>
              <span class="pob-pill pob-pill--active" style="font-size: 0.6rem; padding: 0.1rem 0.45rem;">{certTypeLabel(cert.certType)}</span>
              <a href="/iteration/{cert.iteration}" class="pob-admin-voter__label hover:underline" style="text-decoration: none;">Iteration {cert.iteration}</a>
              <span class="pob-admin-voter__label">· Token #{cert.tokenId} ·</span>
              <span class="pob-pill pob-pill--warning" style="font-size: 0.6rem; padding: 0.1rem 0.45rem;">{timeRemaining(cert.requestTime)}</span>
              <div class="cert-detail__actions">
                <button type="button" class="pob-button pob-button--small" disabled={$pendingAction !== null || !signer} onclick={() => handleFinalizeCert(cert.tokenId)}>Early Mint</button>
                <button type="button" class="pob-button pob-button--small pob-button--danger" disabled={$pendingAction !== null || !signer} onclick={() => handleCancelCert(cert.tokenId)}>Cancel</button>
              </div>
            </div>
          {/each}
        </section>
      {/if}

      {#if !hasCerts && !hasEligible && !hasPendingCerts && !hasMemberships}
        <section class="pob-pane pob-pane--subtle">
          <div class="text-center py-12">
            <p class="text-sm text-[var(--pob-text-muted)] mb-4">You don't have any certificates yet.</p>
            <p class="text-sm text-[var(--pob-text-muted)]">Participate in an iteration to become eligible for a certificate.</p>
          </div>
        </section>
      {/if}
    {/if}
  {:else}
    <section class="pob-pane pob-pane--subtle">
      <p class="text-sm text-[var(--pob-text-muted)]">Connect your wallet to view your certificates.</p>
    </section>
  {/if}
</div>
