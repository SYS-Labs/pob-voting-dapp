import { useState, useCallback, useMemo } from 'react';
import { Contract } from 'ethers';
import type { PreviousRound, ParticipantRole } from '~/interfaces';
import { PoB_01ABI } from '~/abis';
import { formatDate } from '~/utils';
import { usePreviousRoundData } from '~/hooks/usePreviousRoundData';
import FinalResultsPanel from './FinalResultsPanel';
import ContractAddress from './ContractAddress';

interface PreviousRoundCardProps {
  round: PreviousRound;
  chainId: number;
  publicProvider: any;
  isOwner: boolean;
  walletAddress: string | null;
  signer: any;
  pendingAction: string | null;
  getProjectLabel: (address: string | null) => string | null;
  runTransaction: (label: string, txFn: () => Promise<any>, refreshFn?: () => Promise<void>) => Promise<boolean>;
  refreshBadges: () => Promise<void>;
}

const PreviousRoundCard = ({
  round,
  chainId,
  publicProvider,
  isOwner,
  walletAddress,
  signer,
  pendingAction,
  getProjectLabel,
  runTransaction,
  refreshBadges,
}: PreviousRoundCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { loading, roundData } = usePreviousRoundData(round, chainId, publicProvider, isExpanded, walletAddress);

  // Create a local getProjectLabel that uses this round's project metadata
  const localGetProjectLabel = useMemo(() => {
    if (!roundData?.projects) return getProjectLabel;

    return (address: string | null): string | null => {
      if (!address) return null;
      const project = roundData.projects.find(
        p => p.address.toLowerCase() === address.toLowerCase()
      );
      if (project?.metadata?.name) {
        return project.metadata.name;
      }
      // Fallback to parent's getProjectLabel (for current iteration projects)
      return getProjectLabel(address);
    };
  }, [roundData?.projects, getProjectLabel]);

  // Determine user's role in this round for minting
  const getUserRole = async (): Promise<ParticipantRole | null> => {
    if (!walletAddress || !signer) return null;
    try {
      const contract = new Contract(round.jurySC, ['function devRelAccount() view returns (address)', 'function getDaoHicVoters() view returns (address[])', 'function getProjects() view returns (address[])'], publicProvider);
      const [devRel, daoHicVoters, projects] = await Promise.all([
        contract.devRelAccount(),
        contract.getDaoHicVoters(),
        contract.getProjects(),
      ]);
      const walletLower = walletAddress.toLowerCase();
      if (devRel && devRel.toLowerCase() === walletLower) return 'devrel';
      if (daoHicVoters.some((v: string) => v.toLowerCase() === walletLower)) return 'dao_hic';
      if (projects.some((p: string) => p.toLowerCase() === walletLower)) return 'project';
    } catch (err) {
      console.error('[PreviousRoundCard] Failed to determine user role', err);
    }
    return null;
  };

  const handleMintBadge = async () => {
    if (!signer) return;
    const role = await getUserRole();
    if (!role) {
      console.error('[PreviousRoundCard] Could not determine role for minting');
      return;
    }

    const contract = new Contract(round.pob, PoB_01ABI, signer);
    let tx: () => Promise<unknown>;
    let label: string;

    switch (role) {
      case 'devrel':
        tx = () => contract.mintDevRel();
        label = `Mint DevRel Badge (Round ${round.round})`;
        break;
      case 'dao_hic':
        tx = () => contract.mintDaoHic();
        label = `Mint DAO HIC Badge (Round ${round.round})`;
        break;
      case 'project':
        tx = () => contract.mintProject();
        label = `Mint Project Badge (Round ${round.round})`;
        break;
      default:
        return;
    }

    await runTransaction(label, tx, refreshBadges);
  };

  const handleClaimDeposit = async (tokenId: string) => {
    if (!signer) return;
    const contract = new Contract(round.pob, PoB_01ABI, signer);
    await runTransaction(
      `Claim deposit for token ${tokenId} (Round ${round.round})`,
      () => contract.claim(tokenId),
      refreshBadges,
    );
  };

  const handleCardClick = useCallback(() => {
    if (isExpanded) return; // Don't do anything if already expanded
    console.log('[PreviousRoundCard] Card clicked, expanding round', round.round);
    setIsExpanded(true);
  }, [isExpanded, round.round]);

  return (
    <section
      className={`pob-pane ${!isExpanded ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isExpanded) {
          e.preventDefault();
          setIsExpanded(true);
        }
      }}
      style={!isExpanded ? { paddingBottom: '0.75rem' } : {}}
    >
      <div className={`pob-pane__heading ${!isExpanded ? 'mb-0' : ''}`}>
        <div>
          <h3 className="pob-pane__title inline">
            Round #{round.round}
            {(isExpanded && roundData ? (
              <span className={`pob-pill text-xs ${
                roundData.winner.hasWinner ? 'pob-pill--success' : 'pob-pill--failure'
              }`}>
                {roundData.votingMode === 0 ? 'Consensus' : 'Weighted'} {roundData.winner.hasWinner ? '✓' : '✗'}
              </span>
            ) : round.votingMode !== undefined ? (
              <span className="pob-pill pob-pill--neutral text-xs">
                {round.votingMode === 0 ? 'Consensus' : 'Weighted'}
              </span>
            ) : null)}
          </h3>
          {!isExpanded && (
            <span className="text-xs text-[var(--pob-primary)]" style={{ marginLeft: '0.5rem' }}>(click for details)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && roundData && walletAddress && (() => {
            const badges = roundData.userBadges;
            const hasBadge = badges.length > 0;
            const communityBadge = badges.find(b => b.role === 'community');

            if (hasBadge) {
              // Badge already minted - show status and claim button if needed
              if (communityBadge && !communityBadge.claimed) {
                // Community badge with unclaimed deposit
                return (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleClaimDeposit(communityBadge.tokenId);
                      }}
                      disabled={pendingAction !== null}
                      className="pob-button text-xs"
                    >
                      {pendingAction?.includes(communityBadge.tokenId) ? 'Claiming…' : 'Claim deposit'}
                    </button>
                    <span className="pob-pill pob-pill--active">Minted</span>
                  </>
                );
              }
              // Badge minted and claimed (or non-community)
              return <span className="pob-pill pob-pill--active">Minted already</span>;
            }

            // No badge yet - show mint button if eligible
            if (roundData.canMint) {
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleMintBadge();
                  }}
                  disabled={pendingAction !== null}
                  className="pob-button text-xs"
                >
                  {pendingAction?.includes(`Round ${round.round}`) ? 'Minting…' : 'Mint badge'}
                </button>
              );
            }
            return null;
          })()}
          <span className="pob-pill pob-pill--ended">Ended</span>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {loading ? (
            <p className="text-sm text-[var(--pob-text-muted)]">Loading round data...</p>
          ) : roundData ? (
            <>
              <dl className="pob-pane__grid text-sm text-[var(--pob-text-muted)] sm:grid-cols-2">
                <div>
                  <dt className="pob-label">Start Time</dt>
                  <dd>{formatDate(roundData.startTime || undefined)}</dd>
                </div>
                <div>
                  <dt className="pob-label">End Time</dt>
                  <dd>{formatDate(roundData.endTime || undefined)}</dd>
                </div>
                <div>
                  <dt className="pob-label">Jury Contract</dt>
                  <dd><ContractAddress address={round.jurySC} chainId={chainId} /></dd>
                </div>
                <div>
                  <dt className="pob-label">PoB Contract</dt>
                  <dd><ContractAddress address={round.pob} chainId={chainId} /></dd>
                </div>
              </dl>

              {/* Final Results */}
              <FinalResultsPanel
                winner={roundData.winner}
                entityVotes={roundData.entityVotes}
                votingMode={roundData.votingMode}
                projects={roundData.projects}
                projectScores={roundData.projectScores}
                getProjectLabel={localGetProjectLabel}
                isOwner={isOwner}
              />
            </>
          ) : (
            <p className="text-sm text-[var(--pob-text-muted)]">No data available</p>
          )}
        </div>
      )}
    </section>
  );
};

export default PreviousRoundCard;
