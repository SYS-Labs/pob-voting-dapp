import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Iteration, ParticipantRole, Project, Badge } from '~/interfaces';
import MarkdownRenderer from '~/components/MarkdownRenderer';
import VoteConfirmationModal from '~/components/VoteConfirmationModal';
import { formatAddress, getYouTubeEmbedUrl } from '~/utils';
import { NETWORKS } from '~/constants/networks';
import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
import { useRegistryStatus } from '~/hooks/useRegistryStatus';

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
  devrel: boolean;
  dao_hic: boolean;
  project: boolean;
}

interface StatusFlags {
  isActive: boolean;
  votingEnded: boolean;
}

interface ProjectPageProps {
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
  getProjectLabel: (address: string | null) => string | null;
  executeMint: (role: ParticipantRole, refreshCallback?: () => Promise<void>) => Promise<void>;
  executeVote: (role: ParticipantRole, projectAddress: string, tokenId?: string, refreshCallback?: () => Promise<void>) => void;
  refreshVotingData: () => Promise<void>;
  refreshBadges: () => Promise<void>;
}

const ProjectPage = ({
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
  getProjectLabel,
  executeMint,
  executeVote,
  refreshVotingData,
  refreshBadges,
}: ProjectPageProps) => {
  const { projectAddress } = useParams<{ projectAddress: string }>();
  const [sidebarVisible, setSidebarVisible] = useState(window.innerWidth >= 1024);
  const wasLargeScreen = useRef(window.innerWidth >= 1024);

  // Find the project
  const project = useMemo(() => {
    if (!projectAddress) return null;
    return projects.find(p => p.address.toLowerCase() === projectAddress.toLowerCase()) ?? null;
  }, [projects, projectAddress]);

  const { registryAvailable, initializationComplete, registryOwner } = useRegistryStatus(chainId);

  // Auto-hide sidebar below 1024px breakpoint
  useEffect(() => {
    const handleResize = () => {
      const isLargeScreen = window.innerWidth >= 1024;
      if (wasLargeScreen.current !== isLargeScreen) {
        wasLargeScreen.current = isLargeScreen;
        setSidebarVisible(isLargeScreen);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Filter badges to only those for the current iteration and round
  const currentIterationBadges = useMemo(
    () => badges.filter((badge) =>
      badge.iteration === currentIteration?.iteration &&
      badge.round === currentIteration?.round
    ),
    [badges, currentIteration],
  );

  const currentIterationCommunityBadges = useMemo(
    () => communityBadges.filter((badge) =>
      badge.iteration === currentIteration?.iteration &&
      badge.round === currentIteration?.round
    ),
    [communityBadges, currentIteration],
  );

  // Determine voting role
  const votingRole: ParticipantRole | null = useMemo(() => {
    if (!walletAddress) return null;
    if (isOwner) return null;
    if (roles.project) return null;
    if (roles.devrel) return 'devrel';
    if (roles.dao_hic) return 'dao_hic';
    return 'community';
  }, [walletAddress, isOwner, roles]);

  // Check if user has voted for this project
  const hasVotedForThisProject = useMemo(() => {
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
  }, [project, votingRole, devRelVote, daoHicVote, currentIterationCommunityBadges]);

  // Check if user has voted anywhere
  const hasVotedAnywhere = useMemo(() => {
    if (votingRole === 'devrel') return devRelVote !== null;
    if (votingRole === 'dao_hic') return daoHicVote !== null;
    if (votingRole === 'community') return currentIterationCommunityBadges.some(b => b.hasVoted);
    return false;
  }, [votingRole, devRelVote, daoHicVote, currentIterationCommunityBadges]);

  // Can vote (can always change vote during active voting)
  const canVote = votingRole !== null &&
                  statusFlags.isActive &&
                  !statusFlags.votingEnded;

  // Vote modal state
  const [showVoteModal, setShowVoteModal] = useState(false);

  // Handle vote button click - opens confirmation modal
  const handleVoteClick = useCallback(() => {
    if (!votingRole || !project) return;
    setShowVoteModal(true);
  }, [votingRole, project]);

  // Handle confirmed vote from modal
  const handleConfirmVote = useCallback(async () => {
    if (!votingRole || !project) return;
    const tokenId = votingRole === 'community' ? currentIterationCommunityBadges[0]?.tokenId : undefined;
    await executeVote(votingRole, project.address, tokenId, refreshVotingData);
    setShowVoteModal(false);
  }, [votingRole, project, currentIterationCommunityBadges, executeVote, refreshVotingData]);

  // Legacy handleVote for DevRel/DAO HIC (they don't need mint flow)
  const handleVote = useCallback(async () => {
    if (!votingRole || !project) return;
    const tokenId = votingRole === 'community' ? currentIterationCommunityBadges[0]?.tokenId : undefined;
    await executeVote(votingRole, project.address, tokenId, refreshVotingData);
  }, [votingRole, project, currentIterationCommunityBadges, executeVote, refreshVotingData]);

  // Get network-specific values
  const network = chainId ? NETWORKS[chainId] : null;
  const mintAmount = network?.mintAmount ?? '30';
  const tokenSymbol = network?.tokenSymbol ?? 'TSYS';

  // Determine header role tag
  const headerRoleTag = roles.devrel
    ? { label: ROLE_LABELS.devrel, color: ROLE_COLORS.devrel }
    : roles.dao_hic
    ? { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic }
    : (roles.community || (!roles.project && !isOwner))
    ? { label: ROLE_LABELS.community, color: ROLE_COLORS.community }
    : null;

  const hasJuryRole = roles.devrel || roles.dao_hic || roles.community;
  const canBecomeCommunity = !roles.project && !roles.devrel && !roles.dao_hic && !roles.community && !isOwner;
  const hasDevRelBadge = currentIterationBadges?.some(badge => badge.role === 'devrel') ?? false;
  const hasDaoHicBadge = currentIterationBadges?.some(badge => badge.role === 'dao_hic') ?? false;
  const canEditMetadata = useMemo(() => {
    if (!project || !walletAddress) return false;
    if (!registryAvailable || initializationComplete === null) return false;

    const walletLower = walletAddress.toLowerCase();
    if (!initializationComplete) {
      return Boolean(registryOwner && walletLower === registryOwner.toLowerCase());
    }

    if (projectsLocked) return false;
    return walletLower === project.address.toLowerCase();
  }, [project, walletAddress, registryAvailable, initializationComplete, registryOwner, projectsLocked]);

  if (loading) {
    return (
      <div className="pob-stack">
        <p className="text-sm text-[var(--pob-text-muted)]">Loading project...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="pob-stack">
        <section className="pob-pane">
          <p className="text-sm text-[var(--pob-text-muted)]">Project not found.</p>
          <Link
            to={`/iteration/${currentIteration?.iteration ?? 1}`}
            className="pob-button pob-button--outline pob-button--compact"
            style={{ marginTop: '1rem', display: 'inline-flex' }}
          >
            Back to Iteration
          </Link>
        </section>
      </div>
    );
  }

  const projectName = project.metadata?.name ?? `Project #${project.id}`;
  const embedUrl = getYouTubeEmbedUrl(project.metadata?.yt_vid ?? null);

  return (
    <>
      {/* Main content */}
      <div className="pob-stack lg:pr-4" style={!sidebarVisible ? { gridColumn: '1 / -1' } : {}}>
        {/* Back link */}
        <Link
          to={`/iteration/${currentIteration?.iteration ?? 1}`}
          className="text-sm text-[var(--pob-text-muted)] hover:text-[var(--pob-primary)]"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
        >
          ← Back to Projects
        </Link>

        {/* Project card without vote button */}
        <section className="pob-pane">
          <div className="space-y-4">
            <div className="pob-pane__heading project-page__heading">
              <div>
                <h1 className="project-page__title">{projectName}</h1>
                <p className="pob-mono text-xs text-[var(--pob-text-muted)]">
                  {formatAddress(project.address)}
                </p>
              </div>
              {canEditMetadata && (
                <Link
                  to={`/iteration/${currentIteration?.iteration}/project/${project.address}/edit`}
                  className="pob-button pob-button--outline pob-button--compact project-page__edit"
                >
                  Edit
                </Link>
              )}
            </div>

            {/* Full description */}
            <div className="project-page__description">
              <MarkdownRenderer content={project.metadata?.description} />
            </div>

            {/* Video embed */}
            {embedUrl ? (
              <div className="pob-video" style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
                <iframe
                  src={embedUrl}
                  title={`Project video for ${projectName}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : null}

            {/* Proposal link */}
            {project.metadata?.proposal ? (
              <div style={{ marginTop: '1rem' }}>
                <a
                  href={project.metadata.proposal}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pob-button pob-button--outline pob-button--compact"
                >
                  Read full proposal
                </a>
              </div>
            ) : null}

            {/* Social links */}
            {project.metadata?.socials && (
              project.metadata.socials.x ||
              project.metadata.socials.instagram ||
              project.metadata.socials.tiktok ||
              project.metadata.socials.linkedin
            ) && (
              <div className="pob-socials" style={{ marginTop: '1.5rem' }}>
                {project.metadata.socials.x && (
                  <a
                    href={project.metadata.socials.x}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pob-socials__link pob-socials__link--x"
                    title="X (Twitter)"
                  >
                    X
                  </a>
                )}
                {project.metadata.socials.instagram && (
                  <a
                    href={project.metadata.socials.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pob-socials__link"
                    title="Instagram"
                  >
                    Instagram
                  </a>
                )}
                {project.metadata.socials.tiktok && (
                  <a
                    href={project.metadata.socials.tiktok}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pob-socials__link"
                    title="TikTok"
                  >
                    TikTok
                  </a>
                )}
                {project.metadata.socials.linkedin && (
                  <a
                    href={project.metadata.socials.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pob-socials__link"
                    title="LinkedIn"
                  >
                    LinkedIn
                  </a>
                )}
              </div>
            )}

          </div>
        </section>
      </div>

      {/* Sidebar with voting panel */}
      {sidebarVisible && (
        <div className="pob-stack lg:pl-4">
          {/* Jury Panel - Vote for this specific project */}
          {(hasJuryRole || canBecomeCommunity) && !isOwner && (
            <section className="pob-pane">
              <div className="pob-pane__heading">
                <h3 className="pob-pane__title">Jury Panel</h3>
                {headerRoleTag && (
                  <span className={`pob-pill ${headerRoleTag.color}`}>
                    {headerRoleTag.label}
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {/* DevRel Role */}
                {roles.devrel && (
                  <>
                    <p className="text-sm text-[var(--pob-text-muted)]">
                      As DevRel, cast your vote for <span className="font-semibold text-white">{projectName}</span>.
                    </p>
                    {devRelVote && (
                      <p className="text-sm text-[var(--pob-text-muted)]">
                        Currently voted for{' '}
                        <span className="italic">
                          {getProjectLabel(devRelVote) ?? 'Unknown project'}
                        </span>
                      </p>
                    )}
                    {canVote && (
                      <button
                        type="button"
                        onClick={handleVote}
                        disabled={pendingAction !== null}
                        className="pob-button w-full justify-center"
                      >
                        {hasVotedForThisProject ? 'Voted' : hasVotedAnywhere ? 'Change Vote' : 'Vote'}
                      </button>
                    )}
                    {!hasDevRelBadge && statusFlags.votingEnded && (
                      <button
                        type="button"
                        onClick={() => void executeMint('devrel', refreshBadges)}
                        className="pob-button pob-button--outline w-full justify-center text-xs"
                        disabled={pendingAction !== null || !walletAddress}
                      >
                        Mint DevRel badge
                      </button>
                    )}
                  </>
                )}

                {/* DAO HIC Role */}
                {roles.dao_hic && (
                  <>
                    <p className="text-sm text-[var(--pob-text-muted)]">
                      As a DAO HIC voter, cast your vote for <span className="font-semibold text-white">{projectName}</span>.
                    </p>
                    {daoHicVote && (
                      <p className="text-sm text-[var(--pob-text-muted)]">
                        Currently voted for{' '}
                        <span className="italic">
                          {getProjectLabel(daoHicVote) ?? 'Unknown project'}
                        </span>
                      </p>
                    )}
                    {canVote && (
                      <button
                        type="button"
                        onClick={handleVote}
                        disabled={pendingAction !== null}
                        className="pob-button w-full justify-center"
                      >
                        {hasVotedForThisProject ? 'Voted' : hasVotedAnywhere ? 'Change Vote' : 'Vote'}
                      </button>
                    )}
                    {!hasDaoHicBadge && statusFlags.votingEnded && (
                      <button
                        type="button"
                        onClick={() => void executeMint('dao_hic', refreshBadges)}
                        className="pob-button pob-button--outline w-full justify-center text-xs"
                        disabled={pendingAction !== null || !walletAddress}
                      >
                        Mint DAO HIC badge
                      </button>
                    )}
                  </>
                )}

                {/* Community Role */}
                {(roles.community || canBecomeCommunity) && (
                  <>
                    <p className="text-sm text-[var(--pob-text-muted)]">
                      {hasVotedAnywhere ? (
                        <>
                          Currently voted for{' '}
                          <span className="italic">
                            {getProjectLabel(currentIterationCommunityBadges.find(b => b.hasVoted)?.vote ?? null) ?? 'Unknown'}
                          </span>
                        </>
                      ) : (
                        <>Vote for <span className="font-semibold text-white">{projectName}</span>.</>
                      )}
                    </p>
                    {statusFlags.isActive && !statusFlags.votingEnded && walletAddress && (
                      <button
                        type="button"
                        onClick={handleVoteClick}
                        disabled={pendingAction !== null}
                        className="pob-button w-full justify-center"
                      >
                        {hasVotedForThisProject ? 'Voted' : hasVotedAnywhere ? 'Change Vote' : 'Vote'}
                      </button>
                    )}
                    {statusFlags.isActive && (
                      <p className="text-xs text-[var(--pob-text-muted)] italic">
                        You can change your vote at any time during the voting period.
                      </p>
                    )}
                  </>
                )}

                {/* Voting ended message */}
                {statusFlags.votingEnded && (
                  <p className="text-xs text-[var(--pob-text-muted)] italic">
                    Voting has ended for this iteration.
                  </p>
                )}

                {/* Not active yet */}
                {!statusFlags.isActive && !statusFlags.votingEnded && (
                  <p className="text-xs text-[var(--pob-text-muted)] italic">
                    Voting has not started yet.
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Owner message */}
          {isOwner && (
            <section className="pob-pane">
              <div className="pob-pane__heading">
                <h3 className="pob-pane__title">Owner View</h3>
              </div>
              <p className="text-sm text-[var(--pob-text-muted)]">
                As the contract owner, you cannot vote on projects.
              </p>
            </section>
          )}

          {/* Project participant message */}
          {roles.project && !isOwner && (
            <section className="pob-pane">
              <div className="pob-pane__heading">
                <h3 className="pob-pane__title">Participant View</h3>
              </div>
              <p className="text-sm text-[var(--pob-text-muted)]">
                As a project participant, you cannot vote on projects.
              </p>
            </section>
          )}
        </div>
      )}

      {/* Mobile toggle for sidebar */}
      {!sidebarVisible && (hasJuryRole || canBecomeCommunity) && !isOwner && (
        <button
          type="button"
          onClick={() => setSidebarVisible(true)}
          className="pob-button pob-button--outline"
          style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 50 }}
        >
          Vote
        </button>
      )}

      {/* Vote Confirmation Modal */}
      {project && showVoteModal && (
        <VoteConfirmationModal
          isOpen={true}
          onClose={() => setShowVoteModal(false)}
          onConfirm={handleConfirmVote}
          projectName={projectName}
          projectAddress={project.address}
          votingRole={votingRole}
          hasVotedForProject={hasVotedForThisProject}
          hasBadge={currentIterationBadges.length > 0}
          executeMint={executeMint}
          refreshBadges={refreshBadges}
          isPending={pendingAction !== null}
          mintAmount={mintAmount}
          tokenSymbol={tokenSymbol}
        />
      )}
    </>
  );
};

export default ProjectPage;
