import { useState, useEffect } from 'react';
import { Contract, ethers } from 'ethers';
import type { PreviousRound } from '~/interfaces';
import { JurySC_01ABI } from '~/abis';
import { cachedPromiseAll } from '~/utils/cachedPromiseAll';

interface RoundData {
  startTime: number | null;
  endTime: number | null;
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
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
        });

        // Reuse the same pattern from useContractState
        const [devRelRaw, daoHicRaw, communityRaw, winnerRaw, startTime, endTime] = await cachedPromiseAll(
          publicProvider,
          chainId,
          [
            { key: `prevRound:${round.round}:getDevRelEntityVote`, promise: contract.getDevRelEntityVote().catch(() => ethers.ZeroAddress) },
            { key: `prevRound:${round.round}:getDaoHicEntityVote`, promise: contract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress) },
            { key: `prevRound:${round.round}:getCommunityEntityVote`, promise: contract.getCommunityEntityVote().catch(() => ethers.ZeroAddress) },
            { key: `prevRound:${round.round}:getWinner`, promise: contract.getWinner().catch(() => [ethers.ZeroAddress, false] as [string, boolean]) },
            { key: `prevRound:${round.round}:startTime`, promise: contract.startTime().catch(() => 0) },
            { key: `prevRound:${round.round}:endTime`, promise: contract.endTime().catch(() => 0) },
          ],
        );

        const [winnerAddressRaw, hasWinnerRaw] = Array.isArray(winnerRaw)
          ? winnerRaw
          : [ethers.ZeroAddress, false];

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
        };

        console.log(`[usePreviousRoundData] Loaded data for Round #${round.round}`, data);
        setRoundData(data);
      } catch (error) {
        console.error(`[usePreviousRoundData] Failed to load data for Round #${round.round}`, error);
      } finally {
        setLoading(false);
      }
    };

    void loadRoundData();
  }, [isExpanded, roundData, publicProvider, round.jurySC, round.pob, round.round, chainId]);

  return { loading, roundData };
}
