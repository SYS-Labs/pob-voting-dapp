/**
 * Network configuration constants
 *
 * Single source of truth for chain IDs, RPC URLs, and registry addresses.
 */

export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  registryAddress: string;
  certNFTAddress: string;
}

export const NETWORKS: Record<number, NetworkConfig> = {
  57: {
    name: 'NEVM Mainnet',
    rpcUrl: 'https://rpc.syscoin.org',
    registryAddress: '', // TODO: Deploy and update
    certNFTAddress: ''   // TODO: Deploy and update
  },
  5700: {
    name: 'NEVM Testnet',
    rpcUrl: 'https://rpc.tanenbaum.io',
    registryAddress: '0xA985cE400afea8eEf107c24d879c8c777ece1a8a',
    certNFTAddress: ''   // TODO: Deploy and update
  },
  31337: {
    name: 'Hardhat',
    rpcUrl: 'http://localhost:8547',
    registryAddress: process.env.REGISTRY_CONTRACT_ADDRESS || '0xab180957A96821e90C0114292DDAfa9E9B050d65',
    certNFTAddress: process.env.CERT_NFT_CONTRACT_ADDRESS || ''
  }
};

/**
 * Get RPC URL for a chain ID
 */
export function getRpcUrl(chainId: number): string | undefined {
  return NETWORKS[chainId]?.rpcUrl;
}

/**
 * Get all supported chain IDs
 */
export function getSupportedChainIds(): number[] {
  return Object.keys(NETWORKS).map(Number);
}
