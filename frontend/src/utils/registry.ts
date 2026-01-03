/**
 * PoBRegistry Contract Utilities
 *
 * Provides functions to query the PoBRegistry contract for metadata CIDs.
 * The registry is a single source of truth for all iteration and project metadata across all networks.
 */

import { Contract, type Provider } from 'ethers';
import PoBRegistryABI from '../abis/PoBRegistry.json';

// PoBRegistry addresses by network
export const REGISTRY_ADDRESSES: Record<number, string> = {
  57: '', // Mainnet - TODO: Deploy and update
  5700: '', // Testnet - TODO: Deploy and update
  31337: '' // Hardhat - Set by deployment script
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
