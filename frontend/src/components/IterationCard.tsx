import { Link } from 'react-router-dom';
import type { Iteration } from '~/interfaces';

interface IterationCardProps {
  iteration: Iteration;
  isActive: boolean;
  statusBadge?: { label: string; color: string } | null;
  onSelect?: () => void;
}

const IterationCard = ({ iteration, isActive, statusBadge, onSelect }: IterationCardProps) => {
  return (
    <Link
      to={`/iteration/${iteration.iteration}`}
      onClick={() => onSelect?.()}
      className={`pob-pane pob-pane--subtle flex flex-col justify-between transition block no-underline ${
        isActive ? 'shadow-[0_0_22px_rgba(247,147,26,0.35)]' : ''
      }`}
      style={{
        borderColor: isActive ? 'var(--pob-primary)' : 'rgba(247, 147, 26, 0.4)',
      }}
    >
      <div className="space-y-3">
        <div className="pob-pane__heading">
          <h2 className="pob-pane__title text-lg">{iteration.name}</h2>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--pob-text-muted)]">
          Iteration #{iteration.iteration}{iteration.round ? ` - Round #${iteration.round}` : ''}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-end">
        {statusBadge && <span className={statusBadge.color}>{statusBadge.label}</span>}
      </div>
    </Link>
  );
};

export default IterationCard;
