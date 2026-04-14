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
    registryAddress: process.env.MAINNET_REGISTRY_CONTRACT_ADDRESS || '0xb2C3c1CB54aa9EBFe175a5fBEB63d63986D5a5E8',
    certNFTAddress: process.env.MAINNET_CERT_NFT_CONTRACT_ADDRESS || ''
  },
  5700: {
    name: 'NEVM Testnet',
    rpcUrl: 'https://rpc.tanenbaum.io',
    registryAddress: process.env.TESTNET_REGISTRY_CONTRACT_ADDRESS || '0xA985cE400afea8eEf107c24d879c8c777ece1a8a',
    certNFTAddress: process.env.TESTNET_CERT_NFT_CONTRACT_ADDRESS || ''
  },
  31337: {
    name: 'Hardhat',
    rpcUrl: 'http://localhost:8547',
    registryAddress: process.env.HARDHAT_REGISTRY_CONTRACT_ADDRESS || process.env.REGISTRY_CONTRACT_ADDRESS || '0xab180957A96821e90C0114292DDAfa9E9B050d65',
    certNFTAddress: process.env.HARDHAT_CERT_NFT_CONTRACT_ADDRESS || process.env.CERT_NFT_CONTRACT_ADDRESS || ''
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
