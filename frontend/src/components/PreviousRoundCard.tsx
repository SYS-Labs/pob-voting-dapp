import { useState } from 'react';
import { Contract } from 'ethers';
import type { PreviousRound, ParticipantRole } from '~/interfaces';
import { NETWORKS } from '~/constants/networks';
import { PoB_01ABI } from '~/abis';
import { formatDate } from '~/utils';
import { usePreviousRoundData } from '~/hooks/usePreviousRoundData';

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

  const network = NETWORKS[chainId];
  const explorerUrl = network?.explorerUrl;

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

  const ContractAddress = ({ address }: { address: string }) => {
    if (explorerUrl) {
      return (
        <a
          href={`${explorerUrl}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="pob-mono text-xs text-white/80 hover:text-[var(--pob-primary)] transition-colors underline decoration-transparent hover:decoration-inherit"
        >
          {address}
        </a>
      );
    }
    return <span className="pob-mono text-xs text-white/80">{address}</span>;
  };

  return (
    <section
      className={`pob-pane ${!isExpanded ? 'cursor-pointer' : ''}`}
      onClick={() => !isExpanded && setIsExpanded(true)}
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
          <h3 className="pob-pane__title inline">Round #{round.round}</h3>
          {!isExpanded && (
            <span className="text-xs text-[var(--pob-primary)]">&nbsp;&nbsp;(click for details)</span>
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
                  <dd><ContractAddress address={round.jurySC} /></dd>
                </div>
                <div>
                  <dt className="pob-label">PoB Contract</dt>
                  <dd><ContractAddress address={round.pob} /></dd>
                </div>
              </dl>

              {/* Winner Section */}
              <div
                style={{
                  padding: '1rem',
                  border: '2px solid var(--pob-primary)',
                  borderRadius: '0.5rem',
                  backgroundColor: 'rgba(247, 147, 26, 0.05)',
                }}
              >
                <h4 className="text-sm font-semibold text-white mb-2">Final Result</h4>

                {roundData.winner.hasWinner && roundData.winner.projectAddress ? (
                  <div className="space-y-2">
                    <p className="text-lg font-bold text-[var(--pob-primary)]">
                      🏆 Winner:{' '}
                      <span className="italic">
                        {getProjectLabel(roundData.winner.projectAddress) ?? roundData.winner.projectAddress}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--pob-text-muted)]">
                      Determined by majority vote across three entities (DevRel, DAO HIC, Community).
                      This project received the most entity votes.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-yellow-400">⚠️ No Consensus Reached</p>
                    <p className="text-xs text-[var(--pob-text-muted)] mb-2">
                      The contract's winner determination logic found no clear winner.
                      Each of the three voting entities (DevRel, DAO HIC, Community) votes independently,
                      and the winning project must receive a majority of entity votes.
                    </p>
                    <div className="text-xs text-[var(--pob-text-muted)] space-y-1">
                      <p className="font-semibold text-white">
                        {isOwner ? 'Entity Votes Cast:' : 'Votes Cast:'}
                      </p>
                      {[
                        { label: 'Community', address: roundData.entityVotes.community },
                        { label: 'DAO HIC', address: roundData.entityVotes.daoHic },
                        { label: 'DevRel', address: roundData.entityVotes.devRel },
                      ]
                        .sort((a, b) => a.label.localeCompare(b.label))
                        .map(({ label, address }) => (
                          <p key={label}>
                            •{isOwner ? <strong> {label}: </strong> : ' '}
                            {address ? (
                              <span className="italic">
                                {getProjectLabel(address) ?? address}
                              </span>
                            ) : (
                              isOwner ? 'Did not vote' : 'No vote'
                            )}
                          </p>
                        ))}
                    </div>
                    {roundData.entityVotes.devRel && roundData.entityVotes.daoHic && roundData.entityVotes.community &&
                     roundData.entityVotes.devRel !== roundData.entityVotes.daoHic &&
                     roundData.entityVotes.daoHic !== roundData.entityVotes.community &&
                     roundData.entityVotes.devRel !== roundData.entityVotes.community ? (
                      <p className="text-xs text-[var(--pob-text-muted)] mt-2">
                        Result: Three-way tie (each entity voted for a different project)
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
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
