import type { Iteration } from '~/interfaces';
import { formatDate } from '~/utils';

interface IterationHeaderProps {
  iteration: Iteration | null;
  statusBadge: { label: string; color: string };
  iterationTimes: { startTime: number | null; endTime: number | null };
}

const IterationHeader = ({ iteration, statusBadge, iterationTimes }: IterationHeaderProps) => {
  if (!iteration) {
    return (
      <section className="pob-pane">
        <div>
          <p className="pob-pane__title text-xl">Select a program iteration to get started</p>
        </div>
      </section>
    );
  }

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <div>
          <p className="pob-pane__meta">Current iteration</p>
          <h2 className="pob-pane__title text-3xl">{iteration.name}</h2>
          <p className="mt-1 text-sm text-[var(--pob-text-muted)]">Iteration #{iteration.iteration}</p>
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
          <dd className="pob-mono text-xs text-white/80">{iteration.jurySC}</dd>
        </div>
        <div>
          <dt className="pob-label">PoB Contract</dt>
          <dd className="pob-mono text-xs text-white/80">{iteration.pob}</dd>
        </div>
      </dl>
      {iteration.link ? (
        <a
          href={iteration.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--pob-primary)] underline decoration-transparent transition hover:decoration-inherit"
        >
          Program brief
        </a>
      ) : null}
    </section>
  );
};

export default IterationHeader;
