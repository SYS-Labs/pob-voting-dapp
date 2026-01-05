import type { Badge } from '~/interfaces';
import BadgeCard from '~/components/BadgeCard';
import { ProgressSpinner } from '~/components/ProgressSpinner';

interface BadgesPageProps {
  badges: Badge[];
  walletAddress: string | null;
  loading: boolean;
}

const BadgesPage = ({ badges, walletAddress, loading }: BadgesPageProps) => {
  // Show loader only if loading AND we don't have any badges cached
  // This way, if badges are cached, they show immediately without spinner
  const showLoader = loading && badges.length === 0 && walletAddress;

  return (
    <div className="pob-stack" id="badges-page">
      <section className="pob-pane pob-pane--subtle">
        {walletAddress ? (
          <>
            {showLoader ? (
              <div className="flex flex-col items-center justify-center py-12">
                <ProgressSpinner size={48} className="mb-4" />
                <p className="text-sm text-[var(--pob-text-muted)]">
                  Loading your badges...
                </p>
              </div>
            ) : (
              <>
                {badges.length > 0 ? (
                  <>
                    <p className="text-sm text-[var(--pob-text-muted)] mb-4">
                      These are your footprints in Syscoin history:
                    </p>
                    <div className="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
                      {badges.map((badge) => (
                        <BadgeCard key={`${badge.iteration}-${badge.round || 'main'}-${badge.tokenId}`} badge={badge} />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-sm text-[var(--pob-text-muted)] mb-4">
                      You don't have any badges yet.
                    </p>
                    <p className="text-sm text-[var(--pob-text-muted)]">
                      Participate in an iteration to earn your first badge!
                    </p>
                  </div>
                )}
              </>
            )}
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
