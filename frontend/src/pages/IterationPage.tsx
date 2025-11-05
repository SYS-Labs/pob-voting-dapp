import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import type { Iteration, ParticipantRole, Project, Badge } from '~/interfaces';
import IterationHeader from '~/components/IterationHeader';
import PreviousRoundCard from '~/components/PreviousRoundCard';
import VotingProgress from '~/components/VotingProgress';
import ProjectCard from '~/components/ProjectCard';
import JuryPanel from '~/components/JuryPanel';
import ParticipantPanel from '~/components/ParticipantPanel';
import OwnerPanel from '~/components/OwnerPanel';
import BadgePanel from '~/components/BadgePanel';
import DateTimePanel from '~/components/DateTimePanel';
import ToolboxCard from '~/components/ToolboxCard';
import VoteConfirmationModal from '~/components/VoteConfirmationModal';
import { NETWORKS } from '~/constants/networks';

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

interface IterationTimes {
  startTime: number | null;
  endTime: number | null;
}

interface Winner {
  projectAddress: string | null;
  hasWinner: boolean;
}

interface VoteCounts {
  devRel: number;
  daoHic: number;
  community: number;
}

interface EntityVotes {
  devRel: string | null;
  daoHic: string | null;
  community: string | null;
}

interface IterationPageProps {
  currentIteration: Iteration | null;
  statusBadge: { label: string; color: string };
  iterationTimes: IterationTimes;
  projects: Project[];
  shuffledProjects: Project[];
  loading: boolean;
  roles: RoleStatuses;
  isOwner: boolean;
  statusFlags: StatusFlags;
  communityBadges: CommunityBadge[];
  badges: Badge[];
  devRelVote: string | null;
  daoHicVote: string | null;
  entityVotes: EntityVotes;
  pendingAction: string | null;
  walletAddress: string | null;
  chainId: number | null;
  projectsLocked: boolean;
  contractLocked: boolean;
  devRelAccount: string | null;
  daoHicVoters: string[];
  winner: Winner;
  voteCounts: VoteCounts;
  totalCommunityVoters: number;
  openAdminSection: string | null;
  signer: any;
  publicProvider: any;
  JurySC_01ABI: any;
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
  setError: (error: string | null) => void;
  onOpenDisconnect: () => void;
  onConnect: () => void;
}

const IterationPage = ({
  currentIteration,
  statusBadge,
  iterationTimes,
  projects,
  shuffledProjects,
  loading,
  roles,
  isOwner,
  statusFlags,
  communityBadges,
  badges,
  devRelVote,
  daoHicVote,
  entityVotes,
  pendingAction,
  walletAddress,
  chainId,
  projectsLocked,
  contractLocked,
  devRelAccount,
  daoHicVoters,
  winner,
  voteCounts,
  totalCommunityVoters,
  openAdminSection,
  signer,
  publicProvider,
  JurySC_01ABI,
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
  onOpenDisconnect,
  onConnect,
}: IterationPageProps) => {
  const [sidebarVisible, setSidebarVisible] = useState(window.innerWidth >= 1024);
  const [showToolbox, setShowToolbox] = useState(window.innerWidth < 1024);
  const wasLargeScreen = useRef(window.innerWidth >= 1024);

  // Vote confirmation modal state
  const [pendingVote, setPendingVote] = useState<{ project: Project; tokenId?: string } | null>(null);

  // Auto-hide sidebar below 1024px breakpoint and show/hide toolbox
  useEffect(() => {
    const handleResize = () => {
      const isLargeScreen = window.innerWidth >= 1024;

      // Only auto-adjust if crossing the breakpoint, not on every resize
      if (wasLargeScreen.current !== isLargeScreen) {
        wasLargeScreen.current = isLargeScreen;

        // Auto-adjust sidebar based on screen size
        setSidebarVisible(isLargeScreen);
        setShowToolbox(!isLargeScreen);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarVisible(prev => !prev);
  }, []);

  // Filter badges and community badges to only those for the current iteration and round
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

  const handleClaim = useCallback(
    (tokenId: string) => {
      executeClaim(tokenId);
      // executeClaim internally handles the transaction and refresh
    },
    [executeClaim],
  );

  // Wrap executeVote - it internally handles refreshing via txRefreshCallback
  const handleVote = useCallback(
    (role: ParticipantRole, projectAddress: string, tokenId?: string) => {
      executeVote(role, projectAddress, tokenId, refreshVotingData);
    },
    [executeVote, refreshVotingData],
  );

  // Vote confirmation handlers
  const handleVoteClick = useCallback(
    (project: Project, tokenId?: string) => {
      setPendingVote({ project, tokenId });
    },
    [],
  );

  const handleConfirmVote = useCallback(() => {
    if (!pendingVote) return;

    // Determine voting role - projects cannot vote, community is default
    const votingRole: ParticipantRole | null = isOwner
      ? null
      : roles.project
        ? null // Projects cannot vote
        : roles.devrel
          ? 'devrel'
          : roles.dao_hic
            ? 'dao_hic'
            : 'community';

    if (votingRole) {
      handleVote(votingRole, pendingVote.project.address, pendingVote.tokenId);
    }

    setPendingVote(null);
  }, [pendingVote, roles, isOwner, handleVote]);

  const handleCloseVoteModal = useCallback(() => {
    setPendingVote(null);
  }, []);

  return (
    <>
      {(!showToolbox || !sidebarVisible) && (
        <div className="pob-stack lg:pr-4" style={!sidebarVisible ? { gridColumn: '1 / -1' } : {}}>
        <IterationHeader
          iteration={currentIteration}
          statusBadge={statusBadge}
          iterationTimes={iterationTimes}
          isActive={statusFlags.isActive}
          votingEnded={statusFlags.votingEnded}
          projectsLocked={projectsLocked}
          winner={winner}
          entityVotes={entityVotes}
          getProjectLabel={getProjectLabel}
          isOwner={isOwner}
          walletAddress={walletAddress}
          chainId={chainId}
          pendingAction={pendingAction}
          roles={roles}
          badges={currentIterationBadges}
          communityBadges={currentIterationCommunityBadges}
          executeMint={executeMint}
          refreshBadges={refreshBadges}
        />

        {currentIteration?.prev_rounds && currentIteration.prev_rounds.length > 0 &&
          currentIteration.prev_rounds.map((round) => (
            <PreviousRoundCard
              key={round.round}
              round={round}
              chainId={currentIteration.chainId}
              publicProvider={publicProvider}
              isOwner={isOwner}
              walletAddress={walletAddress}
              signer={signer}
              pendingAction={pendingAction}
              getProjectLabel={getProjectLabel}
              runTransaction={runTransaction}
              refreshBadges={refreshBadges}
            />
          ))
        }

        {currentIteration ? (
          <section className="pob-pane pob-pane--subtle">
            <div className="pob-pane__heading">
              <h3 className="pob-pane__title">Projects</h3>
            </div>
            {projects.length ? (
              <div className="projects-grid">
                {shuffledProjects.map((project) => {
                  // Determine voting role and status
                  // Projects cannot vote - they are participants, not jurors
                  // Community is the default for anyone without devrel/dao_hic role (and not owner/project)
                  const votingRole: ParticipantRole | null = !walletAddress
                    ? null // No wallet connected
                    : isOwner
                      ? null
                      : roles.project
                        ? null // Projects cannot vote
                        : roles.devrel
                          ? 'devrel'
                          : roles.dao_hic
                            ? 'dao_hic'
                            : 'community'; // Default to community if no other role

                  const hasVotedForThisProject =
                    votingRole === 'devrel'
                      ? devRelVote?.toLowerCase() === project.address.toLowerCase()
                      : votingRole === 'dao_hic'
                        ? daoHicVote?.toLowerCase() === project.address.toLowerCase()
                        : votingRole === 'community'
                          ? currentIterationCommunityBadges.some(b => b.hasVoted && b.vote?.toLowerCase() === project.address.toLowerCase())
                          : false;

                  const hasVotedAnywhere =
                    votingRole === 'devrel'
                      ? devRelVote !== null
                      : votingRole === 'dao_hic'
                        ? daoHicVote !== null
                        : votingRole === 'community'
                          ? currentIterationCommunityBadges.some(b => b.hasVoted)
                          : false;

                  // All roles can change their votes during active voting
                  const canChangeVote = true;

                  const canVote = votingRole !== null &&
                                 statusFlags.isActive &&
                                 !statusFlags.votingEnded &&
                                 (!hasVotedAnywhere || canChangeVote);

                  return (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      votingRole={votingRole}
                      hasVotedForProject={hasVotedForThisProject}
                      canVote={canVote}
                      isOwner={isOwner}
                      projectsLocked={projectsLocked}
                      pendingAction={pendingAction}
                      onVote={(_projectAddress, tokenId) => {
                        // Open confirmation modal instead of voting immediately
                        handleVoteClick(project, tokenId);
                      }}
                      onRemove={(project) => {
                        if (projectsLocked) {
                          setError('Projects are locked after activation. Removal is disabled.');
                        } else {
                          setPendingRemovalProject(project);
                        }
                      }}
                      communityBadges={currentIterationCommunityBadges}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--pob-text-muted)]">
                {loading ? 'Loading projects…' : 'No registered projects yet.'}
              </p>
            )}
          </section>
        ) : null}
        </div>
      )}

      {sidebarVisible && (
        <div className="pob-stack lg:pl-4" style={showToolbox ? { gridColumn: '1 / -1' } : {}}>
          {/* DateTime Panel - Shows current time for owner */}
          {isOwner && <DateTimePanel />}

        {/* Badge Panel - Shows current iteration badge like a seal - Hidden on mobile */}
        {!showToolbox && (
          <BadgePanel
            badges={currentIterationBadges}
            communityBadges={currentIterationCommunityBadges}
            walletAddress={walletAddress}
            statusFlags={statusFlags}
            onClaim={handleClaim}
            pendingAction={pendingAction}
          />
        )}

        {!isOwner ? (
          <>
            <JuryPanel
              roles={roles}
              statusFlags={statusFlags}
              communityBadges={currentIterationCommunityBadges}
              badges={currentIterationBadges}
              devRelVote={devRelVote}
              daoHicVote={daoHicVote}
              pendingAction={pendingAction}
              walletAddress={walletAddress}
              chainId={chainId}
              getProjectLabel={getProjectLabel}
              executeMint={(role) => void executeMint(role, refreshBadges)}
            />
            <ParticipantPanel
              roles={roles}
              projectsLocked={projectsLocked}
              votingEnded={statusFlags.votingEnded}
              pendingAction={pendingAction}
              walletAddress={walletAddress}
              badges={badges}
              executeMint={(role) => void executeMint(role, refreshBadges)}
            />
          </>
        ) : null}

        {isOwner && currentIteration ? (
          <OwnerPanel
            currentIteration={currentIteration}
            statusFlags={statusFlags}
            projectsLocked={projectsLocked}
            contractLocked={contractLocked}
            devRelAccount={devRelAccount}
            daoHicVoters={daoHicVoters}
            winner={winner}
            pendingAction={pendingAction}
            openAdminSection={openAdminSection}
            signer={signer}
            JurySC_01ABI={JurySC_01ABI}
            getProjectLabel={getProjectLabel}
            handleToggleAdminSection={handleToggleAdminSection}
            runTransaction={runTransaction}
            refreshVotingData={refreshVotingData}
            refreshProjects={refreshProjects}
            refreshOwnerData={refreshOwnerData}
            refreshBadges={refreshBadges}
            setPendingRemovalVoter={setPendingRemovalVoter}
            setError={setError}
          />
        ) : null}

        {currentIteration && (statusFlags.isActive || statusFlags.votingEnded) ? (
          <VotingProgress
            voteCounts={voteCounts}
            daoHicVoters={daoHicVoters}
            totalCommunityVoters={totalCommunityVoters}
          />
        ) : null}
        </div>
      )}

      {showToolbox && (
        <ToolboxCard
          sidebarVisible={sidebarVisible}
          onToggleSidebar={handleToggleSidebar}
          walletAddress={walletAddress}
          chainId={chainId}
          isOwner={isOwner}
          roles={roles}
          devRelVote={devRelVote}
          daoHicVote={daoHicVote}
          communityVoted={currentIterationCommunityBadges.some(b => b.hasVoted)}
          hasBadge={currentIterationBadges.length > 0}
          getProjectLabel={getProjectLabel}
          onOpenDisconnect={onOpenDisconnect}
          onConnect={onConnect}
          pendingAction={pendingAction}
        />
      )}

      {/* Vote Confirmation Modal */}
      {pendingVote && (() => {
        const votingRole: ParticipantRole | null = isOwner
          ? null
          : roles.project
            ? null // Projects cannot vote
            : roles.devrel
              ? 'devrel'
              : roles.dao_hic
                ? 'dao_hic'
                : 'community'; // Default to community if no other role

        const network = chainId ? NETWORKS[chainId] : null;
        const mintAmount = network?.mintAmount ?? '30';
        const tokenSymbol = network?.tokenSymbol ?? 'TSYS';

        const hasVotedForThisProject = votingRole === 'devrel'
          ? devRelVote?.toLowerCase() === pendingVote.project.address.toLowerCase()
          : votingRole === 'dao_hic'
            ? daoHicVote?.toLowerCase() === pendingVote.project.address.toLowerCase()
            : votingRole === 'community'
              ? currentIterationCommunityBadges.some(b => b.hasVoted && b.vote?.toLowerCase() === pendingVote.project.address.toLowerCase())
              : false;

        return (
          <VoteConfirmationModal
            isOpen={true}
            onClose={handleCloseVoteModal}
            onConfirm={handleConfirmVote}
            projectName={pendingVote.project.metadata?.name || `Project #${pendingVote.project.id}`}
            projectAddress={pendingVote.project.address}
            votingRole={votingRole}
            hasVotedForProject={hasVotedForThisProject}
            hasBadge={currentIterationBadges.length > 0}
            executeMint={executeMint}
            refreshBadges={refreshBadges}
            mintAmount={mintAmount}
            tokenSymbol={tokenSymbol}
            isPending={pendingAction !== null}
            pendingAction={pendingAction}
          />
        );
      })()}
    </>
  );
};

export default IterationPage;
