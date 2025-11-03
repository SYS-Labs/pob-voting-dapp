export const SYS_COIN_ID = 57;
export const SYS_TESTNET_ID = 5700;
export const HARDHAT_ID = 31337;

interface NetworkConfig {
  name: string;
  rpcUrl: string;
  tokenSymbol: string;
  mintAmount: string;
  explorerUrl?: string;
}

export const NETWORKS: Record<number, NetworkConfig> = {
  57: {
    name: 'NEVM Mainnet',
    rpcUrl: 'https://rpc.syscoin.org',
    tokenSymbol: 'SYS',
    mintAmount: '100',
    explorerUrl: 'https://explorer.syscoin.org',
  },
  5700: {
    name: 'NEVM Testnet',
    rpcUrl: 'https://rpc.tanenbaum.io',
    tokenSymbol: 'TSYS',
    mintAmount: '30',
    explorerUrl: 'https://explorer.tanenbaum.io',
  },
  31337: {
    name: 'Hardhat',
    rpcUrl: 'http://hardhat.local:8547',
    tokenSymbol: 'TSYS',
    mintAmount: '30',
  },
};
