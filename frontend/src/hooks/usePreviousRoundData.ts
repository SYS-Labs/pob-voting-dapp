import { useState, useEffect } from 'react';
import { Contract, ethers } from 'ethers';
import type { PreviousRound } from '~/interfaces';
import JurySC_01_v001_ABI from '~/abis/JurySC_01_v001.json';
import JurySC_01_v002_ABI from '~/abis/JurySC_01_v002.json';
import { loadBadgesFromContract, type Badge } from '~/utils/loadBadgesFromContract';

interface RoundData {
  startTime: number | null;
  endTime: number | null;
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
  userBadges: Badge[];
  canMint: boolean; // User is eligible to mint a badge for this round
  votingMode: number;
  projects: { id: number; address: string }[];
  projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null;
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
        // Select ABI based on version
        const abiToUse = round.version === '001' ? JurySC_01_v001_ABI : JurySC_01_v002_ABI;
        const contract = new Contract(round.jurySC, abiToUse, publicProvider);

        console.log(`[usePreviousRoundData] Loading data for Round #${round.round}`, {
          jurySC: round.jurySC,
          pob: round.pob,
          version: round.version,
          abiVersion: round.version === '001' ? 'v001' : 'v002',
          walletAddress,
        });

        // Use version-based detection instead of trying function calls
        const isV001 = round.version === '001';
        const isV002OrNewer = round.version >= '002';

        let votingMode = 0;

        if (isV001) {
          // Version 001: Old contract, use JSON votingMode if provided or default to 0
          votingMode = round.votingMode !== undefined ? round.votingMode : 0;
        } else if (isV002OrNewer) {
          // Version 002+: New contract, check JSON first then query contract
          if (round.votingMode !== undefined) {
            votingMode = round.votingMode;
          } else {
            try {
              votingMode = Number(await contract.votingMode());
            } catch {
              votingMode = 0;
            }
          }
        }

        // Determine which winner function to call based on version
        // v001: always use getWinner()
        // v002+: use getWinnerConsensus() or getWinnerWeighted() based on mode
        const winnerPromise = isV001
          ? contract.getWinner().catch(() => [ethers.ZeroAddress, false] as [string, boolean])
          : (votingMode === 0
              ? contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean])
              : contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]));

        // Load contract data and badges in parallel
        const [devRelRaw, daoHicRaw, communityRaw, winnerRaw, startTime, endTime, projectCount, userBadges, devRelAccount, daoHicVoters, isRegisteredProject] = await Promise.all([
          contract.getDevRelEntityVote().catch(() => ethers.ZeroAddress),
          contract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress),
          contract.getCommunityEntityVote().catch(() => ethers.ZeroAddress),
          winnerPromise,
          contract.startTime().catch(() => 0),
          contract.endTime().catch(() => 0),
          contract.projectCount().catch(() => 0),
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

        // Load project addresses
        const count = Number(projectCount);
        const projectAddressCalls = [];
        for (let index = 1; index <= count; index += 1) {
          projectAddressCalls.push(contract.projectAddress(index));
        }
        const projectAddresses = count > 0 ? await Promise.all(projectAddressCalls) : [];

        // Build projects array
        const projects = projectAddresses.map((addr, index) => ({
          id: index + 1,
          address: addr as string,
        }));

        // Load project scores if in weighted mode AND v002+
        let projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null = null;
        if (votingMode === 1 && isV002OrNewer) {
          try {
            const [addresses, scores, totalPossible] = await contract.getWinnerWithScores();
            projectScores = {
              addresses: addresses as string[],
              scores: (scores as bigint[]).map(s => s.toString()),
              totalPossible: (totalPossible as bigint).toString(),
            };
          } catch (error) {
            console.log('[usePreviousRoundData] getWinnerWithScores not available or failed:', error);
          }
        }

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
          votingMode,
          projects,
          projectScores,
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
          votingMode: 0,
          projects: [],
          projectScores: null,
        });
      } finally {
        setLoading(false);
      }
    };

    void loadRoundData();
  }, [isExpanded, roundData, publicProvider, round.jurySC, round.pob, round.round, round.version, round.votingMode, chainId, walletAddress]);

  return { loading, roundData };
}
