interface PendingBadgeCardProps {
  iterationNumber: number;
  iterationName: string;
  onNavigateToIteration: () => void;
}

const PendingBadgeCard = ({ iterationNumber, iterationName, onNavigateToIteration }: PendingBadgeCardProps) => {
  return (
    <div className="space-y-3">
      {/* Pending Badge Placeholder */}
      <div className="aspect-square w-full rounded-lg bg-gradient-to-br from-[var(--pob-orange)]/10 to-[var(--pob-orange)]/5 flex items-center justify-center border border-[var(--pob-orange)]/20 border-dashed">
        <div className="text-center space-y-2 px-4">
          <div className="text-4xl font-bold text-[var(--pob-text-muted)] tracking-wider">
            PENDING
          </div>
          <p className="text-sm text-[var(--pob-text-muted)]">
            Iteration #{iterationNumber}
          </p>
          <p className="text-xs text-[var(--pob-text-muted)]">
            {iterationName}
          </p>
        </div>
      </div>

      {/* Action button - navigate to iteration */}
      <div className="mt-3">
        <button
          type="button"
          onClick={onNavigateToIteration}
          className="pob-pill border border-[rgba(247,147,26,0.45)] bg-[rgba(247,147,26,0.12)] text-[var(--pob-primary)] w-full flex items-center justify-center py-2 cursor-pointer hover:bg-[rgba(247,147,26,0.2)] transition-colors"
        >
          View iteration
        </button>
      </div>
    </div>
  );
};

export default PendingBadgeCard;
