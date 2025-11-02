import type { Badge, Iteration } from '~/interfaces';
import BadgeCard from '~/components/BadgeCard';
import PendingBadgeCard from '~/components/PendingBadgeCard';

interface BadgesPageProps {
  badges: Badge[];
  walletAddress: string | null;
  iterations: Iteration[];
  onSelectIteration: (iteration: number) => void;
}

const BadgesPage = ({ badges, walletAddress, iterations, onSelectIteration }: BadgesPageProps) => {
  // Find iterations where user doesn't have a badge yet
  const iterationsWithoutBadge = iterations.filter(
    iteration => !badges.some(badge => badge.iteration === iteration.iteration)
  );

  return (
    <div className="pob-stack" id="badges-page">
      <section className="pob-pane pob-pane--subtle">
        {walletAddress ? (
          <>
            {badges.length > 0 && (
              <p className="text-sm text-[var(--pob-text-muted)] mb-4">
                These are your footprints in Syscoin history:
              </p>
            )}
            <div className="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
              {badges.map((badge) => (
                <BadgeCard key={`${badge.iteration}-${badge.tokenId}`} badge={badge} />
              ))}
              {/* Show a pending badge card for each iteration where user doesn't have a badge */}
              {iterationsWithoutBadge.map((iteration) => (
                <PendingBadgeCard
                  key={`pending-${iteration.iteration}`}
                  iterationNumber={iteration.iteration}
                  iterationName={iteration.name}
                  onNavigateToIteration={() => onSelectIteration(iteration.iteration)}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--pob-text-muted)]">
            Connect your wallet to view your badges.
          </p>
        )}
      </section>
    </div>
  );
};

export default BadgesPage;
