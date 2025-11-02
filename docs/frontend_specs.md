# PoB v1 — Frontend Spec (NFT Badge System)

## 1) Scope

* **One page dApp**: Iteration info + role-based participant panel
* **RPC-only** reads/writes. No backend, no subgraphs, no routing.
* **4 Participant Roles** with different UI flows:
  1. **Community** — Mint NFT with 30 SYS, vote with NFT, claim deposit
  2. **DevRel** — Mint badge NFT (free), vote directly (no NFT required)
  3. **DAO_HIC** — Mint badge NFT (free), vote directly (no NFT required)
  4. **Projects** — Mint badge NFT (free), cannot vote
* **Minimal UI**: simple cards, one accent color, light background, role-based views.
* **NFT Badge Display**: Show iteration # and role trait for collected badges.

---

## 2) Tech Stack

* **React + Vite**, TypeScript.
* **ethers** (or viem) for RPC and native SYS transactions.
* **wagmi** optional (wallet connect).
* **Tailwind** for styling.
* **Network**: Syscoin NEVM (chainId: 57 mainnet, 5700 testnet).

---

## 3) Inputs & Config

* **JSON manifest**: `/public/iterations.json`
  Array of iteration configurations:

  ```json
  [
    {
      "iteration": 1,
      "name": "PoB Iteration #1",
      "jurySC": "0xJurySC_01_Address",
      "pob": "0xPoB_01_Address",
      "deployBlockHint": 123456,
      "startTime": 1234567890,
      "endTime": 1234654290,
      "link": "https://..."
    }
  ]
  ```

  * **Required fields**: `iteration`, `name`, `jurySC`, `pob`.
  * **Optional**: `deployBlockHint`, `startTime`, `endTime`, `link`.

---

## 4) On-chain Interfaces

### 4.1 JurySC_01 (Voting Contract)

**Read Functions:**
```solidity
function isActive() view returns (bool)
function votingEnded() view returns (bool)
function iteration() view returns (uint256)

// Role verification
function registeredNFT() view returns (address)
function isDevRelAccount(address) view returns (bool)
function isDaoHicVoter(address) view returns (bool)
function isRegisteredProject(address) view returns (bool)

// Projects
function projectCount() view returns (uint256)
function projectAddress(uint256 projectId) view returns (address)
function projectName(uint256 projectId) view returns (bytes32)

// Entity votes
function getDevRelEntityVote() view returns (uint256 projectId)
function getDaoHicEntityVote() view returns (uint256 projectId)
function getCommunityEntityVote() view returns (uint256 projectId)
function getWinner() view returns (uint256 winningProjectId, bool hasWinner)
function getDaoHicVoters() view returns (address[] memory)

// Individual votes
function devRelVote() view returns (uint256)
function devRelHasVoted() view returns (bool)
function daoHicVoteOf(address) view returns (uint256)
function daoHicHasVoted(address) view returns (bool)
function communityVoteOf(uint256 tokenId) view returns (uint256)
function communityHasVoted(uint256 tokenId) view returns (bool)
function communityAccountHasVoted(address) view returns (bool)
```

**Write Functions:**
```solidity
function voteDevRel(uint256 projectId) external
function voteDaoHic(uint256 projectId) external
function voteCommunity(uint256 tokenId, uint256 projectId) external
```

---

### 4.2 PoB_01 (NFT Badge Contract)

**Read Functions:**
```solidity
function iteration() view returns (uint256)
function ownerOf(uint256 tokenId) view returns (address)
function roleOf(uint256 tokenId) view returns (string)
function hasMinted(address) view returns (bool)
function claimed(uint256 tokenId) view returns (bool)
function tokenURI(uint256 tokenId) view returns (string)
```

**Write Functions (Minting):**
```solidity
function mint() external payable returns (uint256)  // Community: 30 SYS
function mintDevRel() external returns (uint256)  // Free
function mintDaoHic() external returns (uint256)  // Free
function mintProject() external returns (uint256)  // Free
```

**Write Functions (Claims):**
```solidity
function claim(uint256 tokenId) external  // Community only, after voting ends
```

**Token Discovery:**
* **No ERC721Enumerable.** Frontend obtains user tokenIds via **Transfer logs** from `deployBlockHint` to `latest`, then filters by current wallet address.

---

## 5) Page Structure & Components

### 5.1 Core Layout

**Header:**
- App title: "Proof-of-Builders"
- Wallet connect button
- Network indicator (Syscoin NEVM)
- Current iteration display

**Iteration Panel:**
- Iteration name & number
- Voting status: "Not Started" / "Active" / "Closed"
- Time remaining (if active)
- Link to iteration details

**Participant Panel:**
- Auto-detects user role(s) from JurySC_01 queries
- Shows role-specific UI (see 5.2)

**Results Panel:**
- Shows after voting ends
- Entity votes (DevRel, DAO_HIC, Community)
- Winner (if determined)
- Vote tallies per project

---

### 5.2 Role-Based UI Components

**Component Count:** ≤8 total components
1. Header
2. IterationCard
3. RoleBadge (shows user's role and NFT)
4. CommunityPanel (mint, vote, claim)
5. DevRelPanel (mint badge, vote)
6. DaoHicPanel (mint badge, vote)
7. ProjectPanel (mint badge only)
8. ResultsPanel (vote tallies, winner)

---

#### A) Community Role UI

**Pre-Minting (no NFT yet):**
- Check: `hasMinted[walletAddress] == false`
- Show: **"Mint Community Badge"** button
- Action: `PoB_01.mint{value: 30 ether}()`
- Display: "Lock 30 SYS to participate"

**Post-Minting (has NFT):**
- Discover NFT via Transfer logs: `roleOf[tokenId] == "Community"`
- Show: Badge card with `#tokenId`, iteration, role
- Display: NFT metadata (image, traits)

**During Voting (isActive):**
- Check: `!communityHasVoted[tokenId] && !communityAccountHasVoted[walletAddress]`
- Show: Project list (radio buttons)
- Action: `JurySC_01.voteCommunity(tokenId, projectId)`
- If already voted: Show current vote (read-only)

**After Voting (votingEnded):**
- Check: `!claimed[tokenId]`
- Show: **"Claim 30 SYS"** button
- Action: `PoB_01.claim(tokenId)`
- After claim: Show "Claimed" badge

---

#### B) DevRel Role UI

**Role Detection:**
- Query: `JurySC_01.isDevRelAccount(walletAddress)`
- If `true`, user is DevRel

**Pre-Minting (no badge):**
- Check: `hasMinted[walletAddress] == false`
- Show: **"Mint DevRel Badge"** button (free)
- Action: `PoB_01.mintDevRel()`

**Post-Minting:**
- Show: Badge card with iteration, "DevRel" role

**During Voting:**
- Check: `!devRelHasVoted`
- Show: Project list (radio buttons)
- Action: `JurySC_01.voteDevRel(projectId)`
- If already voted: Show current vote (read-only)

---

#### C) DAO_HIC Role UI

**Role Detection:**
- Query: `JurySC_01.isDaoHicVoter(walletAddress)`
- If `true`, user is DAO_HIC voter

**Pre-Minting (no badge):**
- Check: `hasMinted[walletAddress] == false`
- Show: **"Mint DAO_HIC Badge"** button (free)
- Action: `PoB_01.mintDaoHic()`

**Post-Minting:**
- Show: Badge card with iteration, "DAO-HIC" role

**During Voting:**
- Check: `!daoHicHasVoted[walletAddress]`
- Show: Project list (radio buttons)
- Action: `JurySC_01.voteDaoHic(projectId)`
- If already voted: Show current vote (read-only)

---

#### D) Project Role UI

**Role Detection:**
- Query: `JurySC_01.isRegisteredProject(walletAddress)`
- If `true`, user is a Project

**Pre-Minting (no badge):**
- Check: `hasMinted[walletAddress] == false`
- Show: **"Mint Project Badge"** button (free)
- Action: `PoB_01.mintProject()`

**Post-Minting:**
- Show: Badge card with iteration, "Project" role
- Message: "Projects cannot vote - badge is commemorative"

---

## 6) Data Flow

### 6.1 Initial Load

1. Load `iterations.json` manifest
2. Connect wallet (Syscoin NEVM)
3. Select iteration (or auto-select if only one)
4. Query JurySC_01 for:
   - `isActive()`
   - `votingEnded()`
   - `projectCount()` and load all projects
5. **Role Detection** (parallel queries):
   - `isDevRelAccount(walletAddress)`
   - `isDaoHicVoter(walletAddress)`
   - `isRegisteredProject(walletAddress)`
6. Load user's NFTs via Transfer logs (if any)

---

### 6.2 NFT Discovery (Community)

1. Query `Transfer` logs on PoB_01 from `deployBlockHint` to `latest`
   - Filter: `to == walletAddress`
2. For each tokenId found:
   - Verify `ownerOf(tokenId) == walletAddress` (in case transferred)
   - Query `roleOf(tokenId)` to get role
3. Filter for `roleOf == "Community"` for voting tokens
4. Display all owned badges (any role)

---

### 6.3 Minting Flow

**Community:**
```javascript
// Check if already minted
const hasMinted = await PoB_01.hasMinted(walletAddress);
if (hasMinted) return; // Already has badge

// Mint with 30 SYS
const tx = await PoB_01.mint({ value: ethers.parseEther("30") });
await tx.wait();
// Refresh NFTs
```

**DevRel / DAO_HIC / Project:**
```javascript
// Check if already minted
const hasMinted = await PoB_01.hasMinted(walletAddress);
if (hasMinted) return; // Silent, no error

// Mint badge (free)
const tx = await PoB_01.mintDevRel(); // or mintDaoHic, mintProject
await tx.wait();
// Refresh NFTs
```

---

### 6.4 Voting Flow

**Community:**
```javascript
// Validate
const hasVoted = await JurySC_01.communityHasVoted(tokenId);
const accountVoted = await JurySC_01.communityAccountHasVoted(walletAddress);
if (hasVoted || accountVoted) return; // Already voted

// Vote
const tx = await JurySC_01.voteCommunity(tokenId, projectId);
await tx.wait();
// Refresh vote status
```

**DevRel:**
```javascript
const hasVoted = await JurySC_01.devRelHasVoted();
if (hasVoted) return; // Already voted

const tx = await JurySC_01.voteDevRel(projectId);
await tx.wait();
```

**DAO_HIC:**
```javascript
const hasVoted = await JurySC_01.daoHicHasVoted(walletAddress);
if (hasVoted) return; // Already voted

const tx = await JurySC_01.voteDaoHic(projectId);
await tx.wait();
```

---

### 6.5 Claiming Flow (Community Only)

```javascript
// Check if voting ended
const votingEnded = await JurySC_01.votingEnded();
if (!votingEnded) return; // Can't claim yet

// Check if already claimed
const claimed = await PoB_01.claimed(tokenId);
if (claimed) return; // Already claimed

// Check role
const role = await PoB_01.roleOf(tokenId);
if (role !== "Community") return; // Only Community can claim

// Claim
const tx = await PoB_01.claim(tokenId);
await tx.wait();
// Refresh claim status, receive 30 SYS back
```

---

### 6.6 Results Display

After voting ends:
```javascript
const [winningProjectId, hasWinner] = await JurySC_01.getWinner();
const [devRelVote, daoHicVote, communityVote] = await JurySC_01.getEntityVoteCounts();

// Display:
// - Entity votes per project
// - Winner (if hasWinner == true)
// - Individual pool tallies (optional)
```

---

## 7) UX Rules & States

### 7.1 Multi-Role Handling

**User can have multiple roles:**
- Example: User is both DAO_HIC voter AND owns Community NFT
- Show **both panels** side-by-side or stacked
- Each panel operates independently

**Badge Collection:**
- User can mint multiple badges if they qualify for multiple roles
- `hasMinted` check is per-account, not per-role
- UI shows all owned badges with iteration and role

---

### 7.2 Status-Based Actions

**Before Activation:**
- All roles: Show "Voting not started yet"
- Community: Allow minting (pre-lock 30 SYS)
- Other roles: Allow badge minting

**During Voting (isActive):**
- Show time remaining
- Enable voting for eligible roles
- Disable minting for new participants (optional, spec doesn't restrict)

**After Voting (votingEnded):**
- Show results
- Community: Enable claiming
- All roles: Show final vote tallies

**After Locking:**
- Read-only display
- Historical record of votes and winner

---

### 7.3 Project Display

Projects are loaded from JurySC_01:
```javascript
const projectCount = await JurySC_01.projectCount();
const projects = [];
for (let i = 1; i <= projectCount; i++) {
  const address = await JurySC_01.projectAddress(i);
  const nameBytes32 = await JurySC_01.projectName(i);
  const name = ethers.decodeBytes32String(nameBytes32);
  projects.push({ id: i, address, name });
}
```

Display as:
- Radio button list for voting
- Each project shows: name, address (truncated)
- Highlight if project account is connected (user is a Project)

---

## 8) Error & Edge Handling

**Wallet not connected:**
- Show: Iteration info only
- Prompt: "Connect wallet to participate"

**Wrong network:**
- Detect: `chainId != 57 && chainId != 5700`
- Prompt: "Switch to Syscoin NEVM"
- Offer: Network switch button (if wallet supports)

**Role mismatch:**
- User tries to mint DevRel badge but is not DevRel
- Transaction will revert (PoB_01 queries JurySC_01)
- Show error: "You are not registered as DevRel"

**Already minted:**
- `hasMinted == true`
- Transaction returns 0 silently (no revert)
- UI should check before attempting

**Already voted:**
- Community: Both tokenId and account checks
- DevRel/DAO_HIC: Account check
- Show: Current vote (read-only)
- Disable: Vote button

**Insufficient balance (Community):**
- Minting requires 30 SYS + gas
- Check balance before minting
- Show error if insufficient

**Transaction failures:**
- Display revert reason if available
- Offer retry button
- Log to console for debugging

**NFT transferred:**
- Community NFT transferred to another account
- Original owner cannot vote with that tokenId (ownership check fails)
- New owner can vote (if they haven't voted with another tokenId)

---

## 9) Minimal Styling

**Layout:**
- Single page, responsive grid
- Desktop: 2 columns (Iteration + Participant panels)
- Mobile: Stacked vertical

**Cards:**
- Padding: `p-4`
- Border radius: `rounded-xl`
- Shadow: `shadow-sm`
- Gap: `1rem`

**Badges (NFT display):**
- Show iteration number
- Show role (color-coded)
- Show tokenId
- Optional: Display image from tokenURI

**Colors:**
- Accent: One primary color (e.g., indigo-600)
- Role colors:
  - Community: Blue
  - DevRel: Purple
  - DAO_HIC: Green
  - Project: Orange

**Typography:**
- System font stack
- No custom fonts

**Buttons:**
- Primary actions: Accent color
- Disabled: Gray
- Hover/focus: Tailwind defaults

---

## 10) Acceptance Criteria

**Role Detection:**
- ✅ Correctly identifies user role(s) from JurySC_01
- ✅ Shows appropriate panel for each role

**Badge Minting:**
- ✅ Community can mint with 30 SYS deposit
- ✅ DevRel/DAO_HIC/Projects can mint free badges (if eligible)
- ✅ Silent duplicate prevention (`hasMinted` check)
- ✅ Badge display shows iteration and role

**Voting:**
- ✅ Community dual-check prevents multi-NFT and transferred NFT exploits
- ✅ DevRel votes directly (no NFT required)
- ✅ DAO_HIC voters vote directly (no NFT required)
- ✅ Projects cannot vote (UI blocks it)

**Claims:**
- ✅ Community can claim 30 SYS after voting ends
- ✅ Only Community role can claim (others have no deposit)
- ✅ Claim status updates correctly

**Results:**
- ✅ Shows entity-level votes (DevRel, DAO_HIC, Community)
- ✅ Displays winner if determined
- ✅ Read-only after voting ends

**Multi-Role:**
- ✅ Handles users with multiple roles correctly
- ✅ Shows all owned badges

**Network:**
- ✅ Works on Syscoin NEVM (chainId 57/5700)
- ✅ Prompts network switch if wrong chain

**No Backend:**
- ✅ All data from RPC calls
- ✅ No server dependencies
- ✅ Single-page app (no routing)

---

## 11) Changes from Previous Spec

### Removed:
- Single juror voting model
- `statusOf()` state machine (replaced with role-based flows)
- ERC-20 token references (now native SYS)
- Claim from JurySC (now from PoB_01)

### Added:
- **4 role-based UIs** (Community, DevRel, DAO_HIC, Projects)
- **NFT badge system** with iteration and role traits
- **Direct minting to PoB_01** (not through JurySC)
- **Multi-role handling** (user can be multiple roles)
- **Badge collection display** (show all owned badges)
- **Entity-level voting display** (3 entities, not individual votes)
- **Winner determination** (getWinner view function)
- **Role verification via JurySC** (isDevRelAccount, etc.)
- **Community dual-check** (tokenId + account validation)
- **Project voting restriction** (UI enforces it)
- **Native SYS transactions** (30 SYS via msg.value)
- **Iteration tracking** (show iteration number)
- **Badge minting verification** (callbacks to JurySC_01)

---

## 12) Optional Enhancements (NOT v1)

Do **NOT** implement these in v1 (feature freeze):
- ❌ Badge gallery page
- ❌ Voting history across iterations
- ❌ ENS resolution for addresses
- ❌ IPFS metadata hosting
- ❌ Vote delegation
- ❌ Batch operations
- ❌ Mobile app
- ❌ Social sharing
- ❌ Leaderboards
- ❌ Notifications

Keep it minimal - single page, role-based flows, RPC-only.
