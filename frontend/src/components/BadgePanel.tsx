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
  voteCounts?: { devRel: number; daoHic: number; community: number };
  daoHicVoters?: string[];
  totalCommunityVoters?: number;
}

const BadgePanel = ({
  badges,
  communityBadges,
  walletAddress,
  statusFlags,
  onClaim,
  pendingAction,
  voteCounts,
  daoHicVoters = [],
  totalCommunityVoters = 0,
}: BadgePanelProps) => {
  // Show panel if there's a wallet and either badges OR voting is active
  const showBadges = walletAddress && badges.length > 0;
  const showVotingProgress = (statusFlags.isActive || statusFlags.votingEnded) && voteCounts;

  if (!showBadges && !showVotingProgress) return null;

  return (
    <section className="pob-pane">
      {/* Grid layout: badges on left, voting progress on right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2.1rem' }}>
        {/* Badge section - Left column */}
        <div className="space-y-4">
          {showBadges && badges.map((badge) => {
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

        {/* Voting progress section - Right column */}
        <div className="space-y-3">
          {showVotingProgress && (
            <>
              <h4 className="text-sm font-semibold text-white" style={{ marginTop: 0 }}>Voting progress</h4>
              {(() => {
                const communityCap =
                  Number.isFinite(totalCommunityVoters) && totalCommunityVoters > 0 ? totalCommunityVoters.toString() : '∞';
                const votingRows = [
                  { label: 'Community', value: `${voteCounts.community}/${communityCap}` },
                  { label: 'DAO HIC', value: `${voteCounts.daoHic}/${daoHicVoters.length}` },
                  { label: 'DevRel', value: `${voteCounts.devRel}/1` },
                ].sort((a, b) => a.label.localeCompare(b.label));

                return votingRows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-[var(--pob-text-muted)]">{row.label}</span>
                    <span className="pob-mono text-base font-semibold text-white">{row.value}</span>
                  </div>
                ));
              })()}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default BadgePanel;
