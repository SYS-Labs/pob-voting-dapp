import type { Iteration, IterationStatus } from '~/interfaces';
import IterationCard from './IterationCard';

interface IterationSectionProps {
  title: string;
  iterations: Iteration[];
  selectedIteration: number | null;
  iterationStatuses: { [iterationNumber: number]: IterationStatus };
  onSelectIteration: (iteration: number) => void;
}

const IterationSection = ({ title, iterations, selectedIteration, iterationStatuses, onSelectIteration }: IterationSectionProps) => {
  if (!iterations.length) return null;

  const getStatusBadge = (status: IterationStatus | undefined) => {
    const effectiveStatus = status ?? 'upcoming';
    switch (effectiveStatus) {
      case 'active':
        return { label: 'Active', color: 'pob-pill pob-pill--active' };
      case 'ended':
        return { label: 'Ended', color: 'pob-pill pob-pill--ended' };
      case 'upcoming':
      default:
        return { label: 'Upcoming', color: 'pob-pill pob-pill--upcoming' };
    }
  };

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <h3 className="pob-pane__title">{title}</h3>
        <span className="pob-pane__meta">
          {iterations.length} iteration{iterations.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
        {iterations.map((iteration) => {
          const isSelected = iteration.iteration === selectedIteration;
          const status = iterationStatuses[iteration.iteration];
          const statusBadge = getStatusBadge(status);

          return (
            <IterationCard
              key={`${title}-${iteration.iteration}`}
              iteration={iteration}
              isActive={isSelected}
              statusBadge={statusBadge}
              onSelect={() => onSelectIteration(iteration.iteration)}
            />
          );
        })}
      </div>
    </section>
  );
};

export default IterationSection;
