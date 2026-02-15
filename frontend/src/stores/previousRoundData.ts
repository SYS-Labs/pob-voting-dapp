import { writable, get } from 'svelte/store';
import { ethers } from 'ethers';
import type { PreviousRound, ProjectMetadata } from '~/interfaces';
import { loadBadgesFromContract, type Badge } from '~/utils/loadBadgesFromContract';
import { batchGetProjectMetadataCIDs } from '~/utils/registry';
import { resolveAdapter } from '~/utils/adapterResolver';
import { metadataAPI } from '~/utils/metadata-api';

// Entity IDs for IVersionAdapter
const ENTITY_SMT = 0;
const ENTITY_DAO_HIC = 1;

export interface RoundData {
  startTime: number | null;
  endTime: number | null;
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { smt: string | null; daoHic: string | null; community: string | null };
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

/**
 * Creates a Svelte store for loading previous round data.
 * Returns an object with `loading` and `roundData` writable stores.
 * The data is loaded once when isExpanded becomes true (and roundData is still null).
 */
export function createPreviousRoundDataStore(
  round: PreviousRound,
  chainId: number,
  iterationId: number,
  publicProvider: any,
  isExpanded: boolean,
  walletAddress: string | null,
) {
  const loading = writable(false);
  const roundData = writable<RoundData | null>(null);

  // Check if API provided full round data (entityVotes, winner, projects, daoHicIndividualVotes)
  const hasAPIData = Boolean(
    round.entityVotes &&
    round.winner &&
    round.projects &&
    round.projects.length > 0
  );

  // Trigger load if conditions are met (equivalent to useEffect)
  if (isExpanded && get(roundData) === null && publicProvider) {
    const loadRoundData = async () => {
      loading.set(true);
      try {
        // Resolve adapter for this previous round
        const adapterConfig = await resolveAdapter(chainId, iterationId, round.round, publicProvider);
        if (!adapterConfig) {
          console.error(`[previousRoundData] Failed to resolve adapter for round ${round.round}`);
          loading.set(false);
          return;
        }
        const { adapter, jurySC } = adapterConfig;

        console.log(`[previousRoundData] Loading data for Round #${round.round}`, {
          jurySC,
          pob: round.pob,
          version: round.version,
          walletAddress,
          hasAPIData,
        });

        // If API provided full data, use it instead of fetching via RPC
        if (hasAPIData) {
          console.log(`[previousRoundData] Round #${round.round}: Using API data (skipping RPC calls)`);

          // Only fetch user-specific data that API doesn't provide
          const [userBadges, startTime, endTime] = await Promise.all([
            walletAddress
              ? loadBadgesFromContract(round.pob, chainId, walletAddress, publicProvider, round.deployBlockHint, round.round)
              : Promise.resolve([]),
            adapter.startTime(jurySC).catch(() => 0),
            adapter.endTime(jurySC).catch(() => 0),
          ]);

          // Check if user can mint a badge (via adapter — version-agnostic)
          let canMint = false;
          if (walletAddress && userBadges.length === 0) {
            const walletLower = walletAddress.toLowerCase();
            const [smtVoters, daoHicVoters, isRegisteredProject] = await Promise.all([
              adapter.getEntityVoters(jurySC, ENTITY_SMT).catch(() => [] as string[]),
              adapter.getEntityVoters(jurySC, ENTITY_DAO_HIC).catch(() => [] as string[]),
              adapter.isRegisteredProject(jurySC, walletAddress).catch(() => false),
            ]);
            const isSmt = Array.isArray(smtVoters) && smtVoters.some((v: string) => v.toLowerCase() === walletLower);
            const isDaoHic = Array.isArray(daoHicVoters) && daoHicVoters.some((v: string) => v.toLowerCase() === walletLower);
            canMint = isSmt || isDaoHic || Boolean(isRegisteredProject);
          }

          // Build projects array from API data (cast metadata type)
          const projects = round.projects!.map((p, index) => ({
            id: index + 1,
            address: p.address,
            metadata: p.metadata as unknown as ProjectMetadata | undefined,
          }));

          // Use votingMode from API data
          const votingMode = round.votingMode ?? 0;

          // Load project scores if in weighted mode (need RPC for this)
          let projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null = null;
          if (votingMode === 1) {
            try {
              const [addresses, scores, totalPossible] = await adapter.getWinnerWithScores(jurySC);
              projectScores = {
                addresses: addresses as string[],
                scores: (scores as bigint[]).map(s => s.toString()),
                totalPossible: (totalPossible as bigint).toString(),
              };
            } catch (error) {
              console.log('[previousRoundData] getWinnerWithScores not available or failed:', error);
            }
          }

          const data: RoundData = {
            startTime: Number(startTime) || null,
            endTime: Number(endTime) || null,
            winner: round.winner!,
            entityVotes: {
              smt: round.entityVotes?.smt ?? (round.entityVotes as any)?.devRel ?? null,
              daoHic: round.entityVotes?.daoHic ?? null,
              community: round.entityVotes?.community ?? null,
            },
            daoHicIndividualVotes: round.daoHicIndividualVotes || {},
            userBadges,
            canMint,
            votingMode,
            projects,
            projectScores,
          };

          console.log(`[previousRoundData] Loaded data for Round #${round.round} (from API)`, data);
          roundData.set(data);
          return;
        }

        // Fallback: fetch all data via RPC (API didn't provide full data)
        console.log(`[previousRoundData] Round #${round.round}: Falling back to RPC (no API data)`);

        // Adapter handles voting mode uniformly — overrides are resolved on-chain via PoBRegistry
        const votingMode = Number(await adapter.votingMode(jurySC).catch(() => 0));
        const winnerRaw: [string, boolean] = votingMode === 0
          ? await adapter.getWinnerConsensus(jurySC).catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean]
          : await adapter.getWinnerWeighted(jurySC).catch(() => [ethers.ZeroAddress, false] as [string, boolean]) as [string, boolean];
        console.log(`[previousRoundData] Round #${round.round}: adapter votingMode(): ${votingMode}`);

        // Load contract data and badges via adapter (version-agnostic)
        const [
          smtRaw, daoHicRaw, communityRaw,
          startTime, endTime,
          userBadges,
          smtVoters, daoHicVoters, isRegisteredProject
        ] = await Promise.all([
          adapter.getEntityVote(jurySC, ENTITY_SMT).catch(() => ethers.ZeroAddress),
          adapter.getEntityVote(jurySC, ENTITY_DAO_HIC).catch(() => ethers.ZeroAddress),
          adapter.getCommunityEntityVote(jurySC).catch(() => ethers.ZeroAddress),
          adapter.startTime(jurySC).catch(() => 0),
          adapter.endTime(jurySC).catch(() => 0),
          walletAddress
            ? loadBadgesFromContract(round.pob, chainId, walletAddress, publicProvider, round.deployBlockHint, round.round)
            : Promise.resolve([]),
          adapter.getEntityVoters(jurySC, ENTITY_SMT).catch(() => [] as string[]),
          adapter.getEntityVoters(jurySC, ENTITY_DAO_HIC).catch(() => [] as string[]),
          walletAddress ? adapter.isRegisteredProject(jurySC, walletAddress).catch(() => false) : Promise.resolve(false),
        ]);

        const [winnerAddressRaw, hasWinnerRaw] = Array.isArray(winnerRaw)
          ? winnerRaw
          : [ethers.ZeroAddress, false];

        // Load project addresses via adapter
        const projectAddresses: string[] = await adapter.getProjectAddresses(jurySC).catch(() => [] as string[]);

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
            console.warn(`[previousRoundData] Failed to load project metadata for Round #${round.round}:`, err);
          }
        }

        // Build projects array with metadata
        const projects = projectAddresses.map((addr, index) => ({
          id: index + 1,
          address: addr as string,
          metadata: metadataMap[addr.toLowerCase()],
        }));

        // Load project scores if in weighted mode (adapter handles version differences)
        let projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null = null;
        if (votingMode === 1) {
          try {
            const [addresses, scores, totalPossible] = await adapter.getWinnerWithScores(jurySC);
            projectScores = {
              addresses: addresses as string[],
              scores: (scores as bigint[]).map(s => s.toString()),
              totalPossible: (totalPossible as bigint).toString(),
            };
          } catch (error) {
            console.log('[previousRoundData] getWinnerWithScores not available or failed:', error);
          }
        }

        // Check if user can mint a badge (via adapter — version-agnostic)
        let canMint = false;
        if (walletAddress && userBadges.length === 0) {
          const walletLower = walletAddress.toLowerCase();
          const isSmt = Array.isArray(smtVoters) && smtVoters.some((v: string) => v.toLowerCase() === walletLower);
          const isDaoHic = Array.isArray(daoHicVoters) && daoHicVoters.some((v: string) => v.toLowerCase() === walletLower);
          canMint = isSmt || isDaoHic || Boolean(isRegisteredProject);
        }

        // Use API data for daoHicIndividualVotes if available, otherwise fetch via RPC
        let daoHicIndividualVotes: Record<string, string> = round.daoHicIndividualVotes || {};
        if (Object.keys(daoHicIndividualVotes).length === 0 && Array.isArray(daoHicVoters) && daoHicVoters.length > 0) {
          // Fallback: fetch individual votes via RPC (daoHicVoteOf is the same across all versions)
          const votePromises = daoHicVoters.map(async (voter: string) => {
            try {
              const vote = await adapter.entityVoteOf(jurySC, ENTITY_DAO_HIC, voter);
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
            smt: normalizeAddress(smtRaw),
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

        console.log(`[previousRoundData] Loaded data for Round #${round.round} (from RPC)`, data);
        roundData.set(data);
      } catch (error) {
        console.error(`[previousRoundData] Failed to load data for Round #${round.round}`, error);
        // Set empty data on error to show something instead of "No data available"
        roundData.set({
          startTime: null,
          endTime: null,
          winner: { projectAddress: null, hasWinner: false },
          entityVotes: { smt: null, daoHic: null, community: null },
          daoHicIndividualVotes: {},
          userBadges: [],
          canMint: false,
          votingMode: 0,
          projects: [],
          projectScores: null,
        });
      } finally {
        loading.set(false);
      }
    };

    void loadRoundData();
  }

  return { loading, roundData, destroy: () => {} };
}
