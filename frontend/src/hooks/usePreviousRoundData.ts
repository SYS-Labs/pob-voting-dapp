import { useState, useEffect } from 'react';
import { Contract, ethers } from 'ethers';
import type { PreviousRound } from '~/interfaces';
import { JurySC_01ABI } from '~/abis';
import { loadBadgesFromContract, type Badge } from '~/utils/loadBadgesFromContract';

interface RoundData {
  startTime: number | null;
  endTime: number | null;
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
  userBadges: Badge[];
  canMint: boolean; // User is eligible to mint a badge for this round
}

const normalizeAddress = (addr: string): string | null => {
  if (!addr || addr === ethers.ZeroAddress) return null;
  return addr;
};

export function usePreviousRoundData(
  round: PreviousRound,
  chainId: number,
  publicProvider: any,
  isExpanded: boolean,
  walletAddress: string | null,
) {
  const [loading, setLoading] = useState(false);
  const [roundData, setRoundData] = useState<RoundData | null>(null);

  useEffect(() => {
    if (!isExpanded || roundData || !publicProvider) return;

    const loadRoundData = async () => {
      setLoading(true);
      try {
        const contract = new Contract(round.jurySC, JurySC_01ABI, publicProvider);

        console.log(`[usePreviousRoundData] Loading data for Round #${round.round}`, {
          jurySC: round.jurySC,
          pob: round.pob,
          walletAddress,
        });

        // Load contract data and badges in parallel
        const [devRelRaw, daoHicRaw, communityRaw, winnerRaw, startTime, endTime, userBadges, devRelAccount, daoHicVoters, isRegisteredProject] = await Promise.all([
          contract.getDevRelEntityVote().catch(() => ethers.ZeroAddress),
          contract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress),
          contract.getCommunityEntityVote().catch(() => ethers.ZeroAddress),
          contract.getWinner().catch(() => [ethers.ZeroAddress, false] as [string, boolean]),
          contract.startTime().catch(() => 0),
          contract.endTime().catch(() => 0),
          walletAddress
            ? loadBadgesFromContract(round.pob, chainId, walletAddress, publicProvider, round.deployBlockHint, round.round)
            : Promise.resolve([]),
          contract.devRelAccount().catch(() => ethers.ZeroAddress),
          contract.getDaoHicVoters().catch(() => [] as string[]),
          walletAddress ? contract.isRegisteredProject(walletAddress).catch(() => false) : Promise.resolve(false),
        ]);

        const [winnerAddressRaw, hasWinnerRaw] = Array.isArray(winnerRaw)
          ? winnerRaw
          : [ethers.ZeroAddress, false];

        // Check if user can mint a badge (participated in this round)
        let canMint = false;
        if (walletAddress && userBadges.length === 0) {
          // No badge minted yet - check eligibility
          const walletLower = walletAddress.toLowerCase();
          const isDevRel = devRelAccount && devRelAccount.toLowerCase() === walletLower;
          const isDaoHic = Array.isArray(daoHicVoters) && daoHicVoters.some((v: string) => v.toLowerCase() === walletLower);

          canMint = isDevRel || isDaoHic || Boolean(isRegisteredProject);
        }

        const data: RoundData = {
          startTime: Number(startTime) || null,
          endTime: Number(endTime) || null,
          winner: {
            projectAddress: normalizeAddress(winnerAddressRaw),
            hasWinner: Boolean(hasWinnerRaw),
          },
          entityVotes: {
            devRel: normalizeAddress(devRelRaw),
            daoHic: normalizeAddress(daoHicRaw),
            community: normalizeAddress(communityRaw),
          },
          userBadges,
          canMint,
        };

        console.log(`[usePreviousRoundData] Loaded data for Round #${round.round}`, data);
        setRoundData(data);
      } catch (error) {
        console.error(`[usePreviousRoundData] Failed to load data for Round #${round.round}`, error);
        // Set empty data on error to show something instead of "No data available"
        setRoundData({
          startTime: null,
          endTime: null,
          winner: { projectAddress: null, hasWinner: false },
          entityVotes: { devRel: null, daoHic: null, community: null },
          userBadges: [],
          canMint: false,
        });
      } finally {
        setLoading(false);
      }
    };

    void loadRoundData();
  }, [isExpanded, roundData, publicProvider, round.jurySC, round.pob, round.round, chainId, walletAddress]);

  return { loading, roundData };
}
