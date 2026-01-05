import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { Iteration, IterationMetadata } from '~/interfaces';
import { metadataAPI } from '~/utils/metadata-api';

interface IterationCardProps {
  iteration: Iteration;
  isActive: boolean;
  statusBadge?: { label: string; color: string } | null;
  onSelect?: () => void;
  onAddRound?: () => void;
  disableLink?: boolean;
}

const IterationCard = ({ iteration, isActive, statusBadge, onSelect, onAddRound, disableLink }: IterationCardProps) => {
  const [metadata, setMetadata] = useState<IterationMetadata | null>(null);

  // Load iteration metadata
  useEffect(() => {
    if (!iteration.jurySC) return;

    const loadMetadata = async () => {
      try {
        const data = await metadataAPI.getIterationMetadata(
          iteration.chainId,
          iteration.jurySC
        );
        setMetadata(data);
      } catch (error) {
        // Silently fail - fallback to iteration.name
      }
    };

    loadMetadata();
  }, [iteration.chainId, iteration.jurySC]);

  const content = (
    <>
      <div className="space-y-3">
        <div className="pob-pane__heading">
          <h2 className="pob-pane__title text-lg">{metadata?.name || iteration.name}</h2>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--pob-text-muted)]">
          Iteration #{iteration.iteration}{iteration.round ? ` - Round #${iteration.round}` : ''}
        </p>
        {!iteration.round && (
          <p className="text-xs text-[var(--pob-text-muted)]">
            Round not registered yet.
          </p>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between">
        {onAddRound ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddRound?.();
            }}
            className="pob-button pob-button--compact"
          >
            Add round
          </button>
        ) : (
          <span />
        )}
        {statusBadge && <span className={statusBadge.color}>{statusBadge.label}</span>}
      </div>
    </>
  );

  if (disableLink) {
    return (
      <div
        className={`pob-pane pob-pane--subtle flex flex-col justify-between transition ${
          isActive ? 'shadow-[0_0_22px_rgba(247,147,26,0.35)]' : ''
        }`}
        style={{
          borderColor: isActive ? 'var(--pob-primary)' : 'rgba(247, 147, 26, 0.4)',
        }}
      >
        {content}
      </div>
    );
  }

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
      {content}
    </Link>
  );
};

export default IterationCard;
