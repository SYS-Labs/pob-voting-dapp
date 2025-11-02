import { useMemo } from 'react';
import { JsonRpcProvider } from 'ethers';
import { PUBLIC_RPC_URLS } from '~/constants/networks';

/**
 * Hook that provides a public RPC provider for read-only operations
 * @param chainId - The chain ID to connect to (from current iteration or wallet)
 * @returns A JsonRpcProvider or null if chainId is not supported
 */
export function usePublicProvider(chainId: number | null): JsonRpcProvider | null {
  return useMemo(() => {
    if (chainId === null) {
      console.log('[usePublicProvider] chainId is null, returning null provider');
      return null;
    }

    const rpcUrl = PUBLIC_RPC_URLS[chainId];
    if (!rpcUrl) {
      console.warn(`[usePublicProvider] No public RPC URL for chain ID ${chainId}`);
      return null;
    }

    console.log(`[usePublicProvider] Creating public provider for chain ${chainId} with RPC URL: ${rpcUrl}`);
    const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });

    // Test the connection
    provider.getBlockNumber().then((blockNumber) => {
      console.log(`[usePublicProvider] Successfully connected to chain ${chainId}, current block: ${blockNumber}`);
    }).catch((error) => {
      console.error(`[usePublicProvider] Failed to connect to chain ${chainId}:`, error);
    });

    return provider;
  }, [chainId]);
}
