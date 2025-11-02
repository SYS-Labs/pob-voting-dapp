import type { Badge } from '~/interfaces';
import BadgeCard from '~/components/BadgeCard';

interface CommunityBadge {
  tokenId: string;
  hasVoted: boolean;
  vote: string | null;
  claimed?: boolean;
}

interface BadgePanelProps {
  badges: Badge[]; // Pre-filtered to current iteration only
  communityBadges: CommunityBadge[]; // Pre-filtered to current iteration only
  walletAddress: string | null;
  statusFlags: { isActive: boolean; votingEnded: boolean };
  onClaim: (tokenId: string) => void;
  pendingAction: string | null;
}

const BadgePanel = ({
  badges,
  communityBadges,
  walletAddress,
  statusFlags,
  onClaim,
  pendingAction,
}: BadgePanelProps) => {
  // Early return if no wallet or no badges
  if (!walletAddress || badges.length === 0) return null;

  return (
    <section className="pob-pane">
      <div className="space-y-4">
        {badges.map((badge) => {
          // Find community badge details if applicable
          const communityBadge = badge.role === 'community'
            ? communityBadges.find((cb) => cb.tokenId === badge.tokenId)
            : null;

          return (
            <div key={badge.tokenId} className="space-y-3">
              <BadgeCard badge={badge} />

              {/* Claim button for community badges */}
              {communityBadge?.claimed === false && statusFlags.votingEnded && (
                <button
                  type="button"
                  onClick={() => onClaim(communityBadge.tokenId)}
                  disabled={pendingAction !== null}
                  className="pob-button w-full justify-center text-xs"
                >
                  {pendingAction === `Claim deposit for token ${communityBadge.tokenId}`
                    ? 'Claiming…'
                    : 'Claim deposit'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default BadgePanel;
