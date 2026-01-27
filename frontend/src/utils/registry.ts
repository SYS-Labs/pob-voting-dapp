/**
 * PoBRegistry Contract Utilities
 *
 * Provides functions to query the PoBRegistry contract for metadata CIDs.
 * The registry is a single source of truth for all iteration and project metadata across all networks.
 */

import { Contract, type Provider, ethers } from 'ethers';
import PoBRegistryABI from '../abis/PoBRegistry.json';

// PoBRegistry addresses by network
export const REGISTRY_ADDRESSES: Record<number, string> = {
  57: '', // Mainnet - TODO: Deploy and update
  5700: '0xA985cE400afea8eEf107c24d879c8c777ece1a8a', // Testnet
  31337: '0xab180957A96821e90C0114292DDAfa9E9B050d65' // Hardhat - Latest deployment
};

// Hardcoded voting mode overrides for locked contracts that can't be upgraded
// These contracts have incorrect votingMode() return values but are permanently locked
// Key: jurySC address (lowercase), Value: votingMode (0=CONSENSUS, 1=WEIGHTED)
export const VOTING_MODE_OVERRIDES: Record<string, number> = {
  // Iteration 1 Round 2 (testnet) - contract locked with WEIGHTED mode but returns 0
  '0x837992ac7b89c148f7e42755816e74e84cf985ad': 1,
};

/**
 * Get PoBRegistry contract instance
 */
export function getPoBRegistryContract(chainId: number, provider: Provider): Contract | null {
  const address = REGISTRY_ADDRESSES[chainId];
  if (!address) {
    return null;
  }
  return new Contract(address, PoBRegistryABI, provider);
}

/**
 * Get iteration metadata CID from registry
 */
export async function getIterationMetadataCID(
  chainId: number,
  jurySCAddress: string,
  provider: Provider
): Promise<string | null> {
  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return null;
    }

    const cid = await registry.getIterationMetadata(chainId, jurySCAddress);
    return cid || null;
  } catch (error) {
    console.warn('Failed to get iteration metadata CID from registry', { chainId, jurySCAddress, error });
    return null;
  }
}

/**
 * Get project metadata CID from registry
 */
export async function getProjectMetadataCID(
  chainId: number,
  jurySCAddress: string,
  projectAddress: string,
  provider: Provider
): Promise<string | null> {
  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return null;
    }

    const cid = await registry.getProjectMetadata(chainId, jurySCAddress, projectAddress);
    return cid || null;
  } catch (error) {
    console.warn('Failed to get project metadata CID from registry', { chainId, jurySCAddress, projectAddress, error });
    return null;
  }
}

/**
 * Get previous round contracts for an iteration
 */
export async function getPrevRoundContracts(
  chainId: number,
  jurySCAddress: string,
  provider: Provider
): Promise<string[]> {
  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return [];
    }

    const prevRounds = await registry.getPrevRoundContracts(chainId, jurySCAddress);
    return prevRounds || [];
  } catch (error) {
    console.warn('Failed to get prev round contracts from registry', { chainId, jurySCAddress, error });
    return [];
  }
}

/**
 * Batch get project metadata CIDs from registry
 */
export async function batchGetProjectMetadataCIDs(
  chainId: number,
  jurySCAddress: string,
  projectAddresses: string[],
  provider: Provider
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (projectAddresses.length === 0) {
    return result;
  }

  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return result;
    }

    // Call batch function (max 50 at a time)
    const MAX_BATCH = 50;
    const batches: string[][] = [];

    for (let i = 0; i < projectAddresses.length; i += MAX_BATCH) {
      batches.push(projectAddresses.slice(i, i + MAX_BATCH));
    }

    for (const batch of batches) {
      const cids = await registry.batchGetProjectMetadata(chainId, jurySCAddress, batch);

      for (let i = 0; i < batch.length; i++) {
        const cid = cids[i];
        if (cid && cid.length > 0) {
          result.set(batch[i], cid);
        }
      }
    }

    return result;
  } catch (error) {
    console.warn('Failed to batch get project metadata CIDs from registry', { chainId, jurySCAddress, error });

    // Fallback to individual queries
    for (const projectAddress of projectAddresses) {
      const cid = await getProjectMetadataCID(chainId, jurySCAddress, projectAddress, provider);
      if (cid) {
        result.set(projectAddress, cid);
      }
    }

    return result;
  }
}

/**
 * Check if a project is authorized to set its own metadata
 */
export async function isProjectAuthorized(
  chainId: number,
  jurySCAddress: string,
  projectAddress: string,
  provider: Provider
): Promise<boolean> {
  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return false;
    }

    return await registry.isProjectAuthorized(chainId, jurySCAddress, projectAddress);
  } catch (error) {
    console.warn('Failed to check project authorization', { chainId, jurySCAddress, projectAddress, error });
    return false;
  }
}

/**
 * Get all iteration IDs from registry
 */
export async function getAllIterationIds(
  chainId: number,
  provider: Provider
): Promise<number[]> {
  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return [];
    }

    const ids = await registry.getAllIterationIds();
    return ids.map((id: bigint) => Number(id));
  } catch (error) {
    console.warn('Failed to get iteration IDs from registry', { chainId, error });
    return [];
  }
}

/**
 * Get iteration info by ID
 */
export async function getIterationInfo(
  iterationId: number,
  chainId: number,
  provider: Provider
): Promise<{
  iterationId: number;
  chainId: number;
  name: string;
  roundCount: number;
} | null> {
  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return null;
    }

    const info = await registry.getIteration(iterationId);
    return {
      iterationId: Number(info.iterationId),
      chainId: Number(info.chainId),
      name: info.name,
      roundCount: Number(info.roundCount),
    };
  } catch (error) {
    console.warn('Failed to get iteration info from registry', { iterationId, chainId, error });
    return null;
  }
}

/**
 * Get all rounds for an iteration
 * Note: Returns only data stored in registry (jurySC, deployBlockHint)
 * Use JurySC contract to query pob() and votingMode() if needed
 */
export async function getRounds(
  iterationId: number,
  chainId: number,
  provider: Provider
): Promise<Array<{
  iterationId: number;
  roundId: number;
  jurySC: string;
  deployBlockHint: number;
}>> {
  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      return [];
    }

    const rounds = await registry.getRounds(iterationId);
    return rounds.map((r: any) => ({
      iterationId: Number(r.iterationId),
      roundId: Number(r.roundId),
      jurySC: r.jurySC,
      deployBlockHint: Number(r.deployBlockHint),
    }));
  } catch (error) {
    console.warn('Failed to get rounds from registry', { iterationId, chainId, error });
    return [];
  }
}

/**
 * Get PoB and votingMode from a JurySC contract
 */
export async function getJurySCInfo(
  jurySCAddress: string,
  provider: Provider
): Promise<{ pob: string; votingMode: number } | null> {
  try {
    const jurySC = new ethers.Contract(
      jurySCAddress,
      ['function pob() external view returns (address)', 'function votingMode() external view returns (uint8)'],
      provider
    );

    // pob() is required, votingMode() is optional (older contracts don't have it)
    const pob = await jurySC.pob();

    let votingMode = 0;
    try {
      votingMode = Number(await jurySC.votingMode());
    } catch {
      // Older contracts don't have votingMode, default to 0 (Consensus)
    }

    // Apply override if this contract is in the override list
    const effectiveVotingMode = VOTING_MODE_OVERRIDES[jurySCAddress.toLowerCase()] ?? votingMode;

    return {
      pob,
      votingMode: effectiveVotingMode,
    };
  } catch (error) {
    console.warn('Failed to get JurySC info', { jurySCAddress, error });
    return null;
  }
}
