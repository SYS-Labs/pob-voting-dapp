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

  interface ProjectContext {
    project: Project;
    jurySC: string;
    round: number | null;
    historical: boolean;
  }

  interface ProjectLink {
    label: string;
    href: string;
    title: string;
    className?: string;
  }

  function getProjectInitials(name: string): string {
    const words = name
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) return 'PB';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

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
    smtVote: string | null;
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
    onConnect?: () => void;
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
    smtVote,
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
    onConnect,
  }: Props = $props();

  let sidebarVisible = $state(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  let showVoteModal = $state(false);

  // Find the project and the round context it belongs to
  const projectContext = $derived.by((): ProjectContext | null => {
    if (!projectAddress) return null;
    const addrLower = projectAddress.toLowerCase();

    // Check current round projects
    const currentRoundProject = projects.find(p => p.address.toLowerCase() === addrLower);
    if (currentRoundProject && currentIteration?.jurySC) {
      return {
        project: currentRoundProject,
        jurySC: currentIteration.jurySC,
        round: currentIteration.round ?? null,
        historical: false,
      };
    }

    // Check previous rounds if not found
    if (currentIteration?.prev_rounds) {
      for (const round of currentIteration.prev_rounds) {
        if (round.projects) {
          const prevProject = round.projects.find(p => p.address.toLowerCase() === addrLower);
          if (prevProject) {
            return {
              project: {
                id: 0,
                address: prevProject.address,
                metadata: prevProject.metadata as unknown as Project['metadata'],
              },
              jurySC: round.jurySC,
              round: round.round,
              historical: true,
            };
          }
        }
      }
    }

    return null;
  });

  const project = $derived(projectContext?.project ?? null);
  const projectRound = $derived(projectContext?.round ?? currentIteration?.round ?? null);
  const isHistoricalProjectView = $derived(projectContext?.historical ?? false);

  // Use iteration's chainId for registry status
  const iterationChainId = $derived(currentIteration?.chainId ?? null);
  const contractAddress = $derived(projectContext?.jurySC ?? currentIteration?.jurySC ?? null);

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
    if (roles.smt) return 'smt';
    if (roles.dao_hic) return 'dao_hic';
    return 'community';
  });

  // Check if user has voted for this project
  const hasVotedForThisProject = $derived.by(() => {
    if (!project) return false;
    if (votingRole === 'smt') {
      return smtVote?.toLowerCase() === project.address.toLowerCase();
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
    if (votingRole === 'smt') return smtVote !== null;
    if (votingRole === 'dao_hic') return daoHicVote !== null;
    if (votingRole === 'community') return currentIterationCommunityBadges.some(b => b.hasVoted);
    return false;
  });

  // Can vote (can always change vote during active voting)
  const canVote = $derived(
    !isHistoricalProjectView &&
    votingRole !== null &&
    statusFlags.isActive &&
    !statusFlags.votingEnded
  );

  // Handle vote button click - direct vote if badged, modal only for mint flow
  function handleVoteClick() {
    if (!votingRole || !project) return;
    if (votingRole === 'community' && currentIterationBadges.length === 0) {
      showVoteModal = true;
      return;
    }
    handleConfirmVote();
  }

  function handleCommunityVoteAction() {
    if (!walletAddress) {
      onConnect?.();
      return;
    }

    handleVoteClick();
  }

  // Handle confirmed vote from modal
  async function handleConfirmVote() {
    if (!votingRole || !project) return;
    const tokenId = votingRole === 'community' ? currentIterationCommunityBadges[0]?.tokenId : undefined;
    await executeVote(votingRole, project.address, tokenId, refreshVotingData);
    showVoteModal = false;
  }

  // Legacy handleVote for SMT/DAO HIC (they don't need mint flow)
  async function handleVote() {
    if (!votingRole || !project) return;
    const tokenId = votingRole === 'community' ? currentIterationCommunityBadges[0]?.tokenId : undefined;
    await executeVote(votingRole, project.address, tokenId, refreshVotingData);
  }

  // Get network-specific values
  const network = $derived(chainId ? NETWORKS[chainId] : null);
  const tokenSymbol = $derived(network?.tokenSymbol ?? 'TSYS');

  // Determine header role tag
  const headerRoleTag = $derived.by(() => {
    if (roles.smt) return { label: ROLE_LABELS.smt, color: ROLE_COLORS.smt };
    if (roles.dao_hic) return { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic };
    if (roles.community || (!roles.project && !isOwner)) {
      return { label: ROLE_LABELS.community, color: ROLE_COLORS.community };
    }
    return null;
  });

  const hasJuryRole = $derived(roles.smt || roles.dao_hic || roles.community);
  const canBecomeCommunity = $derived(
    !isHistoricalProjectView &&
    !roles.project &&
    !roles.smt &&
    !roles.dao_hic &&
    !roles.community &&
    !isOwner
  );
  const hasSmtBadge = $derived(currentIterationBadges?.some(badge => badge.role === 'smt') ?? false);
  const hasDaoHicBadge = $derived(currentIterationBadges?.some(badge => badge.role === 'dao_hic') ?? false);

  const canEditMetadata = $derived.by(() => {
    if (!project || !walletAddress || !registryAvailable) return false;
    if (isHistoricalProjectView) return false;
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
  const projectInitials = $derived(getProjectInitials(projectName));
  const appUrl = $derived(resolvedMetadata?.app_url?.trim() || null);
  const proposalUrl = $derived(resolvedMetadata?.proposal?.trim() || null);
  const repositoryUrl = $derived(resolvedMetadata?.repository?.trim() || null);
  const roundSummary = $derived.by(() => {
    const items: string[] = [];
    if (currentIteration?.iteration) items.push(`Iteration #${currentIteration.iteration}`);
    if (projectRound) items.push(`Round #${projectRound}`);
    return items.join(' · ') || 'Project detail';
  });
  const projectStatusLabel = $derived.by(() => {
    if (isHistoricalProjectView) return 'Historical';
    if (statusFlags.isActive && !statusFlags.votingEnded) return 'Voting active';
    if (statusFlags.votingEnded) return 'Voting ended';
    return 'Upcoming';
  });
  const projectStatusPillClass = $derived.by(() => {
    if (isHistoricalProjectView) return 'pob-pill pob-pill--ended';
    if (statusFlags.isActive && !statusFlags.votingEnded) return 'pob-pill pob-pill--active';
    if (statusFlags.votingEnded) return 'pob-pill pob-pill--ended';
    return 'pob-pill pob-pill--upcoming';
  });
  const socialLinks = $derived.by((): ProjectLink[] => {
    const metadata = resolvedMetadata;
    const socials = metadata?.socials;
    const links: ProjectLink[] = [];

    if (socials?.x?.trim()) {
      links.push({ label: 'X', href: socials.x.trim(), title: `${projectName} on X`, className: 'pob-socials__link--x' });
    }
    if (socials?.instagram?.trim()) {
      links.push({ label: 'Instagram', href: socials.instagram.trim(), title: `${projectName} on Instagram` });
    }
    if (socials?.tiktok?.trim()) {
      links.push({ label: 'TikTok', href: socials.tiktok.trim(), title: `${projectName} on TikTok` });
    }
    if (socials?.linkedin?.trim()) {
      links.push({ label: 'LinkedIn', href: socials.linkedin.trim(), title: `${projectName} on LinkedIn` });
    }

    return links;
  });
</script>

{#if loading}
  <div class="pob-stack">
    <section class="pob-pane pob-surface--quiet">
      <p class="text-sm text-[var(--pob-text-muted)]">Loading project...</p>
    </section>
  </div>
{:else if !project}
  <div class="pob-stack">
    <section class="pob-pane pob-surface--quiet">
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
  <div class="pob-stack project-page__main lg:pr-4" style={!sidebarVisible ? 'grid-column: 1 / -1;' : ''}>
    <Link
      to={`/iteration/${currentIteration?.iteration ?? 1}`}
      class="project-page__back-link"
    >
      ← Back to Projects
    </Link>

    <section class="pob-pane pob-surface--quiet pob-surface--accented project-page__hero" aria-labelledby="project-page-title">
      <div class="project-page__hero-copy">
        <div class="project-page__pills" aria-label="Project round status">
          <span class="pob-pill pob-pill--upcoming">{roundSummary}</span>
          <span class={projectStatusPillClass}>{projectStatusLabel}</span>
        </div>

        <p class="pob-eyebrow">Builder dossier</p>
        <h1 id="project-page-title" class="project-page__title">{projectName}</h1>
        <p class="project-page__wallet pob-mono" title={project.address}>{formatAddress(project.address)}</p>

        {#if isHistoricalProjectView && projectRound}
          <p class="project-page__notice">
            Historical project from Round #{projectRound}. Voting and metadata edits are read-only here.
          </p>
        {/if}

        {#if appUrl || proposalUrl || repositoryUrl || canEditMetadata}
          <div class="project-page__actions" aria-label={`Primary actions for ${projectName}`}>
            {#if appUrl}
              <a href={appUrl} target="_blank" rel="noopener noreferrer" class="pob-button">
                Visit App
              </a>
            {/if}
            {#if proposalUrl}
              <a href={proposalUrl} target="_blank" rel="noopener noreferrer" class="pob-button pob-button--outline">
                Read Proposal
              </a>
            {/if}
            {#if repositoryUrl}
              <a href={repositoryUrl} target="_blank" rel="noopener noreferrer" class="pob-button pob-button--outline">
                Repository
              </a>
            {/if}
            {#if canEditMetadata}
              <Link
                to={`/iteration/${currentIteration?.iteration}/project/${project.address}/edit`}
                class="pob-button pob-button--outline project-page__edit"
              >
                Edit Metadata
              </Link>
            {/if}
          </div>
        {/if}

        {#if socialLinks.length > 0}
          <div class="pob-socials project-page__quick-links" aria-label={`Social links for ${projectName}`}>
            {#each socialLinks as link (link.label)}
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                class="pob-socials__link {link.className ?? ''}"
                title={link.title}
              >
                {link.label}
              </a>
            {/each}
          </div>
        {/if}
      </div>

      <aside class="project-page__identity" aria-label="Project identity">
        <div class="project-page__identity-orb" aria-hidden="true">
          <span>{projectInitials}</span>
        </div>
        <div class="project-page__identity-list">
          <div>
            <span>Project wallet</span>
            <strong class="pob-mono" title={project.address}>{formatAddress(project.address)}</strong>
          </div>
          {#if currentIteration?.iteration}
            <div>
              <span>Iteration</span>
              <strong>#{currentIteration.iteration}</strong>
            </div>
          {/if}
          {#if projectRound}
            <div>
              <span>Round</span>
              <strong>#{projectRound}</strong>
            </div>
          {/if}
        </div>
      </aside>
    </section>

    {#if embedUrl}
      <section class="project-page__section project-page__demo" aria-labelledby="project-demo-title">
        <div class="project-page__section-heading">
          <p class="pob-eyebrow pob-eyebrow--muted">Demo</p>
          <h2 id="project-demo-title" class="pob-pane__title">Project video</h2>
        </div>
        <div class="pob-video project-page__video">
          <iframe
            src={embedUrl}
            title={`Project video for ${projectName}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      </section>
    {/if}

    {#if resolvedMetadata?.description}
      <section class="pob-pane pob-surface--quiet project-page__section project-page__overview" aria-labelledby="project-overview-title">
        <div class="project-page__section-heading">
          <p class="pob-eyebrow pob-eyebrow--muted">Overview</p>
          <h2 id="project-overview-title" class="pob-pane__title">Builder story</h2>
        </div>
        <div class="project-page__description">
          <MarkdownRenderer content={resolvedMetadata.description} />
        </div>
      </section>
    {/if}

    <section class="pob-pane pob-surface--quiet project-page__record" aria-labelledby="project-record-title">
      <div class="project-page__section-heading">
        <p class="pob-eyebrow pob-eyebrow--muted">On-chain record</p>
        <h2 id="project-record-title" class="pob-pane__title">Verifiable project data</h2>
      </div>
      <div class="project-page__record-grid">
        <div class="project-page__record-item">
          <span>Project wallet</span>
          <strong class="pob-mono" title={project.address}>{formatAddress(project.address)}</strong>
        </div>
        <div class="project-page__record-item">
          <span>Round context</span>
          <strong>{roundSummary}</strong>
        </div>
        <div class="project-page__record-item">
          <span>Chain ID</span>
          <strong>{iterationChainId ?? chainId ?? 'Unknown'}</strong>
        </div>
        <div class="project-page__record-item">
          <span>Metadata CID</span>
          {#if currentCID}
            <a
              href={getMetadataCidUrl(currentCID)}
              target="_blank"
              rel="noopener noreferrer"
              class="project-page__record-link"
              title={`IPFS CID: ${currentCID}`}
            >
              View IPFS
            </a>
          {:else}
            <strong class="project-page__record-muted">Unavailable</strong>
          {/if}
        </div>
        <div class="project-page__record-item">
          <span>Registry tx</span>
          {#if currentTxHash && iterationChainId}
            <a
              href={getExplorerTxLink(iterationChainId, currentTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              class="project-page__record-link"
              title={`Transaction: ${currentTxHash}`}
            >
              View TX
            </a>
          {:else}
            <strong class="project-page__record-muted">Unavailable</strong>
          {/if}
        </div>
      </div>

      {#if canSeeMetadataStatus && pendingCID}
        <div class="project-page__pending-status">
          <p class="pob-pane__meta">Updating metadata...</p>
          <span class="pob-pill flex items-center gap-1">
            <ProgressSpinner size={16} progress={Math.min((pendingConfirmations / 5) * 100, 100)} />
            {pendingConfirmations}/5
          </span>
        </div>
      {/if}
    </section>
  </div>

  <!-- Sidebar with voting panel -->
  {#if sidebarVisible}
    <div class="pob-stack lg:pl-4">
      <!-- Jury Panel - Vote for this specific project -->
      {#if !isHistoricalProjectView && (hasJuryRole || canBecomeCommunity) && !isOwner}
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
            <!-- SMT Role (v003) -->
            {#if roles.smt}
              <p class="text-sm text-[var(--pob-text-muted)]">
                As an SMT voter, cast your vote for <span class="font-semibold text-white">{projectName}</span>.
              </p>
              {#if smtVote}
                <p class="text-sm text-[var(--pob-text-muted)]">
                  Currently voted for{' '}
                  <span class="italic">
                    {getProjectLabel(smtVote) ?? 'Unknown project'}
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
              {#if !hasSmtBadge && statusFlags.votingEnded}
                <button
                  type="button"
                  onclick={() => void executeMint('smt', refreshBadges)}
                  class="pob-button pob-button--outline w-full justify-center text-xs"
                  disabled={pendingAction !== null || !walletAddress}
                >
                  Mint SMT badge
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
              {#if statusFlags.isActive && !statusFlags.votingEnded && (walletAddress || onConnect)}
                <button
                  type="button"
                  onclick={handleCommunityVoteAction}
                  disabled={pendingAction !== null}
                  class="pob-button w-full justify-center"
                >
                  {walletAddress ? (hasVotedForThisProject ? 'Voted' : hasVotedAnywhere ? 'Change Vote' : 'Vote') : 'Vote'}
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

      {#if isHistoricalProjectView}
        <section class="pob-pane pob-surface--quiet">
          <div class="pob-pane__heading">
            <div>
              <h3 class="pob-pane__title">Historical Round</h3>
              {#if projectRound}
                <p class="pob-eyebrow pob-eyebrow--muted mt-1">Round #{projectRound}</p>
              {/if}
            </div>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            This project belongs to Round #{projectRound}. Historical project pages are read-only.
          </p>
        </section>
      {/if}

      <!-- Owner message -->
      {#if isOwner}
        <section class="pob-pane pob-surface--quiet">
          <div class="pob-pane__heading">
            <div>
              <h3 class="pob-pane__title">Owner View</h3>
              <p class="pob-eyebrow pob-eyebrow--muted mt-1">Read-only voting state</p>
            </div>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            As the contract owner, you cannot vote on projects.
          </p>
        </section>
      {/if}

      <!-- Project participant message -->
      {#if roles.project && !isOwner}
        <section class="pob-pane pob-surface--quiet">
          <div class="pob-pane__heading">
            <div>
              <h3 class="pob-pane__title">Participant View</h3>
              <p class="pob-eyebrow pob-eyebrow--muted mt-1">Project role</p>
            </div>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">
            As a project participant, you cannot vote on projects.
          </p>
        </section>
      {/if}
    </div>
  {/if}

  <!-- Mobile toggle for sidebar -->
  {#if !sidebarVisible && !isHistoricalProjectView && (hasJuryRole || canBecomeCommunity) && !isOwner}
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
      {tokenSymbol}
    />
  {/if}
{/if}
