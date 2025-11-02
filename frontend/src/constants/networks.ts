export const SYS_COIN_ID = 57;
export const SYS_TESTNET_ID = 5700;
export const HARDHAT_ID = 31337;

export const NETWORK_NAMES: Record<number, string> = {
  57: 'NEVM Mainnet',
  5700: 'NEVM Testnet',
  31337: 'Hardhat',
};

// Public RPC endpoints for read-only operations
export const PUBLIC_RPC_URLS: Record<number, string> = {
  57: 'https://rpc.syscoin.org',
  5700: 'https://rpc.tanenbaum.io',
  31337: 'http://hardhat.local:8547',
};

// Community badge mint amount (in native token)
export const MINT_AMOUNTS: Record<number, string> = {
  57: '100', // Mainnet: 100 SYS
  5700: '30', // Testnet: 30 TSYS
  31337: '30', // Hardhat: 30 TSYS
};

// Token symbol for each network
export const TOKEN_SYMBOLS: Record<number, string> = {
  57: 'SYS', // Mainnet
  5700: 'TSYS', // Testnet
  31337: 'TSYS', // Hardhat
};
