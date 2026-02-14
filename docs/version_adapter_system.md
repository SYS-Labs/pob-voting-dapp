# Version Adapter System

## The Problem

PoB deploys a fresh pair of contracts (JurySC + PoB NFT) per iteration. Over time, these contracts evolve: functions get renamed (`hasMinted` -> `hasMintedBadge`), new features land (`votingMode`, weighted scoring), data accessors change shape (`projectAddress(i)` loop -> `getProjectAddresses()` array). The frontend would need version-branching logic, multiple ABIs, and per-version code paths to read from all of them. Every new contract version compounds the maintenance burden.

## The Idea

Put the translation layer on-chain instead. One interface, stateless adapter contracts that speak to each contract version, and a registry that routes callers to the right adapter. The frontend calls the same functions regardless of which iteration it's reading — the adapter handles the dialect.

```
Frontend (single ABI: IVersionAdapter)
  │
  │  getAdapterConfig(iteration, round)
  ▼
PoBRegistry
  │  returns (jurySC address, adapter address)
  ▼
adapter.getProjectAddresses(jurySC)
adapter.entityVoteOf(jurySC, entityId, voter)
adapter.hasMintedBadge(jurySC, account)
  │
  ▼
Actual contract (JurySC_01, JurySC_02, future versions)
```

The adapters are stateless — they hold no storage, just translate function signatures and data shapes. They can be deployed once and shared across all rounds that use the same contract version.

## Components

### IVersionAdapter — The Unified Interface

`contracts/contracts/adapters/IVersionAdapter.sol`

Covers every read operation the frontend needs, grouped by domain:

| Group | Functions |
|-------|-----------|
| **Lifecycle** | `iteration`, `startTime`, `endTime`, `isActive`, `hasVotingEnded`, `votingEnded` |
| **State** | `locked`, `projectsLocked`, `votingMode`, `owner` |
| **Projects** | `getProjectAddresses`, `isRegisteredProject` |
| **Entity-generic** | `getEntityVoters`, `entityVoteOf`, `entityHasVoted`, `isEntityVoter`, `getEntityVote` |
| **Community** | `communityVoteOf`, `communityHasVoted`, `getCommunityEntityVote` |
| **Aggregates** | `getVoteParticipationCounts`, `getProjectVoteBreakdown` |
| **Results** | `getWinner`, `getWinnerConsensus`, `getWinnerWeighted`, `getWinnerWithScores` |
| **Badge (PoB)** | `pobAddress`, `getRoleOf`, `claimed`, `ownerOfToken`, `pobIteration`, `hasMintedBadge` |

All functions take `jurySC` as the first parameter. The adapter discovers the PoB NFT address via `jurySC.pob()`.

**Entity-generic design:** `entityId 0` = DevRel (or future SMT multi-voter), `entityId 1` = DAO_HIC. Community stays tokenId-based because its voting model is fundamentally different. If DevRel evolves from a single account to a multi-voter entity (SMT), only the adapter internals change — the interface stays identical.

### V1Adapter — Translating JurySC_01 / PoB_01

`contracts/contracts/adapters/V1Adapter.sol`

Handles two sub-versions of _01 contracts: the initial deploy (v001) and the upgraded bytecode (v002+ with `votingMode` / consensus / weighted scoring).

Translation points (everything else is a 1-line passthrough):

- **`getProjectAddresses`** — JurySC_01 has no array getter, only `projectCount()` + `projectAddress(i)`. The adapter loops and builds the array.
- **`votingMode`** — try-catch: returns `0` (CONSENSUS) if the function doesn't exist on v001 bytecode.
- **`getWinnerConsensus`** — try-catch: falls back to `getWinner()` for v001.
- **`getWinnerWeighted` / `getWinnerWithScores`** — try-catch: returns empty/zero for v001 (no weighted mode existed).
- **Entity wrapping** — DevRel is a single account on _01 contracts (`devRelAccount()`, `devRelVote()`, `devRelHasVoted()`). The adapter wraps these into the entity-generic shape: `getEntityVoters(0)` returns a single-element array, `entityVoteOf(0, addr)` checks if addr is the DevRel account and returns their vote.
- **`hasMintedBadge`** — calls `pob.hasMinted(addr)` (V1 naming).
- Reverts with `InvalidEntityId(uint8)` for entityId > 1.

### V2Adapter — Translating JurySC_02 / PoB_02

`contracts/contracts/adapters/V2Adapter.sol`

Thinner than V1 — JurySC_02 has all functions natively. No try-catch needed.

Translation points (everything else is a 1-line passthrough):

- **Entity wrapping** — Same DevRel single-account wrapping as V1 (entityId 0 -> single-element array).
- **`hasMintedBadge`** — calls `pob.hasMintedBadge(addr)` (V2 naming).
- Reverts with `InvalidEntityId(uint8)` for entityId > 1.

### PoBRegistry — The Router

`contracts/contracts/PoBRegistry.sol` (upgraded to v3)

Storage additions (appended after existing mappings to preserve UUPS layout):

```solidity
mapping(uint256 => address) public versionAdapters;   // version number -> adapter address
mapping(uint256 => mapping(uint256 => uint256)) public roundVersion; // iteration -> round -> version
```

Key functions:

```solidity
// Admin: wire a version number to an adapter contract
setAdapter(uint256 versionId, address adapter)

// Admin: tag a round with its contract version
setRoundVersion(uint256 iterationId, uint256 roundId, uint256 versionId)

// Read: resolve a round to its jurySC + adapter pair
getAdapterConfig(uint256 iterationId, uint256 roundId)
    → returns (address jurySC, address adapter)
```

`setRoundVersion` validates: the round must exist, versionId must be non-zero, and the adapter for that version must already be set. `getAdapterConfig` validates: version must be set for the round, and the adapter must exist.

Events: `AdapterSet(versionId, adapter)`, `RoundVersionSet(iterationId, roundId, versionId)`.

## How It All Wires Together

```
1. Deploy adapters (once per network):
   V1Adapter.deploy()  →  v1Address
   V2Adapter.deploy()  →  v2Address

2. Register adapters in registry:
   registry.setAdapter(1, v1Address)
   registry.setAdapter(2, v2Address)

3. Tag each round with its version:
   registry.setRoundVersion(iterationId, roundId, 1)   // _01 contracts
   registry.setRoundVersion(iterationId, roundId, 2)   // _02 contracts

4. Frontend reads any round uniformly:
   (jurySC, adapter) = registry.getAdapterConfig(iteration, round)
   IVersionAdapter(adapter).isActive(jurySC)
   IVersionAdapter(adapter).getProjectAddresses(jurySC)
   IVersionAdapter(adapter).hasMintedBadge(jurySC, userAddress)
   // ...same calls for any version
```

## Adding a Future Version (V3, V4, ...)

This is where the modularity pays off. When a new JurySC_03 is developed:

1. Write `V3Adapter.sol` implementing `IVersionAdapter`. If the new contract already matches the interface natively, the adapter is just 1-line passthroughs — or the contract itself can implement `IVersionAdapter` directly, eliminating the adapter entirely.
2. Deploy the adapter: `V3Adapter.deploy()`.
3. Register it: `registry.setAdapter(3, v3Address)`.
4. Tag new rounds: `registry.setRoundVersion(iteration, round, 3)`.

No frontend changes. No multi-ABI juggling. No version checks in the UI code. Old iterations keep working through their existing adapters.

## Local Development

The local dev startup flow (`start-hardhat.sh` -> `deploy.js` -> `seed-local.js`) handles adapter wiring automatically. Inside `seed-local.js`, after the iteration and round are registered in the registry:

1. Deploys V1Adapter and V2Adapter
2. Calls `setAdapter(1, v1Address)` and `setAdapter(2, v2Address)`
3. Calls `setRoundVersion(iteration, round, 2)` (local dev uses _02 contracts)

This means `getAdapterConfig()` works out of the box after `start-hardhat.sh` — no manual adapter deployment needed.

For testnet/mainnet, the standalone `deploy-adapters.js` script handles deployment and wiring. Env vars: `POB_REGISTRY`, `UPGRADE_REGISTRY=true/false`, `DRY_RUN=true/false`. Saves output to `deployments/<network>/adapters.json`.

## Test Coverage

- **V1Adapter.test.js** — 26 tests: lifecycle passthroughs, state, projects, entity-generic functions for both entities, community, aggregates, results, badge reads, invalid entityId reverts.
- **V2Adapter.test.js** — 19 tests: same coverage pattern, verifies native `getProjectAddresses` passthrough, V2 `hasMintedBadge` naming, entity-generic wrapping, invalid entityId reverts.
- **PoBRegistry-adapters.test.js** — 20 tests: `setAdapter` (happy + reverts), `setRoundVersion` (happy + reverts for missing round/version/adapter), `getAdapterConfig` (happy + reverts), multi-iteration flow, upgrade compatibility.

## File Reference

```
contracts/contracts/adapters/
├── IVersionAdapter.sol      # The unified read interface
├── V1Adapter.sol            # Stateless adapter for _01 contracts
└── V2Adapter.sol            # Stateless adapter for _02 contracts

contracts/contracts/PoBRegistry.sol   # Router (v3, UUPS upgradeable)

contracts/test/
├── V1Adapter.test.js
├── V2Adapter.test.js
└── PoBRegistry-adapters.test.js

contracts/scripts/
├── deploy-adapters.js       # Testnet/mainnet deployment
└── seed-local.js            # Local dev (deploys + wires adapters inline)
```
