import { BrowserProvider, JsonRpcProvider, Network } from 'ethers';
import { NETWORKS } from '~/constants/networks';

export function createProviderWithoutENS(ethereum: any, chainId: number): BrowserProvider {
  // Create a custom network without ENS - explicitly disable ENS by not providing plugins
  const network = Network.from({
    name: 'custom',
    chainId: chainId,
  });
  const provider = new BrowserProvider(ethereum, network);
  return provider;
}

/**
 * Get a public RPC provider for read-only operations
 * @param chainId - The chain ID to connect to
 * @returns A JsonRpcProvider or null if chainId is not supported
 */
export function getPublicProvider(chainId: number): JsonRpcProvider | null {
  const network = NETWORKS[chainId];
  if (!network) {
    console.warn(`[getPublicProvider] No network config for chain ID ${chainId}`);
    return null;
  }

  return new JsonRpcProvider(network.rpcUrl, chainId, { staticNetwork: true });
}
