import type { Iteration, ParticipantRole, Badge } from '~/interfaces';
import { formatDate } from '~/utils';
import { NETWORKS } from '~/constants/networks';

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
  const explorerUrl = network?.explorerUrl;
  const mintAmount = network?.mintAmount ?? '30';
  const tokenSymbol = network?.tokenSymbol ?? 'TSYS';

  const ContractAddress = ({ address }: { address: string; label: string }) => {
    if (explorerUrl) {
      return (
        <a
          href={`${explorerUrl}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="pob-mono text-xs text-white/80 hover:text-[var(--pob-primary)] transition-colors underline decoration-transparent hover:decoration-inherit"
        >
          {address}
        </a>
      );
    }
    return <span className="pob-mono text-xs text-white/80">{address}</span>;
  };

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <div>
          <p className="pob-pane__meta">Current iteration</p>
          <h2 className="pob-pane__title text-3xl">{iteration.name}</h2>
          <p className="mt-1 text-sm text-[var(--pob-text-muted)]">
            Iteration #{iteration.iteration}{iteration.round ? ` - Round #${iteration.round}` : ''}
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
          <dd><ContractAddress address={iteration.jurySC} label="Jury Contract" /></dd>
        </div>
        <div>
          <dt className="pob-label">PoB Contract</dt>
          <dd><ContractAddress address={iteration.pob} label="PoB Contract" /></dd>
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
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            border: '2px solid var(--pob-primary)',
            borderRadius: '0.5rem',
            backgroundColor: 'rgba(247, 147, 26, 0.05)',
          }}
        >
          <h4 className="text-sm font-semibold text-white mb-2">Final Result</h4>

          {winner.hasWinner && winner.projectAddress ? (
            <div className="space-y-2">
              <p className="text-lg font-bold text-[var(--pob-primary)]">
                🏆 Winner:{' '}
                <span className="italic">
                  {getProjectLabel
                    ? getProjectLabel(winner.projectAddress) ?? winner.projectAddress
                    : winner.projectAddress}
                </span>
              </p>
              <p className="text-xs text-[var(--pob-text-muted)]">
                Determined by majority vote across three entities (DevRel, DAO HIC, Community).
                This project received the most entity votes.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-yellow-400">
                ⚠️ No Consensus Reached
              </p>
              <p className="text-xs text-[var(--pob-text-muted)] mb-2">
                The contract's winner determination logic found no clear winner.
                Each of the three voting entities (DevRel, DAO HIC, Community) votes independently,
                and the winning project must receive a majority of entity votes.
              </p>
              <div className="text-xs text-[var(--pob-text-muted)] space-y-1">
                <p className="font-semibold text-white">Entity Votes Cast:</p>
                {[
                  { label: 'Community', address: entityVotes.community },
                  { label: 'DAO HIC', address: entityVotes.daoHic },
                  { label: 'DevRel', address: entityVotes.devRel },
                ]
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map(({ label, address }) => (
                    <p key={label}>
                      • {label}:{' '}
                      {address ? (
                        isOwner ? (
                          <span className="italic">
                            {getProjectLabel ? getProjectLabel(address) ?? 'Voted' : 'Voted'}
                          </span>
                        ) : (
                          <span className="italic">Hidden (owner only)</span>
                        )
                      ) : (
                        'Did not vote'
                      )}
                    </p>
                  ))}
              </div>
              {entityVotes.devRel && entityVotes.daoHic && entityVotes.community &&
               entityVotes.devRel !== entityVotes.daoHic &&
               entityVotes.daoHic !== entityVotes.community &&
               entityVotes.devRel !== entityVotes.community ? (
                <p className="text-xs text-[var(--pob-text-muted)] mt-2">
                  Result: Three-way tie (each entity voted for a different project)
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default IterationHeader;
