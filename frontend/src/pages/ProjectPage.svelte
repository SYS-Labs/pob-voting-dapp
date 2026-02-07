<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import type { Iteration, ParticipantRole, Project, Badge, CommunityBadge, RoleStatuses, StatusFlags } from '~/interfaces';
  import type { JsonRpcSigner } from 'ethers';
  import MarkdownRenderer from '~/components/MarkdownRenderer.svelte';
  import VoteConfirmationModal from '~/components/VoteConfirmationModal.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';
  import { formatAddress, getYouTubeEmbedUrl, getExplorerTxLink, getMetadataCidUrl } from '~/utils';
  import { NETWORKS } from '~/constants/networks';
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
  import { createRegistryStatusStore } from '~/stores/registryStatus';
  import { createProjectMetadataManager } from '~/stores/projectMetadataManager';

  interface Props {
    projectAddress: string;
    currentIteration: Iteration | null;
    projects: Project[];
    loading: boolean;
    roles: RoleStatuses;
    isOwner: boolean;
    projectsLocked: boolean;
    statusFlags: StatusFlags;
    communityBadges: CommunityBadge[];
    badges: Badge[];
    devRelVote: string | null;
    daoHicVote: string | null;
    pendingAction: string | null;
    walletAddress: string | null;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    getProjectLabel: (address: string | null) => string | null;
    executeMint: (role: ParticipantRole, refreshCallback?: () => Promise<void>) => Promise<void>;
    executeVote: (role: ParticipantRole, projectAddress: string, tokenId?: string, refreshCallback?: () => Promise<void>) => void;
    refreshVotingData: () => Promise<void>;
    refreshBadges: () => Promise<void>;
  }

  let {
    projectAddress,
    currentIteration,
    projects,
    loading,
    roles,
    isOwner,
    projectsLocked,
    statusFlags,
    communityBadges,
    badges,
    devRelVote,
    daoHicVote,
    pendingAction,
    walletAddress,
    chainId,
    signer,
    getProjectLabel,
    executeMint,
    executeVote,
    refreshVotingData,
    refreshBadges,
  }: Props = $props();

  let sidebarVisible = $state(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  let showVoteModal = $state(false);

  // Find the project - check current round first, then previous rounds
  const project = $derived.by(() => {
    if (!projectAddress) return null;
    const addrLower = projectAddress.toLowerCase();

    // Check current round projects
    const currentRoundProject = projects.find(p => p.address.toLowerCase() === addrLower);
    if (currentRoundProject) return currentRoundProject;

    // Check previous rounds if not found
    if (currentIteration?.prev_rounds) {
      for (const round of currentIteration.prev_rounds) {
        if (round.projects) {
          const prevProject = round.projects.find(p => p.address.toLowerCase() === addrLower);
          if (prevProject) {
            return {
              id: 0,
              address: prevProject.address,
              metadata: prevProject.metadata as unknown as Project['metadata'],
            };
          }
        }
      }
    }

    return null;
  });

  // Use iteration's chainId for registry status
  const iterationChainId = $derived(currentIteration?.chainId ?? null);
  const contractAddress = $derived(currentIteration?.jurySC ?? null);

  // Registry status store
  let registryStatusManager = $state<ReturnType<typeof createRegistryStatusStore> | null>(null);

  $effect(() => {
    const manager = createRegistryStatusStore(iterationChainId);
    registryStatusManager = manager;
    return () => manager.destroy();
  });

  const registryAvailable = $derived(registryStatusManager?.registryAvailable ?? false);

  let initializationComplete = $state<boolean | null>(null);
  let registryOwner = $state<string | null>(null);

  $effect(() => {
    const manager = registryStatusManager;
    if (!manager) {
      initializationComplete = null;
      registryOwner = null;
      return;
    }

    const unsubInit = manager.initializationComplete.subscribe((v: boolean | null) => {
      initializationComplete = v;
    });
    const unsubOwner = manager.registryOwner.subscribe((v: string | null) => {
      registryOwner = v;
    });

    return () => {
      unsubInit();
      unsubOwner();
    };
  });

  // Project metadata manager - use $effect for proper lifecycle management
  let metadataManager = $state<ReturnType<typeof createProjectMetadataManager> | null>(null);
  let metadataState = $state<{
    currentCID: string | null;
    currentTxHash: string | null;
    pendingCID: string | null;
    pendingTxHash: string | null;
    pendingConfirmations: number;
    metadata: import('~/interfaces').ProjectMetadata | null;
  }>({
    currentCID: null,
    currentTxHash: null,
    pendingCID: null,
    pendingTxHash: null,
    pendingConfirmations: 0,
    metadata: null,
  });

  $effect(() => {
    const addr = project?.address || null;
    const chain = iterationChainId;
    const contract = contractAddress;
    const sig = signer;

    if (!addr || !chain || !contract) {
      metadataManager = null;
      return;
    }

    const manager = createProjectMetadataManager(addr, chain, contract, sig);
    metadataManager = manager;

    // Subscribe to state changes
    const unsubscribe = manager.subscribe((state) => {
      metadataState = {
        currentCID: state.currentCID,
        currentTxHash: state.currentTxHash,
        pendingCID: state.pendingCID,
        pendingTxHash: state.pendingTxHash,
        pendingConfirmations: state.pendingConfirmations,
        metadata: state.metadata,
      };
    });

    return () => {
      unsubscribe();
      manager.destroy();
    };
  });

  const currentCID = $derived(metadataState.currentCID);
  const currentTxHash = $derived(metadataState.currentTxHash);
  const pendingCID = $derived(metadataState.pendingCID);
  const pendingTxHash = $derived(metadataState.pendingTxHash);
  const pendingConfirmations = $derived(metadataState.pendingConfirmations);

  // Auto-hide sidebar below 1024px breakpoint
  $effect(() => {
    if (typeof window === 'undefined') return;

    let wasLargeScreen = window.innerWidth >= 1024;

    const handleResize = () => {
      const isLargeScreen = window.innerWidth >= 1024;
      if (wasLargeScreen !== isLargeScreen) {
        wasLargeScreen = isLargeScreen;
        sidebarVisible = isLargeScreen;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  // Filter badges to only those for the current iteration and round
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

  // Determine voting role
  const votingRole: ParticipantRole | null = $derived.by(() => {
    if (!walletAddress) return null;
    if (isOwner) return null;
    if (roles.project) return null;
    if (roles.devrel) return 'devrel';
    if (roles.dao_hic) return 'dao_hic';
    return 'community';
  });

  // Check if user has voted for this project
  const hasVotedForThisProject = $derived.by(() => {
    if (!project) return false;
    if (votingRole === 'devrel') {
      return devRelVote?.toLowerCase() === project.address.toLowerCase();
    }
    if (votingRole === 'dao_hic') {
      return daoHicVote?.toLowerCase() === project.address.toLowerCase();
    }
    if (votingRole === 'community') {
      return currentIterationCommunityBadges.some(
        b => b.hasVoted && b.vote?.toLowerCase() === project.address.toLowerCase()
      );
    }
    return false;
  });

  // Check if user has voted anywhere
  const hasVotedAnywhere = $derived.by(() => {
    if (votingRole === 'devrel') return devRelVote !== null;
    if (votingRole === 'dao_hic') return daoHicVote !== null;
    if (votingRole === 'community') return currentIterationCommunityBadges.some(b => b.hasVoted);
    return false;
  });

  // Can vote (can always change vote during active voting)
  const canVote = $derived(
    votingRole !== null &&
    statusFlags.isActive &&
    !statusFlags.votingEnded
  );

  // Handle vote button click - opens confirmation modal
  function handleVoteClick() {
    if (!votingRole || !project) return;
    showVoteModal = true;
  }

  // Handle confirmed vote from modal
  async function handleConfirmVote() {
    if (!votingRole || !project) return;
    const tokenId = votingRole === 'community' ? currentIterationCommunityBadges[0]?.tokenId : undefined;
    await executeVote(votingRole, project.address, tokenId, refreshVotingData);
    showVoteModal = false;
  }

  // Legacy handleVote for DevRel/DAO HIC (they don't need mint flow)
  async function handleVote() {
    if (!votingRole || !project) return;
    const tokenId = votingRole === 'community' ? currentIterationCommunityBadges[0]?.tokenId : undefined;
    await executeVote(votingRole, project.address, tokenId, refreshVotingData);
  }

  // Get network-specific values
  const network = $derived(chainId ? NETWORKS[chainId] : null);
  const mintAmount = $derived(network?.mintAmount ?? '30');
  const tokenSymbol = $derived(network?.tokenSymbol ?? 'TSYS');

  // Determine header role tag
  const headerRoleTag = $derived.by(() => {
    if (roles.devrel) return { label: ROLE_LABELS.devrel, color: ROLE_COLORS.devrel };
    if (roles.dao_hic) return { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic };
    if (roles.community || (!roles.project && !isOwner)) {
      return { label: ROLE_LABELS.community, color: ROLE_COLORS.community };
    }
    return null;
  });

  const hasJuryRole = $derived(roles.devrel || roles.dao_hic || roles.community);
  const canBecomeCommunity = $derived(!roles.project && !roles.devrel && !roles.dao_hic && !roles.community && !isOwner);
  const hasDevRelBadge = $derived(currentIterationBadges?.some(badge => badge.role === 'devrel') ?? false);
  const hasDaoHicBadge = $derived(currentIterationBadges?.some(badge => badge.role === 'dao_hic') ?? false);

  const canEditMetadata = $derived.by(() => {
    if (!project || !walletAddress || !registryAvailable) return false;
    if (initializationComplete === null) return false;

    const walletLower = walletAddress.toLowerCase();
    const isRegistryOwner = Boolean(registryOwner && walletLower === registryOwner.toLowerCase());
    const isProjectWallet = walletLower === project.address.toLowerCase();

    if (!initializationComplete) {
      // Before initialization complete: only owner can edit
      return isRegistryOwner;
    }

    // After initialization complete: only project wallet, and only when not locked
    return isProjectWallet && !projectsLocked;
  });

  // Can see metadata status section: registry owner or project wallet
  const canSeeMetadataStatus = $derived.by(() => {
    if (!project || !walletAddress) return false;
    const walletLower = walletAddress.toLowerCase();
    const isRegistryOwner = Boolean(registryOwner && walletLower === registryOwner.toLowerCase());
    const isProjectWallet = walletLower === project.address.toLowerCase();
    return isRegistryOwner || isProjectWallet;
  });

  // Use registry metadata (freshest) when available, fall back to project.metadata (from contractState)
  const resolvedMetadata = $derived(metadataState.metadata ?? project?.metadata ?? null);
  const projectName = $derived(resolvedMetadata?.name ?? `Project #${project?.id ?? 0}`);
  const embedUrl = $derived(getYouTubeEmbedUrl(resolvedMetadata?.yt_vid ?? null));
</script>

{#if loading}
  <div class="pob-stack">
    <p class="text-sm text-[var(--pob-text-muted)]">Loading project...</p>
  </div>
{:else if !project}
  <div class="pob-stack">
    <section class="pob-pane">
      <p class="text-sm text-[var(--pob-text-muted)]">Project not found.</p>
      <Link
        to={`/iteration/${currentIteration?.iteration ?? 1}`}
        class="pob-button pob-button--outline pob-button--compact"
        style="margin-top: 1rem; display: inline-flex;"
      >
        Back to Iteration
      </Link>
    </section>
  </div>
{:else}
  <!-- Main content -->
  <div class="pob-stack lg:pr-4" style={!sidebarVisible ? 'grid-column: 1 / -1;' : ''}>
    <!-- Back link -->
    <Link
      to={`/iteration/${currentIteration?.iteration ?? 1}`}
      class="text-sm text-[var(--pob-text-muted)] hover:text-[var(--pob-primary)]"
      style="display: inline-flex; align-items: center; gap: 0.5rem;"
    >
      ← Back to Projects
    </Link>

    <!-- Project card without vote button -->
    <section class="pob-pane">
      <div class="space-y-4">
        <div class="pob-pane__heading project-page__heading">
          <div>
            <h1 class="project-page__title">{projectName}</h1>
            <p class="pob-mono text-xs text-[var(--pob-text-muted)]">
              {formatAddress(project.address)}
            </p>
          </div>
          {#if canEditMetadata}
            <Link
              to={`/iteration/${currentIteration?.iteration}/project/${project.address}/edit`}
              class="pob-button pob-button--outline pob-button--compact project-page__edit"
            >
              Edit
            </Link>
          {/if}
        </div>

        <!-- Full description -->
        <div class="project-page__description">
          <MarkdownRenderer content={resolvedMetadata?.description} />
        </div>

        <!-- Video embed -->
        {#if embedUrl}
          <div class="pob-video" style="margin-top: 1.5rem; margin-bottom: 1rem;">
            <iframe
              src={embedUrl}
              title={`Project video for ${projectName}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            ></iframe>
          </div>
        {/if}

        <!-- Proposal link -->
        {#if resolvedMetadata?.proposal}
          <div style="margin-top: 1rem;">
            <a
              href={resolvedMetadata.proposal}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-button pob-button--outline pob-button--compact"
            >
              Read full proposal
            </a>
          </div>
        {/if}

        <!-- Social links + on-chain metadata links -->
        <div class="pob-socials" style="margin-top: 1.5rem;">
          <!-- Social links on the left -->
          {#if resolvedMetadata?.socials?.x}
            <a
              href={resolvedMetadata.socials.x}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-socials__link pob-socials__link--x"
              title="X (Twitter)"
            >
              X
            </a>
          {/if}
          {#if resolvedMetadata?.socials?.instagram}
            <a
              href={resolvedMetadata.socials.instagram}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-socials__link"
              title="Instagram"
            >
              Instagram
            </a>
          {/if}
          {#if resolvedMetadata?.socials?.tiktok}
            <a
              href={resolvedMetadata.socials.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-socials__link"
              title="TikTok"
            >
              TikTok
            </a>
          {/if}
          {#if resolvedMetadata?.socials?.linkedin}
            <a
              href={resolvedMetadata.socials.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-socials__link"
              title="LinkedIn"
            >
              LinkedIn
            </a>
          {/if}

          <!-- Spacer to push on-chain links to the right -->
          <span style="flex: 1;"></span>

          <!-- On-chain metadata links on the right -->
          {#if currentCID}
            <a
              href={getMetadataCidUrl(currentCID)}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-socials__link"
              title={`IPFS CID: ${currentCID}`}
            >
              📦 IPFS
            </a>
          {/if}
          {#if currentTxHash && iterationChainId}
            <a
              href={getExplorerTxLink(iterationChainId, currentTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-socials__link"
              title={`Transaction: ${currentTxHash}`}
            >
              ⛓️ TX
            </a>
          {/if}
        </div>

        <!-- Metadata Status Section - visible to owner/project wallet only -->
        {#if canSeeMetadataStatus && pendingCID}
          {#if !currentCID}<div class="pob-pane__divider"></div>{/if}
          <div class="flex items-center gap-2 justify-end" style={currentCID ? 'margin-top: 0.75rem;' : ''}>
            <p class="pob-pane__meta">Updating...</p>
            <span class="pob-pill flex items-center gap-1">
              <ProgressSpinner size={16} progress={Math.min((pendingConfirmations / 5) * 100, 100)} />
              {pendingConfirmations}/5
            </span>
          </div>
        {/if}
      </div>
    </section>
  </div>

  <!-- Sidebar with voting panel -->
  {#if sidebarVisible}
    <div class="pob-stack lg:pl-4">
      <!-- Jury Panel - Vote for this specific project -->
      {#if (hasJuryRole || canBecomeCommunity) && !isOwner}
        <section class="pob-pane">
          <div class="pob-pane__heading">
            <h3 class="pob-pane__title">Jury Panel</h3>
            {#if headerRoleTag}
              <span class={`pob-pill ${headerRoleTag.color}`}>
                {headerRoleTag.label}
              </span>
            {/if}
          </div>

          <div class="space-y-3">
            <!-- DevRel Role -->
            {#if roles.devrel}
              <p class="text-sm text-[var(--pob-text-muted)]">
                As DevRel, cast your vote for <span class="font-semibold text-white">{projectName}</span>.
              </p>
              {#if devRelVote}
                <p class="text-sm text-[var(--pob-text-muted)]">
                  Currently voted for{' '}
                  <span class="italic">
                    {getProjectLabel(devRelVote) ?? 'Unknown project'}
                  </span>
                </p>
              {/if}
              {#if canVote}
                <button
                  type="button"
                  onclick={handleVote}
                  disabled={pendingAction !== null}
                  class="pob-button w-full justify-center"
                >
                  {hasVotedForThisProject ? 'Voted' : hasVotedAnywhere ? 'Change Vote' : 'Vote'}
                </button>
              {/if}
              {#if !hasDevRelBadge && statusFlags.votingEnded}
                <button
                  type="button"
                  onclick={() => void executeMint('devrel', refreshBadges)}
                  class="pob-button pob-button--outline w-full justify-center text-xs"
                  disabled={pendingAction !== null || !walletAddress}
                >
                  Mint DevRel badge
                </button>
              {/if}
            {/if}

            <!-- DAO HIC Role -->
            {#if roles.dao_hic}
              <p class="text-sm text-[var(--pob-text-muted)]">
                As a DAO HIC voter, cast your vote for <span class="font-semibold text-white">{projectName}</span>.
              </p>
              {#if daoHicVote}
                <p class="text-sm text-[var(--pob-text-muted)]">
                  Currently voted for{' '}
                  <span class="italic">
                    {getProjectLabel(daoHicVote) ?? 'Unknown project'}
                  </span>
                </p>
              {/if}
              {#if canVote}
                <button
                  type="button"
                  onclick={handleVote}
                  disabled={pendingAction !== null}
                  class="pob-button w-full justify-center"
                >
                  {hasVotedForThisProject ? 'Voted' : hasVotedAnywhere ? 'Change Vote' : 'Vote'}
                </button>
              {/if}
              {#if !hasDaoHicBadge && statusFlags.votingEnded}
                <button
                  type="button"
                  onclick={() => void executeMint('dao_hic', refreshBadges)}
                  class="pob-button pob-button--outline w-full justify-center text-xs"
                  disabled={pendingAction !== null || !walletAddress}
                >
                  Mint DAO HIC badge
                </button>
              {/if}
            {/if}

            <!-- Community Role -->
            {#if roles.community || canBecomeCommunity}
              <p class="text-sm text-[var(--pob-text-muted)]">
                {#if hasVotedAnywhere}
                  Currently voted for{' '}
                  <span class="italic">
                    {getProjectLabel(currentIterationCommunityBadges.find(b => b.hasVoted)?.vote ?? null) ?? 'Unknown'}
                  </span>
                {:else}
                  Vote for <span class="font-semibold text-white">{projectName}</span>.
                {/if}
              </p>
              {#if statusFlags.isActive && !statusFlags.votingEnded && walletAddress}
                <button
                  type="button"
                  onclick={handleVoteClick}
                  disabled={pendingAction !== null}
                  class="pob-button w-full justify-center"
                >
                  {hasVotedForThisProject ? 'Voted' : hasVotedAnywhere ? 'Change Vote' : 'Vote'}
                </button>
              {/if}
              {#if statusFlags.isActive}
                <p class="text-xs text-[var(--pob-text-muted)] italic">
                  You can change your vote at any time during the voting period.
                </p>
              {/if}
            {/if}

            <!-- Voting ended message -->
            {#if statusFlags.votingEnded}
              <p class="text-xs text-[var(--pob-text-muted)] italic">
                Voting has ended for this iteration.
              </p>
            {/if}

            <!-- Not active yet -->
            {#if !statusFlags.isActive && !statusFlags.votingEnded}
              <p class="text-xs text-[var(--pob-text-muted)] italic">
                Voting has not started yet.
              </p>
            {/if}
          </div>
        </section>
      {/if}

      <!-- Owner message -->
      {#if isOwner}
        <section class="pob-pane">
          <div class="pob-pane__heading">
            <h3 class="pob-pane__title">Owner View</h3>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            As the contract owner, you cannot vote on projects.
          </p>
        </section>
      {/if}

      <!-- Project participant message -->
      {#if roles.project && !isOwner}
        <section class="pob-pane">
          <div class="pob-pane__heading">
            <h3 class="pob-pane__title">Participant View</h3>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            As a project participant, you cannot vote on projects.
          </p>
        </section>
      {/if}
    </div>
  {/if}

  <!-- Mobile toggle for sidebar -->
  {#if !sidebarVisible && (hasJuryRole || canBecomeCommunity) && !isOwner}
    <button
      type="button"
      onclick={() => sidebarVisible = true}
      class="pob-button pob-button--outline"
      style="position: fixed; bottom: 1rem; right: 1rem; z-index: 50;"
    >
      Vote
    </button>
  {/if}

  <!-- Vote Confirmation Modal -->
  {#if project && showVoteModal}
    <VoteConfirmationModal
      isOpen={true}
      onClose={() => showVoteModal = false}
      onConfirm={handleConfirmVote}
      {projectName}
      projectAddress={project.address}
      {votingRole}
      hasVotedForProject={hasVotedForThisProject}
      hasBadge={currentIterationBadges.length > 0}
      {executeMint}
      {refreshBadges}
      isPending={pendingAction !== null}
      {mintAmount}
      {tokenSymbol}
    />
  {/if}
{/if}
