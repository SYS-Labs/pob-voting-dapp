export const SYS_COIN_ID = 57;
export const SYS_TESTNET_ID = 5700;
export const HARDHAT_ID = 31337;

const hardhatRpcUrl = import.meta.env.VITE_HARDHAT_RPC_URL || 'http://hardhat.local:8547';

interface NetworkConfig {
  name: string;
  rpcUrl: string;
  tokenSymbol: string;
  explorerUrl?: string;
}

export const NETWORKS: Record<number, NetworkConfig> = {
  57: {
    name: 'NEVM Mainnet',
    rpcUrl: 'https://rpc.syscoin.org',
    tokenSymbol: 'SYS',
    explorerUrl: 'https://explorer.syscoin.org',
  },
  5700: {
    name: 'NEVM Testnet',
    rpcUrl: 'https://rpc.tanenbaum.io',
    tokenSymbol: 'TSYS',
    explorerUrl: 'https://explorer.tanenbaum.io',
  },
  31337: {
    name: 'Hardhat',
    rpcUrl: hardhatRpcUrl,
    tokenSymbol: 'TSYS',
    explorerUrl: 'https://example.com',
  },
};
