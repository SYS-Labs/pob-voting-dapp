<script lang="ts">
  import type { Cert, CertEligibility, TeamMember } from '~/interfaces';
  import { type JsonRpcSigner, type Provider } from 'ethers';
  import CertCard from '~/components/CertCard.svelte';
  import CertRequestForm from '~/components/CertRequestForm.svelte';
  import TeamMemberManager from '~/components/TeamMemberManager.svelte';
  import TeamMemberNameForm from '~/components/TeamMemberNameForm.svelte';
  import TeamMemberAdminPanel from '~/components/TeamMemberAdminPanel.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';
  import { checkIsProject, getTeamMembers, hasNamedTeamMembers } from '~/utils/teamMembers';

  interface Props {
    certs: Cert[];
    eligibility: Record<number, CertEligibility>;
    walletAddress: string | null;
    loading: boolean;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    onRefresh: () => void;
    isOwner?: boolean;
    publicProvider?: Provider | null;
    iterations?: number[];
  }

  let {
    certs,
    eligibility,
    walletAddress,
    loading,
    chainId,
    signer,
    onRefresh,
    isOwner = false,
    publicProvider = null,
    iterations = [],
  }: Props = $props();

  let projectStatus: Record<number, boolean> = $state({});
  let teamMembersMap: Record<number, TeamMember[]> = $state({});
  let namedMembersMap: Record<number, boolean> = $state({});
  let teamDataLoading = $state(false);

  const showLoader = $derived(loading && certs.length === 0 && walletAddress);

  const eligibleIterations = $derived(
    Object.entries(eligibility)
      .filter(([_, e]) => e.eligible)
      .map(([iter, e]) => ({ iteration: Number(iter), certType: e.certType }))
      .sort((a, b) => a.iteration - b.iteration)
  );

  const hasCerts = $derived(certs.length > 0);
  const hasEligible = $derived(eligibleIterations.length > 0);

  // Derive membership info: find iterations where the connected wallet is an
  // approved team member in one of the project teams we have loaded.
  const membershipInfo = $derived.by(() => {
    if (!walletAddress) return [];
    const results: Array<{ iteration: number; project: string; member: TeamMember }> = [];
    for (const [iterStr, members] of Object.entries(teamMembersMap)) {
      const iteration = Number(iterStr);
      for (const member of members) {
        if (
          member.memberAddress.toLowerCase() === walletAddress.toLowerCase() &&
          member.status === 'Approved'
        ) {
          // The project address for this team is our walletAddress (since we
          // only loaded teams where the wallet is the project).
          results.push({ iteration, project: walletAddress, member });
        }
      }
    }
    return results;
  });

  // Derive pending members across all loaded teams (for the admin panel).
  const pendingMembers = $derived.by(() => {
    if (!isOwner) return [];
    const results: Array<{ iteration: number; project: string; member: TeamMember }> = [];
    for (const [iterStr, members] of Object.entries(teamMembersMap)) {
      const iteration = Number(iterStr);
      for (const member of members) {
        if (member.status === 'Proposed') {
          results.push({ iteration, project: walletAddress!, member });
        }
      }
    }
    return results;
  });

  // Members that are approved but have not set their name yet (for the name form).
  const unnamedMemberships = $derived(
    membershipInfo.filter((info) => !info.member.fullName)
  );

  async function loadTeamData() {
    if (!walletAddress || !chainId || !publicProvider) return;
    teamDataLoading = true;

    const newProjectStatus: Record<number, boolean> = {};
    const newTeamMembers: Record<number, TeamMember[]> = {};
    const newNamedMembers: Record<number, boolean> = {};

    for (const { iteration } of eligibleIterations) {
      const isProj = await checkIsProject(chainId, iteration, walletAddress, publicProvider);
      newProjectStatus[iteration] = isProj;

      if (isProj) {
        const members = await getTeamMembers(chainId, iteration, walletAddress, publicProvider);
        newTeamMembers[iteration] = members;
        const hasNamed = await hasNamedTeamMembers(chainId, iteration, walletAddress, publicProvider);
        newNamedMembers[iteration] = hasNamed;
      }
    }

    projectStatus = newProjectStatus;
    teamMembersMap = newTeamMembers;
    namedMembersMap = newNamedMembers;
    teamDataLoading = false;
  }

  function refreshTeamData() {
    loadTeamData();
  }

  function handleTeamChangeAndRefresh() {
    refreshTeamData();
    onRefresh();
  }

  $effect(() => {
    if (walletAddress && chainId && publicProvider && eligibility) {
      loadTeamData();
    }
  });
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

      <!-- Team Member Name Form: shown when the wallet is an approved member without a name -->
      {#if unnamedMemberships.length > 0 && chainId !== null}
        <section class="pob-pane pob-pane--subtle">
          <div class="pob-pane__heading">
            <h2 class="pob-pane__title">Set Your Name</h2>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)] mb-4">
            You have been approved as a team member. Set your name for the certificate:
          </p>
          <div class="space-y-4">
            {#each unnamedMemberships as { iteration, project } (iteration)}
              <div>
                <h3 class="text-sm font-medium text-[var(--pob-text-secondary)] mb-2">
                  Iteration {iteration}
                </h3>
                <TeamMemberNameForm
                  {iteration}
                  {project}
                  chainId={chainId}
                  {signer}
                  currentName=""
                  onNameSet={handleTeamChangeAndRefresh}
                />
              </div>
            {/each}
          </div>
        </section>
      {/if}

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
                {#if projectStatus[iteration]}
                  <div class="mb-4">
                    <TeamMemberManager
                      {iteration}
                      chainId={chainId}
                      {signer}
                      walletAddress={walletAddress}
                      provider={publicProvider}
                      onTeamChange={refreshTeamData}
                    />
                  </div>
                {/if}
                <CertRequestForm
                  {iteration}
                  {certType}
                  chainId={chainId}
                  {signer}
                  onRequestComplete={onRefresh}
                  isProject={projectStatus[iteration] ?? false}
                  hasNamedTeamMembers={namedMembersMap[iteration] ?? true}
                />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Admin: Pending Team Members -->
      {#if isOwner && pendingMembers.length > 0 && chainId !== null}
        <TeamMemberAdminPanel
          {pendingMembers}
          chainId={chainId}
          {signer}
          onAction={handleTeamChangeAndRefresh}
        />
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
