# PoBRegistry Architecture

## Overview

The **PoBRegistry** is a dedicated smart contract that serves as the single source of truth for all IPFS metadata CIDs across iterations, rounds, and projects. This design separates metadata management from core voting/NFT logic.

---

## Why PoBRegistry?

### Problem
- Old/closed contracts can't be upgraded to add IPFS CID storage
- Mixing metadata logic with voting logic violates separation of concerns
- Each contract storing its own CIDs creates fragmentation

### Solution
- Single registry contract manages all metadata CIDs
- Works with both new and old (historical) contracts
- Upgradeable via UUPS proxy pattern
- Clean separation: voting contracts focus on voting, registry focuses on metadata

---

## Contract Design

### State Variables

```solidity
// Iteration metadata
mapping(uint256 => mapping(address => string)) public iterationMetadata;
// chainId => jurySCAddress => CID

// Project metadata
mapping(uint256 => mapping(address => mapping(address => string))) public projectMetadata;
// chainId => jurySCAddress => projectAddress => CID

// Previous rounds
mapping(uint256 => mapping(address => address[])) public prevRoundContracts;
// chainId => jurySCAddress => previous round addresses

// Project authorization
mapping(uint256 => mapping(address => mapping(address => bool))) public authorizedProjects;
// chainId => jurySCAddress => projectAddress => isAuthorized
```

### Key Functions

#### Admin Functions (Owner Only)
- `setIterationMetadata(chainId, jurySC, cid)` - Set iteration metadata CID
- `setPrevRoundContracts(chainId, jurySC, prevRounds)` - Link previous rounds
- `setProjectAuthorization(chainId, jurySC, projectAddress, authorized)` - Authorize project
- `batchAuthorizeProjects(chainId, jurySC, projectAddresses)` - Batch authorize

#### Project Functions (Authorized Projects)
- `setProjectMetadata(chainId, jurySC, projectAddress, cid)` - Project sets own metadata

#### View Functions (Public)
- `getIterationMetadata(chainId, jurySC)` - Get iteration CID
- `getProjectMetadata(chainId, jurySC, projectAddress)` - Get project CID
- `getPrevRoundContracts(chainId, jurySC)` - Get previous rounds
- `isProjectAuthorized(chainId, jurySC, projectAddress)` - Check authorization
- `batchGetProjectMetadata(chainId, jurySC, projectAddresses)` - Batch get CIDs

---

## Authorization Model

### Iteration Metadata
- **Who can set**: Contract owner (admin) only
- **Rationale**: Iteration metadata is system-level data

### Project Metadata
- **Who can set**:
  1. Contract owner (admin) - can set any project metadata
  2. Authorized projects - can only set their own metadata
- **Rationale**: Projects control their own data, admin can bootstrap/fix

### Authorization Flow
```
1. Admin deploys iteration with JurySC contract
2. Admin calls registry.batchAuthorizeProjects([project1, project2, ...])
3. Projects can now call registry.setProjectMetadata() for themselves
4. Admin can always override if needed
```

---

## Data Flow

### Reading Metadata (Frontend → API → Registry → IPFS)

```
1. Frontend: Fetch project metadata
   └─> API: GET /api/metadata/project/:chainId/:jurySC/:projectAddress

2. API: Query registry contract
   └─> const cid = await registry.getProjectMetadata(chainId, jurySC, projectAddress)

3. API: Fetch from IPFS
   └─> const metadata = await ipfs.fetch(cid)

4. API: Return to frontend
   └─> return { success: true, metadata, cid }
```

### Writing Metadata (Project → API → IPFS → Registry)

```
1. Project: Submit metadata with signature
   └─> POST /api/metadata/project { metadata, signature }

2. API: Verify signature
   └─> const signer = ethers.verifyMessage(message, signature)
   └─> require(signer === projectAddress)

3. API: Upload to IPFS
   └─> const { cid } = await ipfs.uploadJSON(metadata)

4. API: Set CID on registry
   └─> const tx = await registry.setProjectMetadata(chainId, jurySC, projectAddress, cid)
   └─> Record tx in pob_metadata_events table

5. Background worker: Monitor confirmations
   └─> After 10 confirmations: unpin old CID
```

---

## Multi-Chain Support

The registry handles multiple chains in a single contract:

```solidity
// Testnet (chainId: 5700)
registry.setIterationMetadata(5700, jurySC_testnet, "QmTestnet...")

// Mainnet (chainId: 57)
registry.setIterationMetadata(57, jurySC_mainnet, "QmMainnet...")
```

**Benefits:**
- Single registry deployment per network
- Unified API across chains
- Consistent metadata access

---

## Backwards Compatibility

### For Old Contracts (Already Deployed)
```javascript
// Old contract has no IPFS fields
// Admin uploads metadata to IPFS
const { cid } = await ipfsService.uploadJSON(oldIterationMetadata);

// Admin sets CID in registry
await registry.setIterationMetadata(chainId, oldContractAddress, cid);

// Frontend queries registry (same as new contracts)
const metadata = await api.getIterationMetadata(chainId, oldContractAddress);
```

### For New Contracts (Future Deployments)
```javascript
// New contract still doesn't need IPFS fields
// Metadata is managed entirely by registry
await registry.setIterationMetadata(chainId, newContractAddress, cid);
```

**Result:** Uniform metadata access for all contracts, old and new.

---

## Event Emission

All metadata changes emit events for indexing/tracking:

```solidity
event IterationMetadataSet(
    uint256 indexed chainId,
    address indexed jurySC,
    string cid,
    address indexed setter
);

event ProjectMetadataSet(
    uint256 indexed chainId,
    address indexed jurySC,
    address indexed projectAddress,
    string cid,
    address setter
);

event PrevRoundsSet(
    uint256 indexed chainId,
    address indexed jurySC,
    address[] prevRounds
);

event ProjectAuthorized(
    uint256 indexed chainId,
    address indexed jurySC,
    address indexed projectAddress,
    bool authorized
);
```

**Use cases:**
- API can index events to track all metadata changes
- Frontend can subscribe to events for real-time updates
- Analytics can track metadata update patterns

---

## Upgradeability (UUPS)

The registry uses UUPS proxy pattern:

```solidity
contract PoBRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
```

**Benefits:**
- Can add new metadata types in future (e.g., round metadata)
- Can fix bugs without losing data
- Owner-controlled upgrades (safe)

**Upgrade process:**
```javascript
const PoBRegistryV2 = await ethers.getContractFactory('PoBRegistry');
await upgrades.upgradeProxy(registryAddress, PoBRegistryV2);
// All data preserved, new logic deployed
```

---

## Security Considerations

### 1. Authorization Checks
```solidity
function setProjectMetadata(...) external {
    bool isOwner = msg.sender == owner();
    bool isAuthorizedProject = msg.sender == projectAddress && authorizedProjects[...];

    require(isOwner || isAuthorizedProject, "Not authorized");
    // ...
}
```

### 2. Input Validation
```solidity
require(jurySC != address(0), "Invalid contract address");
require(bytes(cid).length > 0, "CID cannot be empty");
```

### 3. No Reentrancy Risks
- Pure storage contract, no external calls
- No token transfers or complex state changes

### 4. UUPS Upgrade Protection
- Only owner can upgrade
- Initializer disabled after deployment
- Implementation can't be called directly

---

## Gas Optimization

### Batch Operations
```solidity
function batchAuthorizeProjects(address[] calldata projects) external onlyOwner {
    for (uint256 i = 0; i < projects.length; i++) {
        authorizedProjects[chainId][jurySC][projects[i]] = true;
        emit ProjectAuthorized(...);
    }
}
```

### Efficient Mappings
- Nested mappings instead of arrays for O(1) lookups
- No iteration over large datasets

### Calldata vs Memory
- Use `calldata` for external function parameters (cheaper)
- Use `memory` only when necessary for returns

---

## Comparison: Old vs New Architecture

### Old Architecture (Per-Contract CIDs)
```
JurySC_01 (Iteration 1, Round 1)
├── string public iterationMetadataCID
├── mapping(address => string) public projectMetadataCID
└── address[] public prevRoundContracts

JurySC_01 (Iteration 1, Round 2)
├── string public iterationMetadataCID
├── mapping(address => string) public projectMetadataCID
└── address[] public prevRoundContracts

❌ Can't upgrade old contracts
❌ Fragmented metadata storage
❌ Mixing concerns (voting + metadata)
```

### New Architecture (Centralized Registry)
```
PoBRegistry (Single Contract)
├── iterationMetadata[chainId][jurySC] -> CID
├── projectMetadata[chainId][jurySC][project] -> CID
└── prevRoundContracts[chainId][jurySC] -> addresses[]

JurySC_01 (All Iterations)
├── Focus on voting logic only
└── No metadata fields needed

✅ Works with all contracts (old and new)
✅ Unified metadata access
✅ Separation of concerns
✅ Upgradeable
```

---

## Deployment Strategy

### Step 1: Deploy Registry
```bash
npx hardhat run scripts/deploy-metadata-registry.js --network testnet
# PoBRegistry proxy: 0x...
```

### Step 2: Migrate Existing Data
```javascript
// Upload all iterations.json entries to IPFS
for (const iteration of iterations) {
    const { cid } = await ipfsService.uploadJSON(iteration);
    await registry.setIterationMetadata(chainId, iteration.jurySC, cid);
}

// Upload all projects.json entries to IPFS
for (const project of projects) {
    const { cid } = await ipfsService.uploadJSON(project);
    await registry.setProjectMetadata(chainId, jurySC, project.account, cid);
}
```

### Step 3: Update API/Frontend
```javascript
// API: Update to use registry instead of contract CID fields
const cid = await metadataRegistry.getIterationMetadata(chainId, jurySC);

// Frontend: Same API interface, but backend uses registry
const metadata = await api.getIterationMetadata(chainId, jurySC);
```

### Step 4: Deprecate JSON Files
```
After verification:
- Remove frontend/public/iterations.json
- Remove frontend/public/projects.json
- Keep minimal iterations-bootstrap.json (contract addresses only)
```

---

## Future Enhancements

### Potential Additions (via Upgrade)
1. **Round Metadata**: Track individual round metadata separately
2. **Metadata Versioning**: Track CID history per project
3. **Batch Operations**: More efficient bulk updates
4. **Metadata Templates**: Predefined metadata schemas
5. **Access Control Roles**: Fine-grained permissions

### Example V2 Addition
```solidity
// PoBRegistryV2
mapping(uint256 => mapping(address => mapping(uint256 => string))) public roundMetadata;
// chainId => jurySC => roundNumber => CID

function setRoundMetadata(uint256 chainId, address jurySC, uint256 round, string calldata cid)
    external onlyOwner {
    roundMetadata[chainId][jurySC][round] = cid;
    emit RoundMetadataSet(chainId, jurySC, round, cid);
}
```

---

## Summary

The **PoBRegistry** provides:
- ✅ Single source of truth for all metadata CIDs
- ✅ Backwards compatibility with old contracts
- ✅ Project self-sovereignty over metadata
- ✅ Clean separation of concerns
- ✅ Upgradeability for future needs
- ✅ Multi-chain support
- ✅ Event tracking for indexing

This architecture enables full IPFS migration while maintaining flexibility and decentralization.
