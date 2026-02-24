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

### `check-votes.js`

Displays comprehensive voting progress and results for a specific iteration.

**Usage:**
```bash
# Check voting for iteration 1 on testnet
CHAIN_ID=5700 ITERATION=1 node scripts/check-votes.js

# Check specific round of an iteration
CHAIN_ID=5700 ITERATION=1 ROUND=2 node scripts/check-votes.js

# Use custom iterations file
ITERATIONS_FILE=../frontend/public/iterations.json ITERATION=1 node scripts/check-votes.js
```

**Environment Variables:**
- `CHAIN_ID`: Network chain ID (default: 5700 for Syscoin Tanenbaum)
  - `5700` - Syscoin NEVM testnet
  - `57` - Syscoin NEVM mainnet
  - `31337` - Local hardhat network
- `ITERATION`: Iteration number (default: 1)
- `ROUND`: Optional round number
  - If not specified: Uses current round (top-level in iterations.json)
  - If specified: Searches both current round and prev_rounds array
- `ITERATIONS_FILE`: Path to iterations.json (default: ../frontend/public/iterations.json)
- `PROJECTS_FILE`: Path to projects.json (default: ../frontend/public/projects.json)

**Note on Round Structure:**
- Current/active round is stored at the top level with the iteration
- Past rounds are stored in the `prev_rounds` array within the iteration
- Example: Iteration 1 with current round 2 and previous round 1 stored in `prev_rounds`

**Report Sections:**
1. **Vote Activity History** - Chronological list of all votes with timestamps
2. **Final Vote Per Voter** - Current votes for DevRel, DAO HIC members, and Community
3. **Projects by Weighted Votes** - All projects ranked by entity votes
4. **Voting Status** - Current status (Upcoming/Active/Ended) with timing info
5. **Final Outcome** - Winner based on contract's current voting mode (CONSENSUS or WEIGHTED)

**Example:**
```bash
# Check current round (top-level) of iteration 1
CHAIN_ID=5700 ITERATION=1 node scripts/check-votes.js

# Check previous round (from prev_rounds array)
CHAIN_ID=5700 ITERATION=1 ROUND=1 node scripts/check-votes.js

# Check current round on local network
CHAIN_ID=31337 ITERATION=1 node scripts/check-votes.js
```

### `upgrade.js`

Upgrades an existing JurySC_01 proxy to a new implementation (UUPS upgrade).

**Usage:**
```bash
# Validate upgrade without executing
PROXY_ADDRESS=0x1234... DRY_RUN=true npx hardhat run scripts/upgrade.js --network localhost

# Perform actual upgrade
PROXY_ADDRESS=0x1234... npx hardhat run scripts/upgrade.js --network localhost
```

**Environment Variables:**
- `PROXY_ADDRESS`: Address of existing proxy contract (required)
- `DRY_RUN`: Set to "true" to validate without upgrading (optional)

**Safety Checks:**
- ✅ Validates storage layout compatibility
- ✅ Blocks upgrade during active voting
- ✅ Blocks upgrade if contract is locked
- ✅ Preserves all votes and state

**Example:**
```bash
# Testnet upgrade
PROXY_ADDRESS=0xabcd... npx hardhat run scripts/upgrade.js --network testnet
```

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
1. Reads compiled artifacts from `contracts/artifacts`
2. Extracts ABIs for all contracts listed in `scripts/update-abis.js`
3. Saves ABI files to `frontend/src/abis/*.json`
4. Extracts all custom errors from ABIs
5. Generates `frontend/src/abis/errors.json` with error mappings

**Output:**
- `frontend/src/abis/JurySC_01.json` - JurySC_01 ABI from current artifact output
- `frontend/src/abis/PoB_01.json` - PoB contract ABI
- `frontend/src/abis/PoB_02_v001.json` - PoB v002 ABI
- `frontend/src/abis/JurySC_02_v001.json` - JurySC_02 ABI
- `frontend/src/abis/PoBRegistry.json` - Registry ABI
- `frontend/src/abis/CertNFT.json` - Certificate NFT ABI
- `frontend/src/abis/CertGate.json` - Certificate gate ABI
- `frontend/src/abis/errors.json` - Error mappings for both contracts

**Frontend note:**
- Runtime imports use `JurySC_01_v001.json` and `JurySC_01_v002.json` via `frontend/src/abis/index.ts`, where `JurySC_01ABI` aliases `JurySC_01_v002_ABI`.
- `JurySC_01.json` is generated by this script but is not imported directly by current frontend runtime code.

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

The frontend imports ABIs from `frontend/src/abis/index.ts`:

```typescript
import { JurySC_01ABI, PoB_01ABI, JurySC_01_v001_ABI, JurySC_01_v002_ABI } from '~/abis';
```

`JurySC_01ABI` is an alias of `JurySC_01_v002_ABI` (latest version). Version-specific code paths can import `JurySC_01_v001_ABI` and `JurySC_01_v002_ABI` directly.

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
