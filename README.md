# Proof-of-Builders Voting dApp

A decentralized voting system built on Syscoin NEVM and zkSYS where users become jurors to evaluate and vote on blockchain projects.

## Overview

PoB dApp is a transparent, on-chain voting platform that brings together three key stakeholders—**DevRel**, **DAO-HIC**, and **Community members**—to evaluate and vote on blockchain projects.

Each voting cycle, called an **iteration**, runs for exactly 48 hours. During this time, participants mint PoB NFTs (ERC-721 tokens) that grant them voting rights. The system supports two voting modes: **CONSENSUS** mode (requiring 2 out of 3 entity groups to agree) and **WEIGHTED** mode (proportional scoring where every vote contributes to the final result).

## Features

- **Dual Voting Modes**: Choose between CONSENSUS (2-of-3 entity majority) or WEIGHTED (proportional scoring)
- **Three-Entity Model**: DevRel, DAO-HIC, and Community each carry equal weight (1/3 per entity)
- **Time-Bound Voting**: Fixed 48-hour voting windows for each iteration
- **NFT-Based Participation**: ERC-721 tokens represent voting rights and earned achievements
- **Economic Incentive**: Community members lock SYS to vote, reclaimable after voting ends
- **Multi-Network Support**: Works on Syscoin NEVM, zkSYS and local Hardhat networks
- **Upgradeable Smart Contracts**: UUPS proxy pattern for iterative improvements
- **Optimized RPC Calls**: Block-height-based caching reduces RPC usage by ~80%
- **Transparent Results**: All voting data permanently stored on-chain

## Architecture

### Smart Contract Design

Each iteration deploys two contracts:

1. **PoB** (NFT Contract)
   - Immutable ERC-721 contract
   - Tracks voter roles (Community/DevRel/DAO-HIC/Project)
   - One contract per iteration

2. **JurySC** (Voting Contract)
   - Upgradeable via UUPS proxy
   - Manages voting lifecycle, project submissions, and results
   - One contract per iteration

**Bidirectional Relationship:**
```
PoB ←→ JurySC
  ↓           ↓
Owner      References
```

- JurySC owns PoB and can authorize minting
- PoB checks JurySC's state before allowing mints

### Frontend Architecture

- **React 18** with TypeScript and Vite
- **ethers.js v6** for blockchain interactions
- Custom hooks for state management (no Redux/Zustand)
- Lazy loading: only fetches data needed for current page
- Block-height-based caching with in-flight request deduplication

## JurySC: The Voting Engine

The **JurySC** (Jury Smart Contract) is the core voting engine of Proof-of-Builders. It orchestrates the entire voting lifecycle and ensures fair, transparent consensus.

### Contract Lifecycle

JurySC progresses through five distinct states:

1. **Deployed** → Initial state; owner configures projects and settings
2. **Activated** → `activate()` called; 48-hour countdown begins
3. **Voting Active** → Between `startTime` and `endTime`; users can vote
4. **Voting Ended** → Voting period closed (automatically or manually)
5. **Locked** → `lockContractForHistory()` called; permanent read-only archive

### Voting Mechanism

#### Three Voting Entities

| Entity | Weight | Participants | NFT Minting |
|--------|--------|--------------|-------------|
| **DevRel** | 1 | Single designated account | Free (after voting ends) |
| **DAO-HIC** | 1 | Multiple authorized voters | Free (after voting ends) |
| **Community** | 1 | Anyone (locks 30 SYS) | During voting (refundable) |

#### Dual Voting Modes

JurySC supports **two voting modes** that can be set before activation:

##### 1. CONSENSUS Mode (Default)

The classic 2-out-of-3 entity majority model:

- **Winner Requirement**: At least **2 out of 3** entities must vote for the same project
- Each entity = 1 weight (regardless of internal voter count)
- Entity votes determined by internal majority:
  - **DevRel**: Single account votes directly for the entity
  - **DAO-HIC**: Majority of DAO-HIC voters determines entity vote
  - **Community**: Majority of community NFT votes determines entity vote
- If no project reaches 2+ entities → "No winner" result

**Example:**
```
Project A: DevRel ✓, DAO-HIC ✓, Community ✗ → Winner (2/3)
Project B: DevRel ✗, DAO-HIC ✗, Community ✓ → Not winner (1/3)
```

##### 2. WEIGHTED Mode

Proportional scoring system where votes within each entity are weighted:

- Each entity contributes **1/3 of total weight** (ENTITY_WEIGHT = 1e18 / 3)
- **DevRel**: Binary vote (all 1/3 weight to chosen project or nothing)
- **DAO-HIC**: Proportional distribution
  - Each project receives: `(project_votes / total_dao_votes) × 1/3`
  - If DAO-HIC has 10 voters and 6 vote for Project A: A gets `6/10 × 1/3 = 0.2`
- **Community**: Proportional distribution
  - Each project receives: `(project_votes / total_community_votes) × 1/3`
  - If 100 community votes and 40 for Project A: A gets `40/100 × 1/3 ≈ 0.133`
- Winner = project with **highest total score** (sum across all entities)
- Ties result in "No winner"

**Example:**
```
Project A scores:
  DevRel: 0.333 (full 1/3)
  DAO-HIC: 0.200 (6/10 of 1/3)
  Community: 0.133 (40/100 of 1/3)
  Total: 0.666 → Winner

Project B scores:
  DevRel: 0 (didn't vote)
  DAO-HIC: 0.133 (4/10 of 1/3)
  Community: 0.200 (60/100 of 1/3)
  Total: 0.333 → Not winner
```

**Comparison:**

| Feature | CONSENSUS Mode | WEIGHTED Mode |
|---------|----------------|---------------|
| **Winner Logic** | 2+ entities agree | Highest cumulative score |
| **Internal Votes** | Only majority matters | Every vote contributes proportionally |
| **Minimum Entities** | 2 required | 1 sufficient (if has votes) |
| **Sensitivity** | Binary (win/lose per entity) | Granular (fractional scores) |
| **Best For** | Clear mandate requirement | Fine-grained preference aggregation |

**Setting the Mode:**

The voting mode can be set by the contract owner before activation. Once voting starts, the mode cannot be changed.

### Voter List Freeze

The community voter list automatically freezes when voting ends:
- `PoB.mint()` checks `jury.isActive()` before allowing mints
- Once `isActive()` returns `false`, no new Community NFTs can be minted
- Existing NFT holders can still claim their deposit

### Security Features

- **Reentrancy Guards**: All payable functions protected
- **Access Control**: Role-based permissions (Owner, DevRel, DAO-HIC)
- **Checks-Effects-Interactions**: Follows best practices for state changes
- **Immutable References**: PoB address cannot be changed after deployment
- **Emergency Controls**: Manual close and lock functions for edge cases

### Upgradeability

JurySC uses the **UUPS (Universal Upgradeable Proxy Standard)** pattern:
- Proxy contract holds state and delegates to implementation
- Upgrades controlled by contract owner
- `_authorizeUpgrade()` restricts upgrade permissions
- Storage layout must be preserved across upgrades

**Note:** PoB NFT contracts are **NOT upgradeable** to ensure NFT metadata immutability.

## Tech Stack

### Frontend
- React 18 + TypeScript + Vite
- ethers.js v6
- CSS with CSS variables
- Custom React hooks

### Smart Contracts
- Solidity ^0.8.20
- Hardhat
- OpenZeppelin Contracts (Upgradeable)
- UUPS Proxy Pattern

### Blockchain
- **Mainnet**: Syscoin NEVM Mainnet (Chain ID: 57)
- **Testnet**: Syscoin NEVM Testnet (Chain ID: 5700)
- **Local**: Hardhat Network (Chain ID: 31337)

## Project Structure

```
proof-of-builders-v1/
├── contracts/              # Smart contracts
│   ├── contracts/
│   │   ├── JurySC.sol
│   │   └── PoB.sol
│   ├── scripts/           # Deployment and utility scripts
│   ├── test/              # Contract tests
│   └── hardhat.config.js
│
└── frontend/              # React frontend
    ├── src/
    │   ├── abis/         # Contract ABIs
    │   ├── components/   # React components
    │   ├── hooks/        # Custom hooks
    │   ├── pages/        # Page components
    │   ├── utils/        # Utilities (caching, batching)
    │   └── constants/    # Network configs
    └── public/
        └── metadata/     # Project metadata
```

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- MetaMask or compatible Web3 wallet

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/syscoin/proof-of-builders-v1.git
   cd proof-of-builders-v1
   ```

2. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   ```

3. **Install contract dependencies**
   ```bash
   cd ../contracts
   npm install
   ```

### Running Locally

#### Start Hardhat Node
```bash
cd contracts
npx hardhat node
# Runs on http://localhost:8545 (Chain ID: 31337)
```

#### Deploy Contracts Locally
```bash
npx hardhat run scripts/deploy-local.js --network localhost
```

#### Start Frontend Development Server
```bash
cd ../frontend
npm run dev
# Opens on http://localhost:5173
```

## Deployment

### Deploy to Testnet (Syscoin Tanenbaum)

```bash
cd contracts
npx hardhat run scripts/deploy-testnet.js --network testnet
```

### Deploy to Mainnet (Syscoin NEVM)

```bash
cd contracts
npx hardhat run scripts/deploy-mainnet.js --network mainnet
```

### Post-Deployment

After deployment, update `frontend/src/constants/iterations.json` with the new contract addresses.

## Testing

### Run Smart Contract Tests
```bash
cd contracts
npx hardhat test
```

### Check Voting Results
```bash
# Testnet (iteration 1)
CHAIN_ID=5700 ITERATION=1 node scripts/check-votes.js

# Mainnet (iteration 1)
CHAIN_ID=57 ITERATION=1 node scripts/check-votes.js

# Local network
CHAIN_ID=31337 ITERATION=1 node scripts/check-votes.js
```

## Usage

### For Community Members

1. Connect your wallet to Syscoin NEVM
2. Navigate to an active iteration
3. Lock 30 SYS to mint a PoB NFT
4. Cast your vote for a project
5. Reclaim your 30 SYS after voting ends

### For DevRel / DAO-HIC

1. Get authorized by the iteration owner
2. Connect your wallet during active voting
3. Mint your NFT (free) after voting ends
4. Your vote contributes to entity consensus

### For Iteration Owners

1. Deploy PoB and JurySC contracts
2. Configure projects, DevRel, and DAO-HIC voters
3. Call `activate()` to start the 48-hour window
4. Monitor votes and results
5. Lock the contract for historical record

## Configuration

### Network Configuration

Edit `frontend/src/constants/networks.ts` to customize RPC endpoints:

```typescript
export const NETWORKS = {
  57: { name: 'Syscoin NEVM', rpc: 'https://rpc.syscoin.org' },
  5700: { name: 'Syscoin Tanenbaum', rpc: 'https://rpc.tanenbaum.io' }
};
```

### Enable Testnet Support

Set environment variable:
```bash
VITE_ENABLE_TESTNET=true npm run dev
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Built By

**Syscoin Team**

The Proof-of-Builders program is an innitiative of the Syscoin Marketing and Management Team (SMT) as part of our commitment to decentralized governance and community-driven development.

- Website: [syscoin.org](https://syscoin.org)
- Documentation: [docs.syscoin.org](https://docs.syscoin.org)
- Twitter: [@syscoin](https://x.com/syscoin)
- Discord: [discord.gg/syscoin](https://discord.gg/syscoin)

---

**Note**: This project is in active development. For issues, feature requests, or contributions, please open an issue on GitHub.
