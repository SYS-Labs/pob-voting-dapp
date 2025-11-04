import { useMemo, useCallback } from 'react';
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

interface CommunityBadge {
  tokenId: string;
  hasVoted: boolean;
  vote: string | null;
  claimed?: boolean;
  iteration: number;
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
  executeMint: (role: ParticipantRole) => void;
  executeVote: (role: ParticipantRole, projectAddress: string, tokenId?: string) => void;
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
}: IterationPageProps) => {
  // Filter badges and community badges to only those for the current iteration
  const currentIterationBadges = useMemo(
    () => badges.filter((badge) => badge.iteration === currentIteration?.iteration),
    [badges, currentIteration],
  );

  const currentIterationCommunityBadges = useMemo(
    () => communityBadges.filter((badge) => badge.iteration === currentIteration?.iteration),
    [communityBadges, currentIteration],
  );

  // Wrap executeMint to refresh badges after minting
  const handleMint = useCallback(
    (role: ParticipantRole) => {
      executeMint(role);
      // executeMint internally handles the refresh via txRefreshCallback
    },
    [executeMint],
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
      executeVote(role, projectAddress, tokenId);
      // executeVote internally handles the transaction and refresh
    },
    [executeVote],
  );

  return (
    <>
      <div className="pob-stack lg:pr-4">
        <IterationHeader
          iteration={currentIteration}
          statusBadge={statusBadge}
          iterationTimes={iterationTimes}
          votingEnded={statusFlags.votingEnded}
          winner={winner}
          entityVotes={entityVotes}
          getProjectLabel={getProjectLabel}
          isOwner={isOwner}
        />

        {currentIteration?.prev_rounds && currentIteration.prev_rounds.length > 0 &&
          currentIteration.prev_rounds.map((round) => (
            <PreviousRoundCard
              key={round.round}
              round={round}
              chainId={currentIteration.chainId}
              publicProvider={publicProvider}
              isOwner={isOwner}
              getProjectLabel={getProjectLabel}
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
                  const votingRole: ParticipantRole | null = roles.devrel
                    ? 'devrel'
                    : roles.dao_hic
                      ? 'dao_hic'
                      : roles.community
                        ? 'community'
                        : null;

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
                      onVote={(projectAddress, tokenId) => {
                        if (votingRole) {
                          handleVote(votingRole, projectAddress, tokenId);
                        }
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

      <div className="pob-stack lg:pl-4">
        {/* DateTime Panel - Shows current time for owner */}
        {isOwner && <DateTimePanel />}

        {/* Badge Panel - Shows current iteration badge like a seal */}
        <BadgePanel
          badges={currentIterationBadges}
          communityBadges={currentIterationCommunityBadges}
          walletAddress={walletAddress}
          statusFlags={statusFlags}
          onClaim={handleClaim}
          pendingAction={pendingAction}
        />

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
              executeMint={handleMint}
            />
            <ParticipantPanel
              roles={roles}
              projectsLocked={projectsLocked}
              pendingAction={pendingAction}
              walletAddress={walletAddress}
              badges={badges}
              executeMint={handleMint}
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
    </>
  );
};

export default IterationPage;
