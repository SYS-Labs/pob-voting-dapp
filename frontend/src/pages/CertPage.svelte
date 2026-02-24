<script lang="ts">
  import { ethers } from 'ethers';
  import type { Cert, TeamMember, Iteration } from '~/interfaces';
  import { getCertNFTContract } from '~/utils/certNFT';
  import { getPublicProviderForChain } from '~/stores/wallet';
  import { formatAddress, getExplorerAddressLink } from '~/utils/format';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';
  import NotFoundPage from '~/pages/NotFoundPage.svelte';

  interface Props {
    chainId: number;
    tokenId: string;
    walletAddress: string | null;
    filteredIterations: Iteration[];
  }

  let { chainId, tokenId, walletAddress, filteredIterations }: Props = $props();

  // ── State ──────────────────────────────────────────────────────────────────

  let loading = $state(true);
  let cert: Cert | null = $state(null);
  let teamMembers: TeamMember[] = $state([]);
  let access: 'public' | 'involved' | 'denied' | null = $state(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  const certStage = $derived(
    !cert                        ? 0 :
    cert.status === 'Cancelled'  ? 1 :
    cert.status === 'Requested'  ? 2 :
    cert.status === 'Pending'    ? 3 : 4
  );

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getApiBaseUrl(): string {
    const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
    return envBaseUrl ? `${envBaseUrl}/api` : '/api';
  }

  function resolveCertStatusFromEnum(status: number): Cert['status'] {
    if (status === 0) return 'Pending';
    if (status === 1) return 'Minted';
    if (status === 2) return 'Cancelled';
    if (status === 3) return 'Requested';
    return 'Cancelled';
  }

  function formatCountdown(requestTime: number): string {
    const PENDING_PERIOD = 172800; // 48 hours in seconds
    const now = Math.floor(Date.now() / 1000);
    const remaining = (requestTime + PENDING_PERIOD) - now;
    if (remaining <= 0) return 'Finalizing shortly';
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    return `Finalizing in ${hours}h ${minutes}m`;
  }

  function statusPillClass(status: Cert['status']): string {
    if (status === 'Minted') return 'pob-pill pob-pill--active';
    if (status === 'Cancelled') return 'pob-pill pob-pill--ended';
    return 'pob-pill pob-pill--upcoming';
  }

  function memberPillClass(status: TeamMember['status']): string {
    if (status === 'Approved') return 'pob-pill pob-pill--active';
    if (status === 'Rejected') return 'pob-pill pob-pill--ended';
    return 'pob-pill pob-pill--upcoming';
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  async function fetchTeamMembers(certData: Cert): Promise<TeamMember[]> {
    const provider = getPublicProviderForChain(chainId);
    if (!provider) return [];
    const certNFT = getCertNFTContract(chainId, provider);
    if (!certNFT) return [];
    try {
      const members = await certNFT.getTeamMembers(certData.iteration, certData.account);
      return members.map((m: any) => ({
        memberAddress: m.memberAddress,
        status: ((): TeamMember['status'] => {
          const s = Number(m.status);
          if (s === 0) return 'Proposed';
          if (s === 1) return 'Approved';
          return 'Rejected';
        })(),
        fullName: m.fullName,
      }));
    } catch {
      return [];
    }
  }

  async function determineAccess(certData: Cert): Promise<'public' | 'involved' | 'denied'> {
    if (certData.status === 'Minted') return 'public';
    if (!walletAddress) return 'denied';

    // Check if wallet is the cert account
    if (walletAddress.toLowerCase() === certData.account.toLowerCase()) return 'involved';

    // Check if wallet is a team member
    try {
      const apiBaseUrl = getApiBaseUrl();
      const res = await fetch(
        `${apiBaseUrl}/team-members/${chainId}/${certData.iteration}/${certData.account}`
      );
      if (res.ok) {
        const data = await res.json();
        const members: Array<{ memberAddress: string }> = data.members || [];
        const found = members.some(
          (m) => m.memberAddress.toLowerCase() === walletAddress!.toLowerCase()
        );
        if (found) return 'involved';
      }
    } catch {
      // fall through
    }

    // Check if wallet is the CertNFT contract owner
    const provider = getPublicProviderForChain(chainId);
    if (provider) {
      const certNFT = getCertNFTContract(chainId, provider);
      if (certNFT) {
        try {
          const owner: string = await certNFT.owner();
          if (owner.toLowerCase() === walletAddress.toLowerCase()) return 'involved';
        } catch {
          // fall through
        }
      }
    }

    return 'denied';
  }

  async function loadCert(): Promise<void> {
    loading = true;
    cert = null;
    teamMembers = [];
    access = null;

    try {
      const provider = getPublicProviderForChain(chainId);
      if (!provider) {
        access = 'denied';
        return;
      }

      const certNFT = getCertNFTContract(chainId, provider);
      if (!certNFT) {
        access = 'denied';
        return;
      }

      // Fetch cert struct
      const data = await certNFT.certs(BigInt(tokenId));
      if (!data || data.account === ethers.ZeroAddress) {
        access = 'denied';
        return;
      }

      // Fetch effective status from contract view function
      const statusEnum: bigint = await certNFT.certStatus(BigInt(tokenId));
      const effectiveStatus = resolveCertStatusFromEnum(Number(statusEnum));

      const certData: Cert = {
        tokenId,
        iteration: Number(data.iteration),
        account: data.account,
        certType: data.certType,
        status: effectiveStatus,
        requestTime: Number(data.requestTime),
      };

      cert = certData;

      const resolvedAccess = await determineAccess(certData);
      access = resolvedAccess;

      // Fetch team members if the user can see the cert
      if (resolvedAccess !== 'denied') {
        teamMembers = await fetchTeamMembers(certData);
      }
    } catch {
      access = 'denied';
    } finally {
      loading = false;
    }
  }

  // ── Effect: load when iterations are ready, re-run when wallet changes ──────

  $effect(() => {
    // Wait until filteredIterations is populated (signals mergeCertNFTAddresses ran)
    if (filteredIterations.length === 0) return;

    // Re-run whenever walletAddress changes
    const _wallet = walletAddress;
    void loadCert();
  });

  // ── Derived display helpers ─────────────────────────────────────────────────

  const backHref = $derived(
    access === 'involved' ? '/certs' : '/'
  );

  const explorerLink = $derived(
    cert ? getExplorerAddressLink(chainId, cert.account) : ''
  );

  const approvedMembers = $derived(
    teamMembers.filter((m) => m.status === 'Approved')
  );

  const nonApprovedMembers = $derived(
    teamMembers.filter((m) => m.status !== 'Approved')
  );
</script>

{#if loading}
  <div class="pob-stack">
    <section class="pob-pane pob-pane--subtle">
      <div class="flex flex-col items-center justify-center py-12">
        <ProgressSpinner size={48} className="mb-4" />
        <p class="text-sm text-[var(--pob-text-muted)]">Loading certificate...</p>
      </div>
    </section>
  </div>
{:else if access === 'denied' || access === null}
  <NotFoundPage />
{:else}
  <!-- access === 'public' | 'involved' -->
  <div class="pob-stack">
    <a href={backHref} class="text-sm text-[var(--pob-primary)] hover:underline">
      ← Back
    </a>

    <section class="pob-pane pob-pane--subtle">
      <!-- Heading row -->
      <div class="pob-pane__heading">
        <h2 class="pob-pane__title">Certificate #{tokenId}</h2>
        {#if cert}
          <span class={statusPillClass(cert.status)}>{cert.status}</span>
        {/if}
      </div>

      {#if cert}
        <!-- Sub-row: iteration and cert type -->
        <p class="pob-pane__meta mb-3">
          Iteration {cert.iteration} · {cert.certType}
        </p>

        <!-- Account row -->
        <div class="mb-4">
          {#if explorerLink}
            <a
              href={explorerLink}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-mono text-[var(--pob-primary)] hover:underline text-sm"
            >
              {cert.account}
            </a>
          {:else}
            <span class="pob-mono text-sm text-[var(--pob-text-dim)]">{cert.account}</span>
          {/if}
        </div>

        <!-- Stage info block — only shown to involved users for non-minted certs -->
        {#if access === 'involved' && certStage > 0 && certStage < 4}
          {#if certStage === 1}
            <!-- Cancelled -->
            <div class="pob-status-block mt-4">
              <p class="text-sm text-[var(--pob-text-muted)]">Certificate cancelled.</p>
            </div>
          {:else if certStage === 2}
            <!-- Requested -->
            <div class="pob-status-block mt-4">
              <p class="text-sm text-[var(--pob-text-muted)]">Awaiting owner review.</p>
            </div>
          {:else if certStage === 3}
            <!-- Pending -->
            <div class="pob-status-block mt-4">
              <p class="text-sm text-[var(--pob-text-muted)]">
                {formatCountdown(cert.requestTime)}
              </p>
            </div>
          {/if}
        {/if}
      {/if}

      <!-- Team members section -->
      {#if teamMembers.length > 0}
        <div class="mt-6">
          <h3 class="pob-pane__title mb-3">Team Members</h3>

          {#if approvedMembers.length > 0}
            <ul class="space-y-2">
              {#each approvedMembers as member (member.memberAddress)}
                <li class="pob-fieldset flex items-center justify-between">
                  <div>
                    {#if member.fullName}
                      <span class="text-sm text-[var(--pob-text)]">{member.fullName}</span>
                      <span class="text-xs text-[var(--pob-text-dim)] ml-2">
                        {formatAddress(member.memberAddress)}
                      </span>
                    {:else}
                      <span class="pob-mono text-sm text-[var(--pob-text-dim)]">
                        {formatAddress(member.memberAddress)}
                      </span>
                    {/if}
                  </div>
                  <span class={memberPillClass(member.status)}>{member.status}</span>
                </li>
              {/each}
            </ul>
          {/if}

          <!-- Show proposed/rejected members only to involved users with non-minted cert -->
          {#if access === 'involved' && certStage < 4 && nonApprovedMembers.length > 0}
            <ul class="space-y-2 mt-2">
              {#each nonApprovedMembers as member (member.memberAddress)}
                <li class="pob-fieldset flex items-center justify-between">
                  <div>
                    {#if member.fullName}
                      <span class="text-sm text-[var(--pob-text-muted)]">{member.fullName}</span>
                      <span class="text-xs text-[var(--pob-text-dim)] ml-2">
                        {formatAddress(member.memberAddress)}
                      </span>
                    {:else}
                      <span class="pob-mono text-sm text-[var(--pob-text-dim)]">
                        {formatAddress(member.memberAddress)}
                      </span>
                    {/if}
                  </div>
                  <span class={memberPillClass(member.status)}>{member.status}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Go to Request Page link — only for involved users with a cancelled cert -->
    {#if cert && access === 'involved' && certStage === 1}
      <a
        href="/certs/request/{cert.iteration}"
        class="pob-button pob-button--full text-center no-underline"
      >
        Go to Request Page
      </a>
    {/if}
  </div>
{/if}
