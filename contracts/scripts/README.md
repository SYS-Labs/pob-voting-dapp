# Contract Scripts

This directory contains scripts for deploying and managing the Proof-of-Builders smart contracts.

## Scripts

### `deploy.js`

Deploys the PoB_01 and JurySC_01 contracts to the specified network.

**Usage:**
```bash
npx hardhat run scripts/deploy.js --network <network>
```

**Environment Variables:**
- `POB_ITERATION`: Iteration number (default: 1)
- `POB_NAME`: NFT collection name (default: "Proof of Builders v1")
- `POB_SYMBOL`: NFT symbol (default: "POB1")
- `JURY_OWNER`: Admin account for JurySC (default: deployer)

**What it does:**
1. Deploys PoB_01 NFT contract
2. Deploys JurySC_01 UUPS proxy
3. Transfers PoB_01 ownership to JurySC_01
4. For local networks: Updates `frontend/public/iterations.local.json`
5. For local networks: Automatically updates frontend ABIs

**Example:**
```bash
# Deploy to localhost
npx hardhat run scripts/deploy.js --network localhost

# Deploy to testnet with custom iteration
POB_ITERATION=2 npx hardhat run scripts/deploy.js --network testnet
```

### `seed-local.js`

Seeds a local/testnet deployment with test data (projects, voters, funding).

**Usage:**
```bash
npx hardhat run scripts/seed-local.js --network localhost
```

**Environment Variables:**
- `JURY_ADDRESS`: JurySC contract address (or reads from manifest)
- `POB_ADDRESS`: PoB contract address (or reads from manifest)
- `POB_PROJECTS`: Comma-separated project addresses
- `POB_DAO_HIC_VOTERS`: Comma-separated DAO_HIC voter addresses
- `POB_DEVREL_ACCOUNT`: DevRel account address
- `POB_COMMUNITY_ACCOUNTS`: Comma-separated community addresses

**What it does:**
1. Configures DevRel account
2. Registers DAO_HIC voters
3. Registers projects
4. Funds all accounts with 1 ETH each

### `update-abis.js`

Extracts ABIs from compiled contracts and copies them to the frontend.

**Usage:**
```bash
# Compile contracts first
npx hardhat compile

# Update ABIs
node scripts/update-abis.js
```

**What it does:**
1. Reads compiled artifacts from `/tmp/syscoin-hardhat-artifacts`
2. Extracts ABIs for JurySC_01 and PoB_01
3. Saves ABIs to `frontend/src/abis/JurySC_01.json` and `PoB_01.json`
4. Extracts all custom errors from ABIs
5. Generates `frontend/src/abis/errors.json` with error mappings

**Output:**
- `frontend/src/abis/JurySC_01.json` - JurySC contract ABI
- `frontend/src/abis/PoB_01.json` - PoB contract ABI
- `frontend/src/abis/errors.json` - Error mappings for both contracts

## Complete Deployment Workflow

### Local Development

```bash
# 1. Start local Hardhat node
npx hardhat node

# 2. In another terminal, deploy contracts (auto-updates ABIs)
npx hardhat run scripts/deploy.js --network localhost

# 3. Seed with test data
npx hardhat run scripts/seed-local.js --network localhost

# 4. Start frontend
cd ../frontend
npm run dev
```

### Testnet/Mainnet

```bash
# 1. Set environment variables
export OWNER_PRIVATE_KEY="your-private-key"
export POB_ITERATION="1"
export JURY_OWNER="0x..."

# 2. Compile contracts
npx hardhat compile

# 3. Deploy
npx hardhat run scripts/deploy.js --network testnet

# 4. Manually update ABIs (not automatic on non-local networks)
node scripts/update-abis.js

# 5. Update frontend iterations.json with deployed addresses
# (edit frontend/public/iterations.json manually)
```

## Frontend Integration

### Using ABIs

The ABIs are automatically imported in the frontend:

```typescript
import { JurySC_01ABI, PoB_01ABI } from './abis';
```

### Using Error Mappings

The error utilities help decode contract errors:

```typescript
import { formatContractError, getErrorMessage, isContractError } from '@/utils/errors';

// In a try/catch block
try {
  await contract.vote(projectId);
} catch (error) {
  const { title, message, technical } = formatContractError(error);
  console.error(title, message);

  // Or check for specific errors
  if (isContractError(error, 'AlreadyVoted')) {
    console.log('User already voted!');
  }
}
```

### Available Error Utilities

- `parseContractError(error)` - Extract error name from exception
- `getErrorMessage(errorName)` - Get user-friendly message
- `formatContractError(error)` - Format for display
- `isContractError(error, name)` - Check for specific error
- `getContractErrors(contract)` - Get all errors for a contract

## Troubleshooting

### ABIs not updating

```bash
# Manually run the update script
node scripts/update-abis.js
```

### "Artifact not found" error

Make sure contracts are compiled first:
```bash
npx hardhat compile
node scripts/update-abis.js
```

### Wrong contract addresses in frontend

Update the iterations manifest:
- Local: `frontend/public/iterations.local.json` (auto-generated)
- Other networks: `frontend/public/iterations.json` (manual)
