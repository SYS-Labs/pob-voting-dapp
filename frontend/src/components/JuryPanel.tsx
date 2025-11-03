import type { ParticipantRole } from '~/interfaces';
import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
import { NETWORKS } from '~/constants/networks';

interface CommunityBadge {
  tokenId: string;
  hasVoted: boolean;
  vote: string | null;
  claimed?: boolean;
}

interface Badge {
  tokenId: string;
  role: string;
  iteration: number;
  claimed?: boolean;
}

interface RoleStatuses {
  community: boolean;
  devrel: boolean;
  dao_hic: boolean;
  project: boolean;
}

interface StatusFlags {
  isActive: boolean;
  votingEnded: boolean;
}

interface JuryPanelProps {
  roles: RoleStatuses;
  statusFlags: StatusFlags;
  communityBadges: CommunityBadge[];
  badges: Badge[];
  devRelVote: string | null;
  daoHicVote: string | null;
  pendingAction: string | null;
  walletAddress: string | null;
  chainId: number | null;
  getProjectLabel: (address: string | null) => string | null;
  executeMint: (role: ParticipantRole) => void;
}

const JuryPanel = ({
  roles,
  statusFlags,
  communityBadges,
  badges,
  devRelVote,
  daoHicVote,
  pendingAction,
  walletAddress,
  chainId,
  getProjectLabel,
  executeMint,
}: JuryPanelProps) => {
  // Show panel if user has any jury role OR if they can become a community member
  // Projects are NOT jurors - they have their own panel
  const hasJuryRole = roles.devrel || roles.dao_hic || roles.community;
  const canBecomeCommunity = !roles.project && !roles.devrel && !roles.dao_hic;

  // Check if current user has already minted their badge (for current iteration)
  // Note: badges array only contains badges owned by the connected wallet
  const hasDevRelBadge = badges?.some(badge => badge.role === 'devrel') ?? false;
  const hasDaoHicBadge = badges?.some(badge => badge.role === 'dao-hic') ?? false;

  if (!hasJuryRole && !canBecomeCommunity) return null;

  // Get network-specific values
  const network = chainId ? NETWORKS[chainId] : null;
  const mintAmount = network?.mintAmount ?? '30';
  const tokenSymbol = network?.tokenSymbol ?? 'TSYS';

  // Determine which role tag to show in header
  const headerRoleTag = roles.devrel
    ? { label: ROLE_LABELS.devrel, color: ROLE_COLORS.devrel }
    : roles.dao_hic
    ? { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic }
    : (roles.community || canBecomeCommunity)
    ? { label: ROLE_LABELS.community, color: ROLE_COLORS.community }
    : null;

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <h3 className="pob-pane__title">Jury Panel</h3>
        {headerRoleTag && (
          <span className={`pob-pill ${headerRoleTag.color}`}>
            {headerRoleTag.label}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* DevRel Role */}
        {roles.devrel && (
          <>
            <p className="text-sm text-[var(--pob-text-muted)]">
              As DevRel, you represent the developer relations entity and cast one vote for a project during the active voting period. Mint your commemorative badge after voting ends.
            </p>
            <p className="text-sm text-[var(--pob-text-muted)]">
              {devRelVote ? (
                <>
                  Voted for{' '}
                  <span className="italic">
                    {getProjectLabel(devRelVote) ?? 'Unknown project'}
                  </span>
                </>
              ) : (
                'Not voted yet'
              )}
            </p>
            {hasDevRelBadge ? (
              <p className="text-sm text-green-400">
                Badge minted successfully!
              </p>
            ) : (
              <>
                {statusFlags.votingEnded && (
                  <button
                    type="button"
                    onClick={() => {
                      void executeMint('devrel');
                    }}
                    className="pob-button w-full justify-center text-xs"
                    disabled={pendingAction !== null || !walletAddress}
                  >
                    {pendingAction === 'Mint DevRel Badge' ? 'Minting…' : 'Mint DevRel badge'}
                  </button>
                )}
                {!statusFlags.votingEnded && (
                  <p className="text-xs text-[var(--pob-text-muted)] italic">
                    Badge minting available after voting ends
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* DAO HIC Role */}
        {roles.dao_hic && (
          <>
            <p className="text-sm text-[var(--pob-text-muted)]">
              As a DAO HIC voter, you are part of the high-integrity council. Cast your vote during the active voting period. The council's decision is determined by majority consensus. Mint your commemorative badge after voting ends.
            </p>
            <p className="text-sm text-[var(--pob-text-muted)]">
              {daoHicVote ? (
                <>
                  Voted for{' '}
                  <span className="italic">
                    {getProjectLabel(daoHicVote) ?? 'Unknown project'}
                  </span>
                </>
              ) : (
                'Not voted yet'
              )}
            </p>
            {hasDaoHicBadge ? (
              <p className="text-sm text-green-400">
                Badge minted successfully!
              </p>
            ) : (
              <>
                {statusFlags.votingEnded && (
                  <button
                    type="button"
                    onClick={() => {
                      void executeMint('dao_hic');
                    }}
                    className="pob-button w-full justify-center text-xs"
                    disabled={pendingAction !== null || !walletAddress}
                  >
                    {pendingAction === 'Mint DAO HIC Badge' ? 'Minting…' : 'Mint DAO HIC badge'}
                  </button>
                )}
                {!statusFlags.votingEnded && (
                  <p className="text-xs text-[var(--pob-text-muted)] italic">
                    Badge minting available after voting ends
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* Community Role - Show for existing community members OR potential members */}
        {(roles.community || canBecomeCommunity) && (
          <>
            {/* State 1: Not minted yet - Invite to mint */}
            {communityBadges.length === 0 && (
              <>
                <p className="text-sm text-[var(--pob-text-muted)]">
                  As a community juror, mint your badge ({mintAmount} {tokenSymbol} deposit) during the active voting period to participate. After voting ends, you can reclaim your deposit.
                </p>
                {statusFlags.isActive && (
                  <button
                    type="button"
                    onClick={() => {
                      void executeMint('community');
                    }}
                    className="pob-button w-full justify-center text-xs"
                    disabled={pendingAction !== null || !walletAddress}
                  >
                    {pendingAction === 'Mint Community Badge' ? 'Minting…' : `Mint community badge (${mintAmount} ${tokenSymbol})`}
                  </button>
                )}
                {!statusFlags.isActive && !statusFlags.votingEnded && (
                  <p className="text-xs text-[var(--pob-text-muted)] italic">
                    Badge minting available when voting starts
                  </p>
                )}
              </>
            )}

            {/* State 2: Minted but not voted yet - Emphasize voting ability */}
            {roles.community && communityBadges.length > 0 && !communityBadges.some(b => b.hasVoted) && (
              <>
                <p className="text-sm text-[var(--pob-text-muted)]">
                  Badge minted successfully! You can now vote on projects below.
                </p>
                <p className="text-sm text-[var(--pob-text-muted)]">
                  You can <span className="underline">change your vote at any time</span> during the voting period.
                </p>
              </>
            )}

            {/* State 3: Already voted - Show vote status first, then change reminder */}
            {roles.community && communityBadges.length > 0 && communityBadges.some(b => b.hasVoted) && (
              <>
                <p className="text-sm text-[var(--pob-text-muted)]">
                  Voted for{' '}
                  <span className="font-semibold text-white italic">
                    {getProjectLabel(communityBadges.find(b => b.hasVoted)?.vote ?? null) ?? 'Unknown project'}
                  </span>
                </p>
                <p className="text-xs text-[var(--pob-text-muted)] italic">
                  You can change your vote at any time during the voting period.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default JuryPanel;
