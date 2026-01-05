import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY?.trim();

if (!PRIVATE_KEY) {
  console.warn("[warn] PRIVATE_KEY not set in .env — deployments will fail.");
}

const HARDHAT_MNEMONIC =
  process.env.HARDHAT_MNEMONIC ||
  // default 20 accounts (same as Hardhat defaults)
  "test test test test test test test test test test test junk";

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  sourcify: {
    enabled: true
  },
  etherscan: {
    apiKey: {
      testnet: "none",
      mainnet: "none",
    },
    customChains: [
      {
        network: "testnet",
        chainId: 5700,
        urls: {
          apiURL: "https://explorer.tanenbaum.io/api",
          browserURL: "https://explorer.tanenbaum.io"
        }
      },
      {
        network: "mainnet",
        chainId: 57,
        urls: {
          apiURL: "https://explorer.syscoin.org/api",
          browserURL: "https://explorer.syscoin.org"
        }
      }
    ]
  },
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai"
    }
  },
  networks: {
    hardhat: {
      accounts: { mnemonic: HARDHAT_MNEMONIC },
      mining: {
        auto: true,       // Auto-mine transactions immediately
        interval: 2000    // Also mine empty blocks every 2 seconds
      }
    },
    localhost: {
      url: "http://127.0.0.1:8547",
      chainId: 31337,
    },
    testnet: {
      url: "https://rpc.tanenbaum.io",
      chainId: 5700,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gasPrice: "auto"
    },
    mainnet: {
      url: "https://rpc.syscoin.org",
      chainId: 57,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gasPrice: "auto"
    },
  }
};

export default config;
