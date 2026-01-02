import type { Iteration, ParticipantRole, Badge } from '~/interfaces';
import { formatDate } from '~/utils';
import { NETWORKS } from '~/constants/networks';
import FinalResultsPanel from './FinalResultsPanel';
import ContractAddress from './ContractAddress';

interface CommunityBadge {
  tokenId: string;
  hasVoted: boolean;
  vote: string | null;
  claimed?: boolean;
}

interface RoleStatuses {
  community: boolean;
  devrel: boolean;
  dao_hic: boolean;
  project: boolean;
}

interface IterationHeaderProps {
  iteration: Iteration | null;
  statusBadge: { label: string; color: string };
  iterationTimes: { startTime: number | null; endTime: number | null };
  isActive?: boolean;
  votingEnded?: boolean;
  projectsLocked?: boolean;
  winner?: { projectAddress: string | null; hasWinner: boolean };
  entityVotes?: { devRel: string | null; daoHic: string | null; community: string | null };
  getProjectLabel?: (address: string | null) => string | null;
  isOwner?: boolean;
  walletAddress?: string | null;
  chainId?: number | null;
  pendingAction?: string | null;
  roles?: RoleStatuses;
  badges?: Badge[];
  communityBadges?: CommunityBadge[];
  executeMint?: (role: ParticipantRole, refreshCallback?: () => Promise<void>) => Promise<void>;
  refreshBadges?: () => Promise<void>;
  votingMode?: number;
  projects?: { id: number; address: string; metadata?: any }[];
  projectScores?: { addresses: string[]; scores: string[]; totalPossible: string } | null;
}

const IterationHeader = ({
  iteration,
  statusBadge,
  iterationTimes,
  isActive = false,
  votingEnded,
  projectsLocked,
  winner,
  entityVotes,
  getProjectLabel,
  isOwner = false,
  walletAddress,
  pendingAction,
  roles,
  badges,
  communityBadges,
  executeMint,
  refreshBadges,
  votingMode = 0,
  projects = [],
  projectScores = null,
}: IterationHeaderProps) => {
  if (!iteration) {
    return (
      <section className="pob-pane">
        <div>
          <p className="pob-pane__title text-xl">Select a program iteration to get started</p>
        </div>
      </section>
    );
  }

  const network = NETWORKS[iteration.chainId];
  const mintAmount = network?.mintAmount ?? '30';
  const tokenSymbol = network?.tokenSymbol ?? 'TSYS';

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <div>
          <p className="pob-pane__meta">Current iteration</p>
          <h2 className="pob-pane__title text-3xl">{iteration.name}</h2>
          <p className="mt-1 text-sm text-[var(--pob-text-muted)]">
            Iteration #{iteration.iteration}{iteration.round ? ` - Round #${iteration.round}` : ''}
            {votingEnded ? (
              winner?.hasWinner ? (
                <span className="pob-pill pob-pill--success text-xs">
                  {votingMode === 0 ? 'Consensus' : 'Weighted'} ✓
                </span>
              ) : (
                <span className="pob-pill pob-pill--failure text-xs">
                  {votingMode === 0 ? 'Consensus' : 'Weighted'} ✗
                </span>
              )
            ) : (
              <span className="pob-pill pob-pill--neutral text-xs">
                {votingMode === 0 ? 'Consensus' : 'Weighted'}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={statusBadge.color}>{statusBadge.label}</span>
        </div>
      </div>
      <dl className="pob-pane__grid text-sm text-[var(--pob-text-muted)] sm:grid-cols-2">
        {statusBadge.label !== 'Upcoming' && (
          <>
            <div>
              <dt className="pob-label">Start Time</dt>
              <dd>{formatDate(iterationTimes.startTime || undefined)}</dd>
            </div>
            <div>
              <dt className="pob-label">End Time</dt>
              <dd>{formatDate(iterationTimes.endTime || undefined)}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="pob-label">Jury Contract</dt>
          <dd><ContractAddress address={iteration.jurySC} chainId={iteration.chainId} /></dd>
        </div>
        <div>
          <dt className="pob-label">PoB Contract</dt>
          <dd><ContractAddress address={iteration.pob} chainId={iteration.chainId} /></dd>
        </div>
      </dl>

      {/* Program brief (left) and Mint button (right) on same line */}
      {(iteration.link || (walletAddress && executeMint)) && (
        <div className="flex items-center justify-between gap-2">
          {iteration.link && (
            <a
              href={iteration.link}
              target="_blank"
              rel="noopener noreferrer"
              className="pob-button pob-button--compact"
            >
              Program brief
            </a>
          )}

          {walletAddress && executeMint && !isOwner && (() => {
            // Determine user's role (matching JuryPanel logic)
            const hasDevRelBadge = badges?.some(badge => badge.role === 'devrel') ?? false;
            const hasDaoHicBadge = badges?.some(badge => badge.role === 'dao_hic') ?? false;
            const hasProjectBadge = badges?.some(badge => badge.role === 'project') ?? false;
            const hasCommunityBadge = communityBadges && communityBadges.length > 0;

            // DevRel mint button
            if (roles?.devrel && !hasDevRelBadge && votingEnded) {
              return (
                <button
                  type="button"
                  onClick={() => void executeMint('devrel', refreshBadges)}
                  className="pob-button pob-button--compact"
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'Mint DevRel Badge' ? 'Minting…' : 'Mint DevRel badge'}
                </button>
              );
            }

            // DAO HIC mint button
            if (roles?.dao_hic && !hasDaoHicBadge && votingEnded) {
              return (
                <button
                  type="button"
                  onClick={() => void executeMint('dao_hic', refreshBadges)}
                  className="pob-button pob-button--compact"
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'Mint DAO HIC Badge' ? 'Minting…' : 'Mint DAO HIC badge'}
                </button>
              );
            }

            // Project mint button
            if (roles?.project && !hasProjectBadge && projectsLocked) {
              return (
                <button
                  type="button"
                  onClick={() => void executeMint('project', refreshBadges)}
                  className="pob-button pob-button--compact"
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'Mint Project Badge' ? 'Minting…' : 'Mint Project badge'}
                </button>
              );
            }

            // Community mint button - anyone without devrel/dao_hic/project role
            const canBecomeCommunity = !roles?.project && !roles?.devrel && !roles?.dao_hic;
            if (canBecomeCommunity && !hasCommunityBadge && isActive) {
              return (
                <button
                  type="button"
                  onClick={() => void executeMint('community', refreshBadges)}
                  className="pob-button pob-button--compact"
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'Mint Community Badge' ? 'Minting…' : `Mint community badge (${mintAmount} ${tokenSymbol})`}
                </button>
              );
            }

            return null;
          })()}
        </div>
      )}

      {/* Winner Section - Only show when voting has ended */}
      {votingEnded && winner && entityVotes ? (
        <FinalResultsPanel
          winner={winner}
          entityVotes={entityVotes}
          votingMode={votingMode}
          projects={projects}
          projectScores={projectScores}
          getProjectLabel={getProjectLabel}
          isOwner={isOwner}
        />
      ) : null}
    </section>
  );
};

export default IterationHeader;
