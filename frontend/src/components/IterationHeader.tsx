import type { Iteration } from '~/interfaces';
import { formatDate } from '~/utils';
import { NETWORKS } from '~/constants/networks';

interface IterationHeaderProps {
  iteration: Iteration | null;
  statusBadge: { label: string; color: string };
  iterationTimes: { startTime: number | null; endTime: number | null };
  votingEnded?: boolean;
  winner?: { projectAddress: string | null; hasWinner: boolean };
  entityVotes?: { devRel: string | null; daoHic: string | null; community: string | null };
  getProjectLabel?: (address: string | null) => string | null;
  isOwner?: boolean;
}

const IterationHeader = ({
  iteration,
  statusBadge,
  iterationTimes,
  votingEnded,
  winner,
  entityVotes,
  getProjectLabel,
  isOwner = false,
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
        <span className={statusBadge.color}>{statusBadge.label}</span>
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
      {iteration.link ? (
        <a
          href={iteration.link}
          target="_blank"
          rel="noopener noreferrer"
          className="pob-button pob-button--compact"
        >
          Program brief
        </a>
      ) : null}

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
