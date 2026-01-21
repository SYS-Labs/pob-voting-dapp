import { useState, useEffect } from 'react';
import { Contract, ethers } from 'ethers';
import type { PreviousRound, ProjectMetadata } from '~/interfaces';
import JurySC_01_v001_ABI from '~/abis/JurySC_01_v001.json';
import JurySC_01_v002_ABI from '~/abis/JurySC_01_v002.json';
import { loadBadgesFromContract, type Badge } from '~/utils/loadBadgesFromContract';
import { batchGetProjectMetadataCIDs } from '~/utils/registry';
import { metadataAPI } from '~/utils/metadata-api';

interface RoundData {
  startTime: number | null;
  endTime: number | null;
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
  daoHicIndividualVotes: Record<string, string>;
  userBadges: Badge[];
  canMint: boolean; // User is eligible to mint a badge for this round
  votingMode: number;
  projects: { id: number; address: string; metadata?: ProjectMetadata }[];
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

        // Detect voting mode based on contract version
        // v001: Always CONSENSUS, use getWinner()
        // v002: Dual mode - detect by checking which winner function returns a result
        // v003+: Trust votingMode() from contract
        const version = round.version || '003';
        let votingMode = 0;
        let winnerRaw: [string, boolean] = [ethers.ZeroAddress, false];

        if (version === '001') {
          // v001: Always CONSENSUS
          votingMode = 0;
          winnerRaw = await contract.getWinner().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
          console.log(`[usePreviousRoundData] Round #${round.round}: v001 - CONSENSUS mode`);
        } else if (version === '002') {
          // v002: Dual mode - detect by checking which has a winner
          const [consensusWinner, weightedWinner] = await Promise.all([
            contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean]),
            contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]),
          ]) as [[string, boolean], [string, boolean]];

          if (weightedWinner[1] && !consensusWinner[1]) {
            votingMode = 1;
            winnerRaw = weightedWinner;
            console.log(`[usePreviousRoundData] Round #${round.round}: v002 dual - detected WEIGHTED mode`);
          } else {
            votingMode = 0;
            winnerRaw = consensusWinner;
            console.log(`[usePreviousRoundData] Round #${round.round}: v002 dual - detected CONSENSUS mode`);
          }
        } else {
          // v003+: Trust votingMode() from contract
          votingMode = Number(await contract.votingMode().catch(() => 0));
          winnerRaw = votingMode === 0
            ? await contract.getWinnerConsensus().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean]
            : await contract.getWinnerWeighted().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
          console.log(`[usePreviousRoundData] Round #${round.round}: v003+ - using votingMode(): ${votingMode}`);
        }

        const isV001 = version === '001';

        // Load contract data and badges in parallel
        const [devRelRaw, daoHicRaw, communityRaw, startTime, endTime, projectCount, userBadges, devRelAccount, daoHicVoters, isRegisteredProject] = await Promise.all([
          contract.getDevRelEntityVote().catch(() => ethers.ZeroAddress),
          contract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress),
          contract.getCommunityEntityVote().catch(() => ethers.ZeroAddress),
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
        const projectAddresses: string[] = count > 0 ? await Promise.all(projectAddressCalls) : [];

        // Fetch project metadata from PoBRegistry using this round's JurySC
        let metadataMap: Record<string, ProjectMetadata> = {};
        if (projectAddresses.length > 0) {
          try {
            const cidMap = await batchGetProjectMetadataCIDs(
              chainId,
              round.jurySC, // Use THIS round's JurySC, not the current iteration's
              projectAddresses,
              publicProvider
            );
            const cids = Array.from(cidMap.values()).filter(cid => cid.length > 0);
            if (cids.length > 0) {
              const fetchedMetadata = await metadataAPI.batchGetByCIDs(cids);
              // Build address -> metadata map
              for (const [address, cid] of cidMap.entries()) {
                if (cid && fetchedMetadata[cid]) {
                  metadataMap[address.toLowerCase()] = fetchedMetadata[cid];
                }
              }
            }
          } catch (err) {
            console.warn(`[usePreviousRoundData] Failed to load project metadata for Round #${round.round}:`, err);
          }
        }

        // Build projects array with metadata
        const projects = projectAddresses.map((addr, index) => ({
          id: index + 1,
          address: addr as string,
          metadata: metadataMap[addr.toLowerCase()],
        }));

        // Load project scores if in weighted mode (v002+ contracts have getWinnerWithScores)
        let projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null = null;
        if (votingMode === 1 && !isV001) {
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

        // Use API data for daoHicIndividualVotes if available, otherwise fetch via RPC
        let daoHicIndividualVotes: Record<string, string> = round.daoHicIndividualVotes || {};
        if (Object.keys(daoHicIndividualVotes).length === 0 && Array.isArray(daoHicVoters) && daoHicVoters.length > 0) {
          // Fallback: fetch individual votes via RPC
          const votePromises = daoHicVoters.map(async (voter: string) => {
            try {
              const vote = await contract.daoHicVoteOf(voter);
              if (vote && vote !== ethers.ZeroAddress) {
                daoHicIndividualVotes[voter] = vote;
              }
            } catch {
              // Voter may not have voted yet or function not available
            }
          });
          await Promise.all(votePromises);
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
          daoHicIndividualVotes,
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
          daoHicIndividualVotes: {},
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
