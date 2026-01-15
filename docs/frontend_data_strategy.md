# Frontend Data Strategy

## Overview

This document defines how the frontend retrieves and validates blockchain data. The strategy prioritizes fast UI interactivity while ensuring correctness for critical user actions.

## Data Sources

### API Indexer (Primary)
- **Role:** Indexed data source for all contract state
- **Refresh rate:** ~37 seconds (configurable, default is 1/4 of Syscoin's 150s block time)
- **Trust level:** Trusted source for display data
- **Coverage:** All iterations, projects, votes, badges, scores, winners, timestamps

### RPC (Validation Layer)
- **Role:** Validate critical state before irreversible actions
- **Usage:** Minimal, only for checks where staleness causes serious harm
- **Trust level:** Source of truth when conflicts arise

## Design Principles

1. **API-first rendering** - UI loads immediately from API, no waiting for RPC
2. **RPC validates, not populates** - RPC checks critical state before actions, not for display
3. **Contract is the safety net** - Invalid transactions revert; RPC validation prevents wasted gas, not fund loss
4. **Staleness is acceptable for display** - 37s delay in vote counts or badge totals is fine
5. **No localStorage caching** - API replaces all frontend caching; wipe legacy `pob_*` keys on init

## What Constitutes "Serious Harm"

**IS serious harm:**
- User plans around fundamentally wrong state (e.g., "voting is open" when closed)
- Project page renders for non-existent project (trust/integrity violation)

**NOT serious harm:**
- Failed transaction with minor gas loss (~0.001-0.01 SYS)
- Display showing slightly stale vote counts
- UI showing action button that fails on click (contract protects funds)

## RPC-Exclusive Checks

Only two checks require direct RPC validation:

### 1. Iteration Round State
**When:** Before any voting or minting action
**What:** `isActive()` and `votingEnded()` on JurySC
**Why:** These gate all user actions; wrong state = frustrated user who planned around it

```typescript
// Before vote/mint action
const [isActive, votingEnded] = await Promise.all([
  jurySC.isActive(),
  jurySC.votingEnded()
]);
if (!isActive || votingEnded) {
  // Show "state changed" message, refresh from API
}
```

### 2. Project Registration
**When:** Rendering a project page
**What:** Verify project address exists in JurySC's `projects` array
**Why:** Ensures page renders only for real on-chain projects (integrity check)

```typescript
// On project page load
const projects = await jurySC.getProjects();
if (!projects.includes(projectAddress)) {
  // Show 404 or "project not found"
}
```

## What NOT to Check via RPC

These rely on the API indexer (37s refresh is sufficient):

| Data | Why API is Sufficient |
|------|----------------------|
| `projectsLocked` | Derived from `isActive`; redundant check |
| `contractLocked` | Only affects owner actions |
| Badge ownership | User knows if they just minted; double-mint just fails |
| Vote status | User knows if they just voted; re-vote just fails |
| Claim status | User knows if they just claimed; re-claim just fails |
| Vote tallies | Display only; no action depends on exact count |
| Winner | Display only; determined after voting ends |
| `startTime`/`endTime` | Immutable once set; indexer catches activation |
| Project list | Immutable during voting (after `projectsLocked`) |

## Cache Invalidation

### Frontend Signals Staleness
When RPC validation reveals API data is stale:
1. Frontend proceeds with RPC data for the current action
2. Optionally notify API to re-index (future enhancement)
3. Refresh iteration data from API after action completes

### Reorg Handling
If RPC shows state that contradicts API (possible reorg):
1. Trust RPC for the immediate action
2. API will self-correct on next indexer cycle
3. No special frontend handling needed

## localStorage Cleanup

### Legacy Keys to Remove
On app initialization, remove all keys matching these patterns:
- `pob_block_heights` - Old RPC cache block tracking
- `pob_iteration_cache:*` - Old iteration data cache
- `pob_cache_version` - Old cache versioning

### Keys to Keep
- `userDisconnected` - Wallet connection preference
- `selectedIteration` - User's last viewed iteration
- `pending-metadata-*` - Pending transaction tracking (has built-in TTL via confirmation polling)
- `pending-iteration-metadata-*` - Same as above

### Cleanup Implementation
```typescript
const LEGACY_PREFIXES = [
  'pob_block_heights',
  'pob_iteration_cache:',
  'pob_cache_version'
];

function cleanupLegacyCache(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && LEGACY_PREFIXES.some(prefix => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}
```

## API Data Model

The API indexer provides snapshots with these fields per iteration:

```typescript
interface IterationSnapshot {
  // Identifiers
  iterationId: number;
  chainId: number;
  round: number;

  // Contract addresses
  registryAddress: string;
  pobAddress: string;
  juryAddress: string;

  // State
  juryState: 'deployed' | 'activated' | 'active' | 'ended' | 'locked';
  startTime: number | null;
  endTime: number | null;
  votingMode: number;
  projectsLocked: boolean;
  contractLocked: boolean;

  // Results
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
  projectScores: { addresses: string[]; scores: string[]; totalPossible: string } | null;

  // Participation
  totals: { devRel: number; daoHic: number; community: number };

  // Metadata
  lastBlock: number;
  lastUpdatedAt: number;
}
```

## Action Flows

### Voting Flow
```
1. Load iteration from API (immediate render)
2. User clicks "Vote" on a project
3. Show confirmation modal (uses API data)
4. On confirm: RPC check isActive() + votingEnded()
5. If state changed → alert user, refresh from API
6. If valid → execute transaction
7. On success → refresh iteration from API
```

### Minting Flow
```
1. Load iteration from API
2. User clicks "Mint Badge"
3. Show confirmation modal
4. On confirm: RPC check isActive() (community) or votingEnded() (devrel/dao/project)
5. If state changed → alert user
6. If valid → execute transaction
7. On success → refresh badges from API
```

### Project Page Flow
```
1. Extract project address from URL
2. Load iteration from API
3. RPC check: project exists in jurySC.getProjects()
4. If not found → show 404
5. If found → render page with API data
```

## Summary

| Source | Use For | Latency |
|--------|---------|---------|
| API | All display data, initial render, vote counts, badges, winners | ~37s max staleness |
| RPC | Pre-action validation of `isActive`/`votingEnded`, project existence | Real-time |
| localStorage | User preferences only (wallet, selected iteration) | Instant |

The goal is **fast UI with minimal RPC calls**. Trust the API for display, validate via RPC only when user commits to an action that would be frustrating if it fails due to stale state.
