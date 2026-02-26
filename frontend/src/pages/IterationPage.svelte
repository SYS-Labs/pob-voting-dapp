<script lang="ts">
  import { Contract } from 'ethers';
  import type { Iteration, ParticipantRole, Project, Badge } from '~/interfaces';
  import IterationHeader from '~/components/IterationHeader.svelte';
  import PreviousRoundCard from '~/components/PreviousRoundCard.svelte';
  import ProjectCard from '~/components/ProjectCard.svelte';
  import OwnerPanel from '~/components/OwnerPanel.svelte';
  import JuryPanel from '~/components/JuryPanel.svelte';
  import ParticipantPanel from '~/components/ParticipantPanel.svelte';
  import BadgePanel from '~/components/BadgePanel.svelte';
  import DateTimePanel from '~/components/DateTimePanel.svelte';
  import ToolboxCard from '~/components/ToolboxCard.svelte';
  import Modal from '~/components/Modal.svelte';
  import VoteConfirmationModal from '~/components/VoteConfirmationModal.svelte';
  import PoBRegistryABI from '~/abis/PoBRegistry.json';
  import { NETWORKS } from '~/constants/networks';
  import { REGISTRY_ADDRESSES } from '~/utils/registry';
  import { iterationsAPI, type UserIterationBadgeStatus } from '~/utils/iterations-api';

  interface CommunityBadge {
    tokenId: string;
    hasVoted: boolean;
    vote: string | null;
    claimed?: boolean;
    iteration: number;
    round?: number;
  }

  interface RoleStatuses {
    community: boolean;
    smt: boolean;
    dao_hic: boolean;
    project: boolean;
  }

  interface StatusFlags {
    isActive: boolean;
    votingEnded: boolean;
  }

  interface IterationTimes {
    startTime: number | null;
    endTime: number | null;
  }

  interface Winner {
    projectAddress: string | null;
    hasWinner: boolean;
  }

  interface VoteCounts {
    smt: number;
    daoHic: number;
    community: number;
  }

  interface EntityVotes {
    smt: string | null;
    daoHic: string | null;
    community: string | null;
  }

  interface Props {
    currentIteration: Iteration | null;
    statusBadge: { label: string; color: string };
    iterationTimes: IterationTimes;
    projects: Project[];
    shuffledProjects: Project[];
    loading: boolean;
    roles: RoleStatuses;
    rolesLoading: boolean;
    isOwner: boolean;
    statusFlags: StatusFlags;
    communityBadges: CommunityBadge[];
    badges: Badge[];
    smtVote: string | null;
    daoHicVote: string | null;
    entityVotes: EntityVotes;
    pendingAction: string | null;
    walletAddress: string | null;
    chainId: number | null;
    projectsLocked: boolean;
    contractLocked: boolean;
    smtVoters: string[];
    daoHicVoters: string[];
    daoHicIndividualVotes: Record<string, string>;
    winner: Winner;
    voteCounts: VoteCounts;
    totalCommunityVoters: number;
    votingMode: number;
    projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null;
    openAdminSection: string | null;
    signer: any;
    publicProvider: any;
    getProjectLabel: (address: string | null) => string | null;
    executeMint: (role: ParticipantRole, refreshCallback?: () => Promise<void>) => Promise<void>;
    executeVote: (role: ParticipantRole, projectAddress: string, tokenId?: string, refreshCallback?: () => Promise<void>) => void;
    executeClaim: (tokenId: string) => void;
    handleToggleAdminSection: (sectionId: string) => void;
    runTransaction: (label: string, txFn: () => Promise<any>, refreshFn?: () => Promise<void>) => Promise<boolean>;
    refreshVotingData: () => Promise<void>;
    refreshProjects: () => Promise<void>;
    refreshOwnerData: () => Promise<void>;
    refreshBadges: () => Promise<void>;
    setPendingRemovalProject: (project: Project | null) => void;
    setPendingRemovalVoter: (voter: string | null) => void;
    setError: (error: string) => void;
    setVotingMode: (mode: number) => Promise<void>;
    onOpenDisconnect: () => void;
    onConnect: () => void;
  }

  let {
    currentIteration,
    statusBadge,
    iterationTimes,
    projects,
    shuffledProjects,
    loading,
    roles,
    rolesLoading,
    isOwner,
    statusFlags,
    communityBadges,
    badges,
    smtVote,
    daoHicVote,
    entityVotes,
    pendingAction,
    walletAddress,
    chainId,
    projectsLocked,
    contractLocked,
    smtVoters,
    daoHicVoters,
    daoHicIndividualVotes,
    winner,
    voteCounts,
    totalCommunityVoters,
    votingMode,
    projectScores,
    openAdminSection,
    signer,
    publicProvider,
    getProjectLabel,
    executeMint,
    executeVote,
    executeClaim,
    handleToggleAdminSection,
    runTransaction,
    refreshVotingData,
    refreshProjects,
    refreshOwnerData,
    refreshBadges,
    setPendingRemovalProject,
    setPendingRemovalVoter,
    setError,
    setVotingMode,
    onOpenDisconnect,
    onConnect,
  }: Props = $props();

  let sidebarVisible = $state(typeof window !== 'undefined' && window.innerWidth >= 1024);
  let showToolbox = $state(typeof window !== 'undefined' && window.innerWidth < 1024);
  let wasLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 1024;

  // Vote confirmation modal state
  let pendingVote = $state<{ project: Project; tokenId?: string } | null>(null);
  let userIterationBadgeStatus = $state<UserIterationBadgeStatus | null>(null);
  let userIterationBadgeStatusSeq = 0;
  let userIterationBadgeStatusKey = $state<string | null>(null);
  let roundSetupChecking = $state(false);
  let roundSetupConfirming = $state(false);
  let showRoundSetupModal = $state(false);
  let roundSetupError = $state<string | null>(null);
  let detectedRoundVersionId = $state<number | null>(null);
  let detectedRoundTypeLabel = $state<string | null>(null);
  let roundSetupTarget = $state<{ iterationId: number; roundId: number; jurySC: string } | null>(null);
  let lastCheckedRoundKey = $state<string | null>(null);
  let roundSetupCheckSeq = 0;

  // Handle resize
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      const isLargeScreen = window.innerWidth >= 1024;

      if (wasLargeScreen !== isLargeScreen) {
        wasLargeScreen = isLargeScreen;
        sidebarVisible = isLargeScreen;
        showToolbox = !isLargeScreen;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  $effect(() => {
    const iteration = currentIteration;
    const address = walletAddress;
    if (!iteration || !address) {
      userIterationBadgeStatus = null;
      userIterationBadgeStatusKey = null;
      return;
    }

    const nextKey = `${iteration.chainId}:${iteration.iteration}:${address.toLowerCase()}`;
    if (userIterationBadgeStatusKey === nextKey) {
      return;
    }

    const seq = ++userIterationBadgeStatusSeq;
    userIterationBadgeStatusKey = nextKey;
    const load = async () => {
      try {
        const data = await iterationsAPI.getUserIterationBadgeStatus(iteration.chainId, iteration.iteration, address);
        if (seq !== userIterationBadgeStatusSeq) return;
        userIterationBadgeStatus = data;
      } catch (error) {
        if (seq !== userIterationBadgeStatusSeq) return;
        console.warn('[IterationPage] Failed to load user badge status from API', error);
        userIterationBadgeStatus = null;
        userIterationBadgeStatusKey = null;
      }
    };

    load();
  });

  function handleToggleSidebar() {
    sidebarVisible = !sidebarVisible;
  }

  function describeRoundType(versionId: number): string {
    if (versionId === 3) return 'SMT round (SMT + DAO HIC + Community)';
    if (versionId === 2) return 'Role-isolated jury round';
    return 'Classic jury round (DevRel + DAO HIC + Community)';
  }

  async function detectRoundVersion(juryAddress: string, provider: any): Promise<number> {
    try {
      const v3Probe = new Contract(juryAddress, ['function getSmtVoters() view returns (address[])'], provider);
      await v3Probe.getSmtVoters();
      return 3;
    } catch {
      // continue
    }

    try {
      const v2Probe = new Contract(juryAddress, ['function getProjectAddresses() view returns (address[])'], provider);
      await v2Probe.getProjectAddresses();
      return 2;
    } catch {
      // continue
    }

    try {
      const v1Probe = new Contract(juryAddress, ['function getDevRelEntityVote() view returns (address)'], provider);
      await v1Probe.getDevRelEntityVote();
      return 1;
    } catch {
      throw new Error('Unable to detect round type from contract');
    }
  }

  async function checkRoundSetupRequirement() {
    const iteration = currentIteration;
    const round = iteration?.round;
    const roundNumber = typeof round === 'number' ? round : 0;

    const eligible = Boolean(
      isOwner &&
      chainId &&
      iteration &&
      roundNumber > 0
    );

    if (!eligible) {
      showRoundSetupModal = false;
      roundSetupChecking = false;
      roundSetupConfirming = false;
      roundSetupError = null;
      detectedRoundVersionId = null;
      detectedRoundTypeLabel = null;
      roundSetupTarget = null;
      lastCheckedRoundKey = null;
      return;
    }

    if (!chainId || !iteration) return;
    const registryAddress = REGISTRY_ADDRESSES[chainId];
    const readProvider = publicProvider ?? signer?.provider;
    if (!registryAddress || !readProvider) return;

    const seq = ++roundSetupCheckSeq;
    roundSetupChecking = true;
    roundSetupError = null;
    detectedRoundVersionId = null;
    detectedRoundTypeLabel = null;
    roundSetupTarget = null;
    let roundKey: string | null = null;

    try {
      const registry = new Contract(registryAddress, PoBRegistryABI, readProvider);
      const roundTargets = [
        {
          iterationId: iteration.iteration,
          roundId: roundNumber,
          jurySC: iteration.jurySC,
        },
        ...((iteration.prev_rounds ?? []).map((r) => ({
          iterationId: iteration.iteration,
          roundId: r.round,
          jurySC: r.jurySC,
        }))),
      ]
        .filter((r) => r.roundId > 0 && Boolean(r.jurySC))
        .sort((a, b) => b.roundId - a.roundId);

      let missingRound: { iterationId: number; roundId: number; jurySC: string } | null = null;
      for (const target of roundTargets) {
        const existingVersion = Number(await registry.roundVersion(target.iterationId, target.roundId));
        if (seq !== roundSetupCheckSeq) return;
        if (existingVersion === 0) {
          missingRound = target;
          break;
        }
      }

      if (!missingRound) {
        showRoundSetupModal = false;
        lastCheckedRoundKey = `${chainId}:${iteration.iteration}:all-set`;
        return;
      }

      roundKey = `${chainId}:${missingRound.iterationId}:${missingRound.roundId}:${missingRound.jurySC}`;
      const detectedVersion = await detectRoundVersion(missingRound.jurySC, readProvider);
      if (seq !== roundSetupCheckSeq) return;

      roundSetupTarget = missingRound;
      detectedRoundVersionId = detectedVersion;
      detectedRoundTypeLabel = describeRoundType(detectedVersion);
      showRoundSetupModal = true;
      lastCheckedRoundKey = roundKey;
    } catch (error) {
      if (seq !== roundSetupCheckSeq) return;
      roundSetupError = error instanceof Error ? error.message : 'Failed to check round setup.';
      showRoundSetupModal = true;
      lastCheckedRoundKey = roundKey ?? `${chainId}:${iteration.iteration}:setup-check-error`;
    } finally {
      if (seq === roundSetupCheckSeq) {
        roundSetupChecking = false;
      }
    }
  }

  async function handleConfirmRoundSetup() {
    if (roundSetupConfirming) return;
    if (!signer || !chainId || !roundSetupTarget || !detectedRoundVersionId) return;

    const registryAddress = REGISTRY_ADDRESSES[chainId];
    if (!registryAddress) {
      roundSetupError = 'Registry is not configured for this network.';
      return;
    }

    roundSetupConfirming = true;
    roundSetupError = null;

    try {
      const registry = new Contract(registryAddress, PoBRegistryABI, signer);
      const success = await runTransaction(
        'Finish Round Setup',
        () => registry.setRoundVersion(roundSetupTarget.iterationId, roundSetupTarget.roundId, detectedRoundVersionId),
        refreshVotingData,
      );

      if (success) {
        showRoundSetupModal = false;
        roundSetupTarget = null;
        detectedRoundVersionId = null;
        detectedRoundTypeLabel = null;
        lastCheckedRoundKey = null;
        void checkRoundSetupRequirement();
      }
    } catch (error) {
      roundSetupError = error instanceof Error ? error.message : 'Failed to finish round setup.';
    } finally {
      roundSetupConfirming = false;
    }
  }

  function retryRoundSetupCheck() {
    roundSetupTarget = null;
    lastCheckedRoundKey = null;
    void checkRoundSetupRequirement();
  }

  // Filter badges for current iteration and round
  const currentIterationBadges = $derived(
    badges.filter((badge) =>
      badge.iteration === currentIteration?.iteration &&
      badge.round === currentIteration?.round
    )
  );

  const currentIterationCommunityBadges = $derived(
    communityBadges.filter((badge) =>
      badge.iteration === currentIteration?.iteration &&
      badge.round === currentIteration?.round
    )
  );

  function handleClaim(tokenId: string) {
    executeClaim(tokenId);
  }

  async function handleVote(role: ParticipantRole, projectAddress: string, tokenId?: string) {
    await executeVote(role, projectAddress, tokenId, refreshVotingData);
  }

  function handleVoteClick(project: Project, tokenId?: string) {
    const votingRole: ParticipantRole | null = isOwner
      ? null
      : roles.project
        ? null
        : roles.smt
          ? 'smt'
          : roles.dao_hic
            ? 'dao_hic'
            : 'community';

    // Show modal only for community voters who need to mint first
    if (votingRole === 'community' && !tokenId) {
      pendingVote = { project, tokenId };
      return;
    }

    // Otherwise vote directly — TxPendingModal handles on-chain confirmation
    if (votingRole) {
      handleVote(votingRole, project.address, tokenId);
    }
  }

  async function handleConfirmVote() {
    if (!pendingVote) return;

    const votingRole: ParticipantRole | null = isOwner
      ? null
      : roles.project
        ? null
        : roles.smt
          ? 'smt'
          : roles.dao_hic
            ? 'dao_hic'
            : 'community';

    if (votingRole) {
      await handleVote(votingRole, pendingVote.project.address, pendingVote.tokenId);
      pendingVote = null;
    }
  }

  // Auto-update pendingVote.tokenId when a new badge appears
  $effect(() => {
    if (pendingVote && !pendingVote.tokenId && currentIterationCommunityBadges.length > 0) {
      const newBadge = currentIterationCommunityBadges[0];
      pendingVote = {
        project: pendingVote.project,
        tokenId: newBadge.tokenId
      };
    }
  });

  function handleCloseVoteModal() {
    pendingVote = null;
  }

  $effect(() => {
    void checkRoundSetupRequirement();
  });

  // Combined projects for finalized state
  const allProjectsForFinalized = $derived.by(() => {
    if (!statusFlags.votingEnded || !currentIteration) {
      return null;
    }

    const projectMap = new Map<string, Project>();
    let nextId = 1;

    for (const project of projects) {
      projectMap.set(project.address.toLowerCase(), project);
      if (project.id >= nextId) nextId = project.id + 1;
    }

    if (currentIteration.prev_rounds) {
      for (const round of currentIteration.prev_rounds) {
        if (round.projects) {
          for (const prevProject of round.projects) {
            const key = prevProject.address.toLowerCase();
            if (!projectMap.has(key)) {
              projectMap.set(key, {
                id: nextId++,
                address: prevProject.address,
                metadata: prevProject.metadata as unknown as Project['metadata'],
              });
            }
          }
        }
      }
    }

    const allProjects = Array.from(projectMap.values());
    const winnerAddress = winner.hasWinner ? winner.projectAddress?.toLowerCase() : null;

    return allProjects.sort((a, b) => {
      const aIsWinner = a.address.toLowerCase() === winnerAddress;
      const bIsWinner = b.address.toLowerCase() === winnerAddress;
      if (aIsWinner && !bIsWinner) return -1;
      if (!aIsWinner && bIsWinner) return 1;
      return 0;
    });
  });

  const displayProjects = $derived(allProjectsForFinalized ?? shuffledProjects);
</script>

{#if !showToolbox || !sidebarVisible}
  <div class="pob-stack lg:pr-4" style={!sidebarVisible ? 'grid-column: 1 / -1;' : ''}>
    <IterationHeader
      iteration={currentIteration}
      {statusBadge}
      {iterationTimes}
      votingEnded={statusFlags.votingEnded}
      {projectsLocked}
      {winner}
      {entityVotes}
      {daoHicIndividualVotes}
      {getProjectLabel}
      {isOwner}
      {walletAddress}
      {chainId}
      hasMintedStatus={currentIteration?.round ? (userIterationBadgeStatus?.rounds?.[String(currentIteration.round)]?.hasMinted ?? null) : null}
      {pendingAction}
      {roles}
      badges={currentIterationBadges}
      {executeMint}
      {refreshBadges}
      {votingMode}
      {projects}
      {projectScores}
    />

    {#if currentIteration?.prev_rounds && currentIteration.prev_rounds.length > 0}
      {#each currentIteration.prev_rounds as round (round.round)}
        <PreviousRoundCard
          {round}
          chainId={currentIteration.chainId}
          {publicProvider}
          {isOwner}
          {walletAddress}
          {signer}
          {pendingAction}
          {getProjectLabel}
          {runTransaction}
          {refreshBadges}
          iterationNumber={currentIteration.iteration}
          userBadges={badges.filter(b => b.iteration === currentIteration.iteration && b.round === round.round)}
          hasMintedStatus={userIterationBadgeStatus?.rounds?.[String(round.round)]?.hasMinted ?? null}
        />
      {/each}
    {/if}

    {#if currentIteration}
      <section class="pob-pane pob-pane--subtle">
        <div class="pob-pane__heading">
          <h3 class="pob-pane__title">Projects</h3>
          {#if statusFlags.votingEnded && allProjectsForFinalized && allProjectsForFinalized.length > projects.length}
            <span class="text-xs text-[var(--pob-text-muted)]">
              (all rounds)
            </span>
          {/if}
        </div>
        {#if displayProjects.length}
          <div class="projects-grid">
            {#each displayProjects as project (project.id)}
              {@const votingRole = !walletAddress
                ? null
                : isOwner
                  ? null
                  : roles.project
                    ? null
                    : roles.smt
                      ? 'smt'
                      : roles.dao_hic
                        ? 'dao_hic'
                        : 'community'}

              {@const hasVotedForThisProject =
                votingRole === 'smt'
                  ? smtVote?.toLowerCase() === project.address.toLowerCase()
                  : votingRole === 'dao_hic'
                    ? daoHicVote?.toLowerCase() === project.address.toLowerCase()
                    : votingRole === 'community'
                      ? currentIterationCommunityBadges.some(b => b.hasVoted && b.vote?.toLowerCase() === project.address.toLowerCase())
                      : false}

              {@const hasVotedAnywhere =
                votingRole === 'smt'
                  ? smtVote !== null
                  : votingRole === 'dao_hic'
                    ? daoHicVote !== null
                    : votingRole === 'community'
                      ? currentIterationCommunityBadges.some(b => b.hasVoted)
                      : false}

              {@const canVote = votingRole !== null &&
                               statusFlags.isActive &&
                               !statusFlags.votingEnded}

              {@const isProjectWinner = statusFlags.votingEnded &&
                winner.hasWinner &&
                winner.projectAddress?.toLowerCase() === project.address.toLowerCase()}

              <ProjectCard
                {project}
                {votingRole}
                hasVotedForProject={hasVotedForThisProject}
                {canVote}
                {isOwner}
                {projectsLocked}
                {pendingAction}
                onVote={(_projectAddress, tokenId) => handleVoteClick(project, tokenId)}
                onRemove={(proj) => {
                  if (projectsLocked) {
                    setError('Projects are locked after activation. Removal is disabled.');
                  } else {
                    setPendingRemovalProject(proj);
                  }
                }}
                communityBadges={currentIterationCommunityBadges}
                iterationNumber={currentIteration?.iteration}
                isWinner={isProjectWinner}
              />
            {/each}
          </div>
        {:else}
          <p class="text-sm text-[var(--pob-text-muted)]">
            {loading ? 'Loading projects…' : 'No registered projects yet.'}
          </p>
        {/if}
      </section>
    {/if}
  </div>
{/if}

{#if sidebarVisible}
  <div class="pob-stack lg:pl-4" style={showToolbox ? 'grid-column: 1 / -1;' : ''}>
    {#if isOwner}
      <DateTimePanel />
    {/if}

    {#if !showToolbox && !isOwner}
      <ParticipantPanel
        {roles}
        {walletAddress}
        iterationNumber={currentIteration?.iteration}
      />

      <JuryPanel
        {roles}
        {statusFlags}
        communityBadges={currentIterationCommunityBadges}
        badges={currentIterationBadges}
        {smtVote}
        {daoHicVote}
        {pendingAction}
        {walletAddress}
        {chainId}
        {getProjectLabel}
      />
    {/if}

    {#if !showToolbox}
      <BadgePanel
        badges={currentIterationBadges}
        communityBadges={currentIterationCommunityBadges}
        {walletAddress}
        {statusFlags}
        onClaim={handleClaim}
        {pendingAction}
        {voteCounts}
        {smtVoters}
        {daoHicVoters}
        {totalCommunityVoters}
      />
    {/if}

    {#if isOwner && currentIteration}
      <OwnerPanel
        {currentIteration}
        {statusFlags}
        {projectsLocked}
        {contractLocked}
        {smtVoters}
        {daoHicVoters}
        {winner}
        {pendingAction}
        {openAdminSection}
        {signer}
        {votingMode}
        {setVotingMode}
        {getProjectLabel}
        {handleToggleAdminSection}
        {runTransaction}
        {refreshVotingData}
        {refreshProjects}
        {refreshOwnerData}
        {refreshBadges}
        {setPendingRemovalVoter}
        {setError}
      />
    {/if}
  </div>
{/if}

{#if showToolbox}
  <ToolboxCard
    {sidebarVisible}
    onToggleSidebar={handleToggleSidebar}
    {walletAddress}
    {chainId}
    {isOwner}
    {roles}
    {daoHicVote}
    communityVoted={currentIterationCommunityBadges.some(b => b.hasVoted)}
    hasBadge={currentIterationBadges.length > 0}
    {getProjectLabel}
    {onOpenDisconnect}
    {onConnect}
    {pendingAction}
  />
{/if}

<Modal
  isOpen={showRoundSetupModal && !roundSetupConfirming && pendingAction === null}
  maxWidth="md"
  closeOnBackdropClick={false}
  closeOnEscape={false}
  showCloseButton={false}
>
  {#snippet children()}
    <div class="pob-pane">
      <div class="pob-pane__heading">
        <h3 class="pob-pane__title">Finish Round Setup</h3>
      </div>

      <div class="space-y-4">
        <p class="text-sm text-[var(--pob-text-muted)]">
          This round needs one final owner confirmation before admin actions are available.
        </p>

        {#if roundSetupTarget}
          <div class="pob-info">
            <p class="text-xs text-[var(--pob-text-muted)]">
              Iteration {roundSetupTarget.iterationId} • Round {roundSetupTarget.roundId}
            </p>
          </div>
        {/if}

        {#if roundSetupChecking}
          <div class="flex flex-col items-center justify-center gap-3 py-4">
            <ProgressSpinner size={36} />
            <p class="text-sm text-[var(--pob-text-muted)]">Checking round type...</p>
          </div>
        {:else if roundSetupError}
          <div class="pob-warning">
            <p class="text-xs">{roundSetupError}</p>
          </div>
        {:else if detectedRoundVersionId}
          <div class="pob-fieldset space-y-2">
            <p class="text-sm text-[var(--pob-text)]">
              Detected round type: <span class="font-semibold">{detectedRoundTypeLabel}</span>
            </p>
            <p class="text-xs text-[var(--pob-text-muted)]">
              This confirmation tells the app how to read this round correctly.
            </p>
          </div>
        {/if}

        <div class="flex gap-2 pt-1">
          {#if roundSetupError}
            <button
              type="button"
              class="pob-button pob-button--outline flex-1"
              onclick={retryRoundSetupCheck}
              disabled={roundSetupConfirming}
            >
              Retry
            </button>
          {/if}
          <button
            type="button"
            class="pob-button flex-1"
            onclick={handleConfirmRoundSetup}
            disabled={roundSetupChecking || roundSetupConfirming || !detectedRoundVersionId}
            style="opacity: {roundSetupChecking || roundSetupConfirming || !detectedRoundVersionId ? 0.6 : 1}; cursor: {roundSetupChecking || roundSetupConfirming || !detectedRoundVersionId ? 'not-allowed' : 'pointer'};"
          >
            {roundSetupConfirming ? 'Confirming...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  {/snippet}
</Modal>

<!-- Vote Confirmation Modal -->
{#if pendingVote}
  {@const votingRole = isOwner
    ? null
    : roles.project
      ? null
      : roles.smt
        ? 'smt'
        : roles.dao_hic
          ? 'dao_hic'
          : 'community'}

  {@const network = chainId ? NETWORKS[chainId] : null}
  {@const mintAmount = network?.mintAmount ?? '30'}
  {@const tokenSymbol = network?.tokenSymbol ?? 'TSYS'}

  {@const projectAddress = pendingVote.project.address.toLowerCase()}
  {@const hasVotedForThisProject = votingRole === 'smt'
    ? smtVote?.toLowerCase() === projectAddress
    : votingRole === 'dao_hic'
      ? daoHicVote?.toLowerCase() === projectAddress
      : votingRole === 'community'
        ? currentIterationCommunityBadges.some(b => b.hasVoted && b.vote?.toLowerCase() === projectAddress)
        : false}

  <VoteConfirmationModal
    isOpen={true}
    onClose={handleCloseVoteModal}
    onConfirm={handleConfirmVote}
    projectName={pendingVote.project.metadata?.name || `Project #${pendingVote.project.id}`}
    projectAddress={pendingVote.project.address}
    {votingRole}
    hasVotedForProject={hasVotedForThisProject}
    hasBadge={currentIterationBadges.length > 0}
    {executeMint}
    {refreshBadges}
    {mintAmount}
    {tokenSymbol}
    isPending={pendingAction !== null}
    {pendingAction}
  />
{/if}
