/**
 * Adapter Resolution Layer
 *
 * Resolves IVersionAdapter contracts via PoBRegistry.getAdapterConfig().
 * Caches results indefinitely since adapter assignments are immutable.
 */

import { Contract, type Provider } from 'ethers';
import { IVersionAdapterABI } from '~/abis';
import { getPoBRegistryContract } from './registry';

// ============================================================================
// Types
// ============================================================================

export interface AdapterConfig {
  jurySC: string;
  adapterAddress: string;
  adapter: Contract;
}

// ============================================================================
// Cache
// ============================================================================

// Adapter resolution is immutable once set, so cache indefinitely
const adapterCache = new Map<string, AdapterConfig>();

// Adapter Contract instances cached by address (reused across rounds using same adapter)
const adapterContractCache = new Map<string, Contract>();

function getCacheKey(chainId: number, iterationId: number, roundId: number): string {
  return `${chainId}:${iterationId}:${roundId}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get or create an IVersionAdapter Contract instance for a given adapter address.
 */
function getAdapterContract(adapterAddress: string, provider: Provider): Contract {
  const cached = adapterContractCache.get(adapterAddress);
  if (cached) return cached;

  const contract = new Contract(adapterAddress, IVersionAdapterABI, provider);
  adapterContractCache.set(adapterAddress, contract);
  return contract;
}

/**
 * Resolve the adapter for a specific iteration/round via PoBRegistry.
 *
 * Returns { jurySC, adapterAddress, adapter } or null if resolution fails
 * (e.g., registry not deployed on chain, round not configured).
 *
 * Results are cached indefinitely per (chainId, iterationId, roundId).
 */
export async function resolveAdapter(
  chainId: number,
  iterationId: number,
  roundId: number,
  provider: Provider
): Promise<AdapterConfig | null> {
  const key = getCacheKey(chainId, iterationId, roundId);

  const cached = adapterCache.get(key);
  if (cached) return cached;

  try {
    const registry = getPoBRegistryContract(chainId, provider);
    if (!registry) {
      console.error(`[adapterResolver] No PoBRegistry for chainId ${chainId}`);
      return null;
    }

    const [jurySC, adapterAddress] = await registry.getAdapterConfig(iterationId, roundId);

    const adapter = getAdapterContract(adapterAddress, provider);
    const config: AdapterConfig = { jurySC, adapterAddress, adapter };
    adapterCache.set(key, config);

    console.log(`[adapterResolver] Resolved adapter for iteration ${iterationId} round ${roundId}: adapter=${adapterAddress}`);
    return config;
  } catch (error) {
    console.error(`[adapterResolver] Failed to resolve adapter for iteration ${iterationId} round ${roundId}:`, error);
    return null;
  }
}
