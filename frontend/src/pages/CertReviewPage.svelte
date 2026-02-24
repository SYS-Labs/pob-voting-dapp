<script lang="ts">
  import type { Iteration, TeamMember } from '~/interfaces';
  import type { JsonRpcSigner, Provider } from 'ethers';
  import { navigate } from 'svelte-routing';
  import { getCertNFTContract } from '~/utils/certNFT';
  import { approveTeamMember, rejectTeamMember, getTeamMembers, checkIsProject } from '~/utils/teamMembers';
  import { metadataAPI } from '~/utils/metadata-api';
  import { formatAddress, getExplorerAddressLink } from '~/utils';
  import { runTransaction, pendingAction } from '~/stores/transactions';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    tokenId: number;
    walletAddress: string | null;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    publicProvider: Provider | null;
    iterations: Iteration[];
    onRefresh: () => void;
  }

  let {
    tokenId,
    walletAddress,
    chainId,
    signer,
    publicProvider,
    iterations,
    onRefresh,
  }: Props = $props();

  interface PendingCert {
    tokenId: number;
    iteration: number;
    account: string;
    certType: string;
    requestTime: number;
    status: string;
  }

  let loading = $state(true);
  let isOwner = $state(false);
  let cert: PendingCert | null = $state(null);
  let members: TeamMember[] = $state([]);
  let projectName: string | null = $state(null);
  let reviewedAccountIsProject = $state(false);

  function certTypeLabel(t: string) {
    return t === 'winner' ? 'Winner' : t === 'participant' ? 'Participant' : t === 'organizer' ? 'Organizer' : t === 'speaker' ? 'Speaker' : t;
  }

  function getApiBaseUrl(): string {
    const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
    return envBaseUrl ? `${envBaseUrl}/api` : '/api';
  }

  function getJurySCForIteration(iterNum: number): string | null {
    const iter = iterations.find((i) => i.iteration === iterNum);
    return iter?.jurySC ?? null;
  }

  const hasProposedMembers = $derived(members.some((m) => m.status === 'Proposed'));
  const approvedMemberCount = $derived(members.filter((m) => m.status === 'Approved').length);
  const missingApprovedProjectMember = $derived(reviewedAccountIsProject && approvedMemberCount === 0);
  const isRequestedCert = $derived(cert?.status === 'requested');

  const displayName = $derived(
    projectName ?? (cert ? formatAddress(cert.account) : '')
  );

  async function fetchData() {
    if (!walletAddress || chainId === null || !publicProvider) {
      reviewedAccountIsProject = false;
      loading = false;
      return;
    }

    loading = true;
    reviewedAccountIsProject = false;

    try {
      // Verify wallet is CertNFT owner
      const certNFT = getCertNFTContract(chainId, publicProvider);
      if (!certNFT) {
        isOwner = false;
        reviewedAccountIsProject = false;
        loading = false;
        return;
      }

      const ownerAddr: string = await certNFT.owner();
      isOwner = ownerAddr.toLowerCase() === walletAddress.toLowerCase();

      if (!isOwner) {
        reviewedAccountIsProject = false;
        loading = false;
        return;
      }

      // Fetch pending certs and find the one matching tokenId
      const apiBaseUrl = getApiBaseUrl();
      const certsRes = await fetch(`${apiBaseUrl}/certs/${chainId}/pending`);
      if (!certsRes.ok) {
        cert = null;
        reviewedAccountIsProject = false;
        loading = false;
        return;
      }

      const certsData = await certsRes.json();
      const allCerts: PendingCert[] = certsData.certs || [];
      cert = allCerts.find((c) => c.tokenId === tokenId) ?? null;

      if (!cert) {
        reviewedAccountIsProject = false;
        loading = false;
        return;
      }

      reviewedAccountIsProject = await checkIsProject(chainId, cert.iteration, cert.account, publicProvider);

      // Fetch team members
      const membersRes = await fetch(`${apiBaseUrl}/team-members/${chainId}/${cert.iteration}/${cert.account}`);
      if (membersRes.ok) {
        const membersData = await membersRes.json();
        const rawMembers: Array<{ memberAddress: string; status: string; fullName: string }> = membersData.members || [];
        members = rawMembers.map((m) => ({
          memberAddress: m.memberAddress,
          status: (m.status === 'approved' ? 'Approved' : m.status === 'rejected' ? 'Rejected' : 'Proposed') as TeamMember['status'],
          fullName: m.fullName,
        }));
      } else {
        members = [];
      }

      // Resolve project name
      const jurySC = getJurySCForIteration(cert.iteration);
      if (jurySC) {
        try {
          const meta = await metadataAPI.getProjectMetadata(chainId, jurySC, cert.account);
          if (meta?.name) {
            projectName = meta.name;
          }
        } catch {
          // fall back to truncated address
        }
      }
    } catch {
      cert = null;
      reviewedAccountIsProject = false;
    } finally {
      loading = false;
    }
  }

  async function refreshMembersFromChain() {
    if (!cert || chainId === null || !publicProvider) return;
    try {
      members = await getTeamMembers(chainId, cert.iteration, cert.account, publicProvider);
    } catch {
      // fall back to full refetch if on-chain read fails
      fetchData();
    }
  }

  async function handleApproveMember(memberAddress: string) {
    if (!signer || chainId === null || !cert || cert.status !== 'requested') return;
    try {
      await runTransaction(
        'Approve team member',
        () => approveTeamMember(chainId!, cert!.iteration, cert!.account, memberAddress, signer!),
        async () => {
          await refreshMembersFromChain();
          onRefresh();
        }
      );
    } catch (err) {
      console.error('Failed to approve member:', err);
    }
  }

  async function handleRejectMember(memberAddress: string) {
    if (!signer || chainId === null || !cert || cert.status !== 'requested') return;
    try {
      await runTransaction(
        'Reject team member',
        () => rejectTeamMember(chainId!, cert!.iteration, cert!.account, memberAddress, signer!),
        async () => {
          await refreshMembersFromChain();
          onRefresh();
        }
      );
    } catch (err) {
      console.error('Failed to reject member:', err);
    }
  }

  async function handleApproveCert() {
    if (!signer || chainId === null || !cert || cert.status !== 'requested') return;
    try {
      await runTransaction(
        'Approve certificate',
        () => {
          const certNFT = getCertNFTContract(chainId!, signer!);
          if (!certNFT) throw new Error('CertNFT not available');
          return certNFT.approveCert(cert!.tokenId);
        },
        async () => {
          onRefresh();
          navigate('/certs');
        }
      );
    } catch (err) {
      console.error('Failed to approve cert:', err);
    }
  }

  async function handleCancelCert() {
    if (!signer || chainId === null || !cert || cert.status !== 'requested') return;
    try {
      await runTransaction(
        'Cancel certificate',
        () => {
          const certNFT = getCertNFTContract(chainId!, signer!);
          if (!certNFT) throw new Error('CertNFT not available');
          return certNFT.cancelCert(cert!.tokenId);
        },
        async () => {
          onRefresh();
          navigate('/certs');
        }
      );
    } catch (err) {
      console.error('Failed to cancel cert:', err);
    }
  }

  $effect(() => {
    if (walletAddress && chainId !== null && publicProvider) {
      fetchData();
    }
  });
</script>

<div class="pob-stack cert-review-page" id="cert-review-page">
  <a
    href="/certs"
    class="cert-review-page__back text-sm text-[var(--pob-primary)] hover:underline"
  >
    ← Back to Certificates
  </a>

  <section class="pob-pane pob-pane--subtle cert-review-page__pane">
    <div class="pob-pane__heading">
      <h2 class="pob-pane__title">Review Certificate{cert ? ` #${cert.tokenId}` : ''}</h2>
      <span class="pob-pill pob-pill--admin">Admin</span>
    </div>

    {#if !walletAddress}
      <div class="text-center py-8">
        <p class="text-sm text-[var(--pob-text-muted)]">Connect your wallet to review certificates.</p>
      </div>
    {:else if loading}
      <div class="flex flex-col items-center justify-center py-12">
        <ProgressSpinner size={48} className="mb-4" />
        <p class="text-sm text-[var(--pob-text-muted)]">Loading certificate data...</p>
      </div>
    {:else if !isOwner}
      <div class="text-center py-8">
        <p class="text-sm text-[var(--pob-text-muted)]">Only the CertNFT owner can review certificates.</p>
      </div>
    {:else if !cert}
      <div class="text-center py-8">
        <p class="text-sm text-[var(--pob-text-muted)]">Certificate not found or no longer pending.</p>
      </div>
    {:else}
      <p class="pob-pane__meta cert-review-page__meta">
        Iteration {cert.iteration} · {certTypeLabel(cert.certType)}
      </p>

      <div class="cert-review-page__subject">
        <a href="/iteration/{cert.iteration}/project/{cert.account}" class="cert-review-page__project-link text-sm font-semibold text-[var(--pob-text)] hover:underline">{displayName}</a>
        {#if chainId !== null}
          {@const explorerLink = getExplorerAddressLink(chainId, cert.account)}
          {#if explorerLink}
            <a href={explorerLink} target="_blank" rel="noopener noreferrer" class="pob-mono cert-review-page__explorer-link text-[var(--pob-primary)] hover:underline text-sm">{formatAddress(cert.account)}</a>
          {:else}
            <span class="pob-mono cert-review-page__explorer-link text-sm text-[var(--pob-text-dim)]">{formatAddress(cert.account)}</span>
          {/if}
        {/if}
      </div>

      <h3 class="pob-pane__title cert-review-page__team-title">Team Members</h3>

      {#if members.length > 0}
        <div class="cert-review-page__members">
          {#each members as member (member.memberAddress)}
            <div class="pob-fieldset cert-review-page__member-row">
              <div class="cert-review-page__member-info">
                {#if member.fullName}
                  <span class="cert-review-page__member-name text-sm text-[var(--pob-text)]">{member.fullName}</span>
                  {@const memberExplorerLink = chainId !== null ? getExplorerAddressLink(chainId, member.memberAddress) : null}
                  {#if memberExplorerLink}
                    <a
                      href={memberExplorerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="pob-mono cert-review-page__member-address cert-review-page__member-address-link text-xs text-[var(--pob-primary)] hover:underline"
                    >
                      {formatAddress(member.memberAddress)}
                    </a>
                  {:else}
                    <span class="cert-review-page__member-address text-xs text-[var(--pob-text-dim)]">{formatAddress(member.memberAddress)}</span>
                  {/if}
                {:else}
                  {@const memberExplorerLink = chainId !== null ? getExplorerAddressLink(chainId, member.memberAddress) : null}
                  {#if memberExplorerLink}
                    <a
                      href={memberExplorerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="pob-mono cert-review-page__member-address cert-review-page__member-address--mono cert-review-page__member-address-link text-sm text-[var(--pob-primary)] hover:underline"
                    >
                      {formatAddress(member.memberAddress)}
                    </a>
                  {:else}
                    <span class="pob-mono cert-review-page__member-address cert-review-page__member-address--mono text-sm text-[var(--pob-text-dim)]">{formatAddress(member.memberAddress)}</span>
                  {/if}
                  <span class="cert-review-page__member-no-name text-xs text-[var(--pob-text-dim)]">no name</span>
                {/if}
              </div>
              {#if member.status === 'Proposed'}
                <span class="cert-review-page__member-actions">
                  <button type="button" class="pob-button pob-button--small" disabled={$pendingAction !== null || !signer || !isRequestedCert} onclick={() => handleApproveMember(member.memberAddress)}>Approve</button>
                  <button type="button" class="pob-button pob-button--outline pob-button--small" disabled={$pendingAction !== null || !signer || !isRequestedCert} onclick={() => handleRejectMember(member.memberAddress)}>Reject</button>
                </span>
              {:else if member.status === 'Approved'}
                <span class="pob-pill pob-pill--success cert-review-page__member-status">Approved</span>
              {:else}
                <span class="pob-pill pob-pill--failure cert-review-page__member-status">Rejected</span>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-sm text-[var(--pob-text-dim)] cert-review-page__empty">No team members.</p>
      {/if}

      <div class="cert-review-page__actions">
        <button
          type="button"
          class="pob-button"
          disabled={$pendingAction !== null || !signer || !isRequestedCert || hasProposedMembers || missingApprovedProjectMember}
          title={!isRequestedCert
            ? 'Only requested certificates can be reviewed'
            : hasProposedMembers
            ? 'All team members must be resolved first'
            : missingApprovedProjectMember
              ? 'At least one approved team member is required'
              : ''}
          onclick={handleApproveCert}
        >Approve Certificate</button>
        <button
          type="button"
          class="pob-button pob-button--danger"
          disabled={$pendingAction !== null || !signer || !isRequestedCert}
          title={!isRequestedCert ? 'Only requested certificates can be cancelled from review' : ''}
          onclick={handleCancelCert}
        >Cancel Certificate</button>
      </div>

      <p class="cert-review-page__helper text-xs text-[var(--pob-text-dim)]">
        Approve or reject each team member individually, then approve the certificate to start the 48h finalization window. Cancel revokes the request and lets the project resubmit.{#if hasProposedMembers}&nbsp;<strong class="cert-review-page__helper-strong text-[var(--pob-text-muted)]">All members must be resolved before the certificate can be approved.</strong>{:else if missingApprovedProjectMember}&nbsp;<strong class="cert-review-page__helper-strong text-[var(--pob-text-muted)]">At least one team member must be approved before the certificate can be approved.</strong>{/if}
      </p>
    {/if}
  </section>
</div>

<style>
  .cert-review-page {
    align-self: start;
    align-content: start;
    gap: 0.85rem;
  }

  .cert-review-page__back {
    display: inline-flex;
    align-items: center;
    align-self: start;
    justify-self: start;
    width: max-content;
    min-height: 0;
    line-height: 1.15;
    padding: 0;
    margin: 0;
    opacity: 0.95;
  }

  .cert-review-page__pane {
    align-self: start;
  }

  .cert-review-page__meta {
    margin-bottom: 0.6rem;
  }

  .cert-review-page__subject {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.75rem 0.85rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.025);
  }

  .cert-review-page__project-link {
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }

  .cert-review-page__explorer-link {
    margin-left: 0;
    opacity: 0.95;
  }

  .cert-review-page__team-title {
    margin: 0 0 0.8rem;
    font-size: 1rem;
  }

  .cert-review-page__members {
    display: grid;
    gap: 0.55rem;
  }

  .cert-review-page__member-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.9rem;
    padding: 0.85rem 0.95rem;
    background: rgba(255, 255, 255, 0.02);
  }

  .cert-review-page__member-info {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.55rem;
  }

  .cert-review-page__member-name {
    font-weight: 600;
  }

  .cert-review-page__member-address {
    white-space: nowrap;
  }

  .cert-review-page__member-address-link {
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    opacity: 0.95;
  }

  .cert-review-page__member-address--mono {
    letter-spacing: 0.02em;
  }

  .cert-review-page__member-no-name {
    font-style: italic;
    opacity: 0.9;
  }

  .cert-review-page__member-actions {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .cert-review-page__member-status {
    justify-self: end;
  }

  .cert-review-page__empty {
    margin: 0.25rem 0 0;
  }

  .cert-review-page__actions {
    margin-top: 1.15rem;
    padding-top: 0.95rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem;
  }

  .cert-review-page__actions :global(.pob-button) {
    min-width: 11.5rem;
  }

  .cert-review-page__helper {
    margin: 0.45rem 0 0;
    line-height: 1.42;
    max-width: 78ch;
    width: 100%;
    padding: 0.7rem 0.8rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);
    text-wrap: pretty;
  }

  .cert-review-page__helper-strong {
    font-weight: 600;
    color: var(--pob-text);
  }

  @media (max-width: 767px) {
    .cert-review-page {
      gap: 0.7rem;
    }

    .cert-review-page__subject {
      padding: 0.65rem 0.75rem;
      gap: 0.35rem 0.5rem;
      margin-bottom: 0.85rem;
    }

    .cert-review-page__member-row {
      grid-template-columns: 1fr;
      align-items: start;
      gap: 0.65rem;
      padding: 0.75rem 0.8rem;
    }

    .cert-review-page__member-actions {
      width: 100%;
      justify-content: stretch;
    }

    .cert-review-page__member-actions :global(.pob-button) {
      flex: 1 1 0;
      min-width: 0;
      justify-content: center;
    }

    .cert-review-page__member-status {
      justify-self: start;
    }

    .cert-review-page__actions {
      gap: 0.6rem;
    }

    .cert-review-page__actions :global(.pob-button) {
      width: 100%;
      min-width: 0;
      justify-content: center;
    }

    .cert-review-page__helper {
      line-height: 1.35;
      margin-top: 0.25rem;
      padding: 0.6rem 0.7rem;
      border-radius: 9px;
    }
  }
</style>
