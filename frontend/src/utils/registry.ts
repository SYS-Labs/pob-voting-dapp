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
  5700: '0xA985cE400afea8eEf107c24d879c8c777ece1a8a', // Testnet
  31337: '0xab180957A96821e90C0114292DDAfa9E9B050d65' // Hardhat - Latest deployment
};

// Cached registry contract instances keyed by "chainId:providerUid"
const registryContractCache = new Map<string, Contract>();

/**
 * Get PoBRegistry contract instance (cached per chainId+provider)
 */
export function getPoBRegistryContract(chainId: number, provider: Provider): Contract | null {
  const address = REGISTRY_ADDRESSES[chainId];
  if (!address) {
    return null;
  }

  // Use chainId as cache key — provider instances are already cached per chainId
  const cacheKey = `${chainId}`;
  const cached = registryContractCache.get(cacheKey);
  if (cached) return cached;

  const contract = new Contract(address, PoBRegistryABI, provider);
  registryContractCache.set(cacheKey, contract);
  return contract;
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

