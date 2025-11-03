# PoB v1 — Smart Contracts Spec (NFT Badge System)

## 1) Scope (must-haves)

* **NFT Badge System**: All participants (voters + projects) receive commemorative PoB_01 NFT badges with traits showing iteration # and role.
* **4 Participant Roles**:
  1. **Community** — Lock 30 SYS, mint NFT, vote with NFT
  2. **DevRel** — Single account, mints special badge NFT, votes directly
  3. **DAO_HIC** — Pool of accounts, each mints badge NFT, votes directly
  4. **Projects** — Voting options, mint badge NFT, **cannot vote**
* **3 Voting Entities** with equal weight (1 vote each):
  1. **DevRel** — 1 vote
  2. **DAO_HIC** — Internal majority decides entity vote
  3. **Community** — Internal majority decides entity vote (via NFT ownership)
* **Iteration duration:** 48-hour voting window from activation.
* **One NFT per account:** Silent duplicate prevention across all roles.
* **Community dual-check:** Prevent voting with multiple NFTs AND prevent same NFT voting twice if transferred.
* **Entity quorum:** Minimum 1 entity must vote (out of 3) for valid result.
* **Pool majority:** Simple majority within each pool (1 out of N can decide if others don't vote).
* **Winner locking:** If winner exists, contract locks for history (only allows Community claims).
* **Iteration tracking:** Each iteration has its number (1, 2, 3...) embedded in NFT metadata.
* **One iteration per JurySC_01 proxy** (upgradeable via UUPS).

---

## 2) Tech & Standards

* Solidity ^0.8.x, OpenZeppelin Contracts (+ Upgrades).
* **Proxy:** UUPS via OZ Upgrades for JurySC_01 only.
* **Native Token:** SYS (native gas token, like ETH on Ethereum), fixed `30 ether` deposit for Community participants.
* **NFT:** PoB_01 (ERC-721) as commemorative badge with traits (non-upgradeable).
* **Contract Naming:** JurySC_01 (iteration #1), increments with each iteration series.

---

## 2.1) Deployment Architecture

**Each iteration deploys BOTH contracts (not shared):**

```
Iteration 1:
├── PoB_01 (iteration=1, immutable)
└── JurySC_01 (iteration=1, upgradeable via UUPS)

Iteration 2:
├── PoB_01 (iteration=2, immutable)
└── JurySC_01 (iteration=2, upgradeable via UUPS)
```

**Relationship between contracts:**

1. **Deployment order:**
   - Deploy PoB_01 first with `iteration` parameter
   - Deploy JurySC_01 (UUPS proxy) with PoB_01 address
   - Transfer PoB_01 ownership to JurySC_01 address

2. **Bidirectional link:**
   - `JurySC_01 → PoB_01`: JurySC stores PoB_01 address (to validate NFTs)
   - `PoB_01 → JurySC_01`: PoB_01's owner is JurySC (queries voting status via `owner()`)

3. **Voter list freeze:**
   - Community minting is locked when voting ends (`isActive() == false`)
   - New iteration = new PoB_01 = fresh voter list
   - Old iteration NFTs remain as historical proof

**Why not share PoB_01 across iterations?**
- Each PoB_01 has immutable `iteration` number in metadata
- Community minting window is tied to ONE specific JurySC's `isActive()` state
- Keeps iteration data isolated and immutable

---

## 3) Participant Roles & NFT Traits

### 3.1 NFT Trait System

Each PoB_01 NFT has **2 core traits** (stored on-chain or in metadata):

1. **Iteration** (uint256) — Iteration number (e.g., 1, 2, 3...)
2. **Role** (string or enum) — One of:
   - `"Community"` — Voter who locked 30 SYS
   - `"DevRel"` — DevRel entity voter
   - `"DAO-HIC"` — DAO_HIC pool voter
   - `"Project"` — Project being voted on (badge only, cannot vote)

**Example NFT metadata:**
```json
{
  "name": "Proof of Builders #1 - Community",
  "iteration": 1,
  "role": "Community",
  "description": "Participant in PoB Iteration #1"
}
```

---

### 3.2 Role 1: Community (NFT Required for Voting)

**Type:** Pool of SYS lockers
**Weight:** 1 entity vote
**Deposit:** 30 SYS (native gas token)
**NFT Minting:** Users call `PoB_01.mint{value: 30 ether}()` directly
**NFT Trait:** `(iteration, "Community")`
**Voting:** NFT holder calls `JurySC_01.voteCommunity(uint256 tokenId, uint256 projectId)`
**Vote changes:** Voters can change their vote anytime during voting; project tallies update incrementally.
**Voting Checks (dual validation):**
  - Has this **account** already voted with any other tokenId? (prevents multi-NFT gaming)
  - Does msg.sender own this tokenId?
  - Is tokenId from registered PoB_01?
**Internal majority:** Simple majority of Community votes decides entity vote (no minimum quorum).
**Claims:** After voting ends, users call `PoB_01.claim(uint256 tokenId)` to retrieve 30 SYS.

---

### 3.3 Role 2: DevRel (NFT Optional, Badge Only)

**Type:** Single account
**Weight:** 1 entity vote
**Deposit:** None
**NFT Minting:** DevRel account calls `PoB_01.mintDevRel()`
**NFT Trait:** `(iteration, "DevRel")`
**Registration:** Owner sets via `JurySC_01.setDevRelAccount(address)`
**Voting:** DevRel account calls `JurySC_01.voteDevRel(uint256 projectId)` (no NFT required)
**Vote changes:** DevRel can change their vote anytime during voting. If owner changes the DevRel account, previous vote is **wiped**; new account must vote again.
**Update rules:** Can change account until voting window ends.
**Badge Purpose:** Commemorative only, not required for voting.

---

### 3.4 Role 3: DAO_HIC (NFT Optional, Badge Only)

**Type:** Pool of accounts
**Weight:** 1 entity vote
**Deposit:** None
**NFT Minting:** Each DAO_HIC voter calls `PoB_01.mintDaoHic()`
**NFT Trait:** `(iteration, "DAO-HIC")`
**Registration:** Owner adds/removes via `JurySC_01.addDaoHicVoter(address)` / `removeDaoHicVoter(address)`
**Voting:** Each DAO_HIC account calls `JurySC_01.voteDaoHic(uint256 projectId)` (no NFT required)
**Vote changes:** DAO_HIC voters can change their vote anytime during voting; project tallies update incrementally. If owner removes a DAO_HIC account, that account's vote is **wiped**.
**Internal majority:** Simple majority of DAO_HIC votes decides entity vote (no minimum quorum).
**Update rules:** Owner can add/remove DAO_HIC voters until voting window ends.
**Badge Purpose:** Commemorative only, not required for voting.

---

### 3.5 Role 4: Projects (NFT Badge, Cannot Vote)

**Type:** Accounts representing projects being voted on
**Weight:** 0 (cannot vote)
**Deposit:** None
**NFT Minting:** Project account calls `PoB_01.mintProject()`
**NFT Trait:** `(iteration, "Project")`
**Registration:** Owner registers via `JurySC_01.registerProject(address projectAddress, bytes32 name)`
**Voting:** **Projects cannot vote** (restricted in JurySC_01)
**Badge Purpose:** Commemorative participation badge showing they were a voting option.

---

## 4) Contracts

### 4.1 `PoB_01` — NFT Badge with Traits (non-upgradeable)

**Purpose:** Commemorative NFT badge system for all participants with role-based traits.

**Inherit:** `ERC721`, `Ownable` (no Enumerable).

**Storage:**

* `bool public mintingClosed`
* `uint256 public nextId`
* `uint256 public iteration` — Iteration number (immutable after deployment)
* `mapping(uint256 tokenId => string role) public roleOf` — NFT role trait
* `mapping(address => bool) public hasMinted` — One NFT per account check
* `mapping(uint256 tokenId => bool) public claimed` — Claim tracking (Community only)

**Constructor:**
```solidity
constructor(
  string memory name_,
  string memory symbol_,
  uint256 iteration_,
  address initialOwner
)
```
- Set `iteration` (immutable)
- Set initial owner

---

**Functions:**

**Community Minting (30 SYS deposit):**
```solidity
function mint() external payable returns (uint256)
```
- Require `msg.value == 30 ether` (30 SYS)
- If `hasMinted[msg.sender] == true` → **silent return 0** (no revert, idempotent)
- Set `hasMinted[msg.sender] = true`
- Mint NFT: `_safeMint(msg.sender, nextId)`
- Set `roleOf[nextId] = "Community"`
- Increment `nextId`
- Return `tokenId`
- **No event for duplicate (silent)**

---

**DevRel Special Mint (no deposit):**
```solidity
function mintDevRel() external returns (uint256)
```
- Query `IJurySC_01(owner()).registeredNFT()` → require equals `address(this)`
- Query `IJurySC_01(owner()).isDevRelAccount(msg.sender)` → require true
- If `hasMinted[msg.sender] == true` → **silent return 0**
- Set `hasMinted[msg.sender] = true`
- Mint NFT: `_safeMint(msg.sender, nextId)`
- Set `roleOf[nextId] = "DevRel"`
- Increment `nextId`
- Return `tokenId`

---

**DAO_HIC Special Mint (no deposit):**
```solidity
function mintDaoHic() external returns (uint256)
```
- Query `IJurySC_01(owner()).registeredNFT()` → require equals `address(this)`
- Query `IJurySC_01(owner()).isDaoHicVoter(msg.sender)` → require true
- If `hasMinted[msg.sender] == true` → **silent return 0**
- Set `hasMinted[msg.sender] = true`
- Mint NFT: `_safeMint(msg.sender, nextId)`
- Set `roleOf[nextId] = "DAO-HIC"`
- Increment `nextId`
- Return `tokenId`

---

**Project Special Mint (no deposit):**
```solidity
function mintProject() external returns (uint256)
```
- Query `IJurySC_01(owner()).registeredNFT()` → require equals `address(this)`
- Query `IJurySC_01(owner()).isRegisteredProject(msg.sender)` → require true
- If `hasMinted[msg.sender] == true` → **silent return 0**
- Set `hasMinted[msg.sender] = true`
- Mint NFT: `_safeMint(msg.sender, nextId)`
- Set `roleOf[nextId] = "Project"`
- Increment `nextId`
- Return `tokenId`

---

**Claims (Community only):**
```solidity
function claim(uint256 tokenId) external nonReentrant
```
- Require `roleOf[tokenId] == "Community"` (only Community can claim)
- Require `ownerOf(tokenId) == msg.sender`
- Require `!claimed[tokenId]`
- Query `JurySC_01(owner()).votingEnded()` → require true
- Set `claimed[tokenId] = true`
- Transfer: `(bool success, ) = msg.sender.call{value: 30 ether}(""); require(success);`
- Emit `Claimed(tokenId, msg.sender)`

**Note:** `owner()` of PoB_01 should be JurySC_01 address after deployment.

---

**Admin:**
```solidity
function closeMinting() external onlyOwner
```
- Set `mintingClosed = true`

---

**Metadata/Views:**
```solidity
function tokenURI(uint256 tokenId) public view override returns (string)
```
- Return metadata including iteration and role traits

```solidity
function getRoleOf(uint256 tokenId) public view returns (string)
```
- Return `roleOf[tokenId]`

---

**Events:**
- Standard `Transfer`
- `event Claimed(uint256 indexed tokenId, address indexed participant)`

---

### 4.2 `JurySC_01` — 3-Entity Voting (upgradeable via UUPS)

**Purpose:** Manages 3-entity voting system, project registration, vote validation, and winner determination.

**Proxy:** UUPS via OZ Upgrades.

**Inherit:** `Initializable`, `UUPSUpgradeable`, `OwnableUpgradeable`, `ReentrancyGuardUpgradeable`.

---

#### Constants

* `uint256 public constant COMMUNITY_DEPOSIT = 30 ether; // 30 SYS (native token)`

---

#### Storage

**Core:**
* `PoB_01 public pob;` — Registered NFT contract (PoB_01)
* `uint256 public iteration;` — Iteration number
* `uint64 public startTime;` — Voting start time
* `uint64 public endTime;` — Voting end time (startTime + 48h)
* `bool public locked;` — True if winner determined, contract locked for history

**Projects:**
* `uint256 public projectCount;` — Total registered projects
* `mapping(uint256 projectId => address) public projectAddress;` — Project addresses (1-indexed)
* `mapping(uint256 projectId => bytes32) public projectName;` — Project names
* `mapping(address => bool) public isRegisteredProject;` — Quick lookup
* `bool public projectsLocked;` — True after voting starts (no new projects)

**Entity 1 - DevRel:**
* `address public devRelAccount;` — Current DevRel voting account
* `uint256 public devRelVote;` — DevRel's project vote (0 = not voted)
* `bool public devRelHasVoted;` — True if DevRel voted

**Entity 2 - DAO_HIC:**
* `mapping(address => bool) public isDaoHicVoter;` — Registered DAO_HIC voters
* `address[] public daoHicVoters;` — List of DAO_HIC voters
* `mapping(address => uint256) public daoHicVoteOf;` — Each DAO_HIC voter's choice
* `mapping(address => bool) public daoHicHasVoted;` — Track who voted

**Entity 3 - Community (NFT-based):**
* `mapping(uint256 tokenId => uint256 projectId) public communityVoteOf;` — Community votes by tokenId
* `mapping(uint256 tokenId => bool) public communityHasVoted;` — Track which NFTs voted
* `mapping(address => bool) public communityAccountHasVoted;` — Track which accounts voted (prevents multi-NFT)

---

#### Errors

* `error NotActive();`
* `error NotOwner();`
* `error AlreadyActivated();`
* `error InsufficientQuorum();`
* `error ProjectsLocked();`
* `error InvalidProject();`
* `error ContractLocked();`
* `error NotEnoughVoters();`
* `error AlreadyVoted();`
* `error InvalidNFT();`
* `error ProjectCannotVote();`

---

#### Events

* `event ProjectRegistered(uint256 indexed projectId, address indexed projectAddress, bytes32 name);`
* `event DevRelAccountSet(address indexed account);`
* `event DaoHicVoterAdded(address indexed voter);`
* `event DaoHicVoterRemoved(address indexed voter);`
* `event Activated(uint64 startTime, uint64 endTime);`
* `event VotedDevRel(uint256 indexed projectId);`
* `event VotedDaoHic(address indexed voter, uint256 indexed projectId);`
* `event VotedCommunity(uint256 indexed tokenId, address indexed voter, uint256 indexed projectId);`
* `event ContractLockedForHistory(uint256 indexed winningProjectId);`

---

#### Init & Admin Functions

**`initialize(address pob_, uint256 iteration_, address initialOwner)`**
* Initialize contract, set PoB_01 NFT address, iteration number, transfer ownership.

---

**`registerProject(address projectAddress, bytes32 name) external onlyOwner`**
* Add new project (option to vote for).
* Revert if `projectsLocked == true` (after voting started).
* Increment `projectCount`, store `projectAddress[projectCount] = projectAddress`, `projectName[projectCount] = name`.
* Set `isRegisteredProject[projectAddress] = true`.
* Emit `ProjectRegistered(projectCount, projectAddress, name)`.

---

**`setDevRelAccount(address account) external onlyOwner`**
* Set/update DevRel voting account.
* If changed during voting, wipe previous vote: `devRelHasVoted = false`.
* Set `devRelAccount = account`.
* Emit `DevRelAccountSet(account)`.

---

**`addDaoHicVoter(address voter) external onlyOwner`**
* Add DAO_HIC voter to pool.
* Set `isDaoHicVoter[voter] = true`, push to `daoHicVoters` array.
* Emit `DaoHicVoterAdded(voter)`.

---

**`removeDaoHicVoter(address voter) external onlyOwner`**
* Remove DAO_HIC voter from pool.
* Set `isDaoHicVoter[voter] = false`, wipe vote: `daoHicHasVoted[voter] = false`.
* Remove from `daoHicVoters` array (swap & pop for gas efficiency).
* Emit `DaoHicVoterRemoved(voter)`.

---

**`activate(uint64 startTime_) external onlyOwner`**
* Activate voting window.
* Require:
  * `startTime == 0` (one-time activation)
  * `devRelAccount != address(0)` (DevRel registered)
  * `daoHicVoters.length >= 1` (at least 1 DAO_HIC voter)
  * `projectCount >= 1` (at least 1 project registered)
* Set `startTime = startTime_`, `endTime = startTime_ + 48 hours`.
* Set `projectsLocked = true` (no new projects after activation).
* Emit `Activated(startTime, endTime)`.

---

**`_authorizeUpgrade(address) internal override onlyOwner`**
* Allow owner to upgrade contract implementation.

---

#### View Functions (Public Getters)

**`isActive() public view returns (bool)`**
* `return startTime != 0 && block.timestamp >= startTime && block.timestamp <= endTime;`

---

**`votingEnded() public view returns (bool)`**
* `return startTime != 0 && block.timestamp > endTime;`

---

**`registeredNFT() public view returns (address)`**
* `return address(pob);`

---

**`isDevRelAccount(address account) public view returns (bool)`**
* `return account == devRelAccount;`

---

**`isDaoHicVoter(address account) public view returns (bool)`**
* Already exists as public mapping.

---

**`isRegisteredProject(address account) public view returns (bool)`**
* Already exists as public mapping.

---

**`getDevRelEntityVote() public view returns (uint256 projectId)`**
* Return DevRel's vote (0 if not voted).
* `return devRelHasVoted ? devRelVote : 0;`

---

**`getDaoHicEntityVote() public view returns (uint256 projectId)`**
* Calculate simple majority among DAO_HIC voters.
* Count votes per project.
* Return project with most votes (0 if tie or no votes).

---

**`getCommunityEntityVote() public view returns (uint256 projectId)`**
* Calculate simple majority among Community NFT holders.
* Iterate through voted tokenIds, count votes per project.
* Return project with most votes (0 if tie or no votes).

---

**`getWinner() public view returns (uint256 winningProjectId, bool hasWinner)`**
* Aggregate entity votes (DevRel, DAO_HIC, Community).
* Count how many entities voted for each project.
* Check entity quorum: at least 1 entity must vote.
* Return project with most entity votes (simple majority among 3 entities).
* `hasWinner = true` if clear winner; `false` if tie or no quorum.

---

**`getEntityVoteCounts() public view returns (uint256[3] memory entityVotes)`**
* Return `[devRelVote, daoHicEntityVote, communityEntityVote]` for transparency.

---

**`getDaoHicVoters() public view returns (address[] memory)`**
* Return `daoHicVoters` array.

---

#### Write Functions

**Community Voting (NFT-based):**

**`voteCommunity(uint256 tokenId, uint256 projectId) external`**
* Revert if `!isActive()` or `locked == true`.
* Revert if `projectId == 0 || projectId > projectCount`.
* Require `pob.ownerOf(tokenId) == msg.sender` (`NotOwner`)
* Require `pob.getRoleOf(tokenId) == "Community"` (`InvalidNFT`)
* Require `!communityHasVoted[tokenId]` (`AlreadyVoted` - prevents transferred NFT double-vote)
* Require `!communityAccountHasVoted[msg.sender]` (`AlreadyVoted` - prevents multi-NFT gaming)
* Set `communityVoteOf[tokenId] = projectId`
* Set `communityHasVoted[tokenId] = true`
* Set `communityAccountHasVoted[msg.sender] = true`
* Emit `VotedCommunity(tokenId, msg.sender, projectId)`

---

**DevRel Voting:**

**`voteDevRel(uint256 projectId) external`**
* Revert if `!isActive()` or `locked == true`.
* Revert if `msg.sender != devRelAccount`.
* Revert if `projectId == 0 || projectId > projectCount`.
* Revert if `isRegisteredProject[msg.sender]` (`ProjectCannotVote`)
* Set `devRelVote = projectId`, `devRelHasVoted = true`.
* Emit `VotedDevRel(projectId)`.

---

**DAO_HIC Voting:**

**`voteDaoHic(uint256 projectId) external`**
* Revert if `!isActive()` or `locked == true`.
* Revert if `!isDaoHicVoter[msg.sender]`.
* Revert if `projectId == 0 || projectId > projectCount`.
* Revert if `isRegisteredProject[msg.sender]` (`ProjectCannotVote`)
* Set `daoHicVoteOf[msg.sender] = projectId`, `daoHicHasVoted[msg.sender] = true`.
* Emit `VotedDaoHic(msg.sender, projectId)`.

---

**Winner Locking:**

**`lockContractForHistory() external onlyOwner`**
* Can only be called after voting ends (`block.timestamp > endTime`).
* Call `getWinner()` to determine winner.
* Revert if `!hasWinner` (tie or insufficient quorum).
* Set `locked = true` (contract now read-only for history).
* Emit `ContractLockedForHistory(winningProjectId)`.

---

## 5) Voting Logic & Quorum Rules

### Internal Pool Voting (DAO_HIC & Community)

* **Simple majority:** Project with most votes wins.
* **No minimum quorum:** Even 1 vote out of N can decide if others abstain.
* **Ties:** If tie, entity vote is null (returns 0).

### Entity-Level Voting

* **3 entities, 1 vote each:** DevRel, DAO_HIC, Community.
* **Entity quorum:** At least **1 entity** must vote for valid result.
* **Simple majority among entities:** Project with most entity votes (out of 3) wins.
* **Ties:** If 1-1-1 split or 0-0-0, no winner (`hasWinner = false`).

**Examples:**
* DevRel votes Project A, DAO_HIC votes Project A, Community abstains → **Winner: Project A** (2/3 entities)
* DevRel votes A, DAO_HIC votes B, Community abstains → **No winner** (1-1 tie)
* All 3 entities vote Project A → **Winner: Project A** (3/3 entities)
* No entities vote → **No winner** (entity quorum not met)

---

## 6) State Machine & Lifecycle

**Pre-Activation:**
1. Deploy PoB_01(iteration=1)
2. Deploy JurySC_01(pob, iteration=1)
3. Transfer PoB_01 ownership to JurySC_01
4. Owner registers projects via `registerProject(address, name)`
5. Owner sets DevRel account via `setDevRelAccount()`
6. Owner adds DAO_HIC voters via `addDaoHicVoter()`
7. **NOTE:** Badge minting timing varies by role (see Minting Windows below)

**Activation:**
8. Owner calls `activate(startTime)`.
   * Requires: ≥1 DevRel account, ≥1 DAO_HIC voter, ≥1 project.
   * Locks project list (no new projects).

**Voting Window (48 hours):**
9. DevRel votes via `voteDevRel()`.
10. DAO_HIC voters vote via `voteDaoHic()`.
11. Community NFT holders vote via `voteCommunity(tokenId, projectId)`.
12. Owner can still update DevRel/DAO_HIC accounts (votes wiped on change).

**Post-Voting:**
13. Voting window ends (`block.timestamp > endTime`).
14. Owner calls `lockContractForHistory()` if clear winner exists.
15. Community participants claim 30 SYS via `PoB_01.claim(tokenId)`.

**Locked State (if winner determined):**
* Contract is locked for history (`locked = true`).
* Only Community `claim()` operations allowed.
* No new voting, no new participants.
* NFTs remain as permanent badges of participation.

---

## 6.1) NFT Badge Minting Windows

**IMPORTANT:** Each role has different timing requirements for minting badges:

### Community Badge Minting
* **When:** Only during "Voting Active" period (`isActive() == true`)
* **Why:** Community participants need their NFT to vote
* **Enforcement:** `PoB_01.mint()` calls `jury.isActive()` and reverts if false
* **Deposit:** 30 SYS required
* **Flow:** Mint NFT → Vote with NFT → Claim deposit after voting ends

### DevRel Badge Minting
* **When:** Only after "Voting Ended" (`hasVotingEnded() == true`)
* **Why:** DevRel account is confirmed only after voting completes
* **Enforcement:** `PoB_01.mintDevRel()` calls `jury.hasVotingEnded()` and reverts if false
* **Deposit:** Free (commemorative badge)
* **Flow:** Vote directly (no NFT required) → Mint badge after voting ends

### DAO_HIC Badge Minting
* **When:** Only after "Voting Ended" (`hasVotingEnded() == true`)
* **Why:** DAO_HIC voter list is final only after voting completes
* **Enforcement:** `PoB_01.mintDaoHic()` calls `jury.hasVotingEnded()` and reverts if false
* **Deposit:** Free (commemorative badge)
* **Flow:** Vote directly (no NFT required) → Mint badge after voting ends

### Project Badge Minting
* **When:** Only after projects are locked (`projectsLocked() == true`)
* **Why:** Project list is locked when voting starts
* **Enforcement:** `PoB_01.mintProject()` calls `jury.projectsLocked()` and reverts if false
* **Deposit:** Free (commemorative badge)
* **Flow:** Get registered → Wait for voting to start → Mint badge anytime after

**Key Insight:** Community is the only role that mints BEFORE/DURING voting (because they need the NFT to vote). All other roles mint AFTER their participation window ends (as commemorative proof of participation).

**All roles can mint even after contract is locked** - badges remain available as historical proof of participation.

---

## 7) Security & Invariants

* **Invariant:** Exactly 30 SYS locked per Community participant NFT.
* **One NFT per account:** Silent duplicate prevention via `hasMinted` mapping.
* **Vote mutability:** Allowed only while `isActive() == true && locked == false`.
* **Community dual-check:** Prevents voting with multiple NFTs AND prevents same NFT voting twice if transferred.
* **Account changes:** DevRel/DAO_HIC accounts can change, but votes are wiped.
* **Projects cannot vote:** Explicitly blocked in voting functions.
* **Claims:** Self-service only, Community role only, no batch claims.
* **Reentrancy:** Guard `PoB_01.claim()`.
* **Upgrade safety:** Only JurySC_01 is upgradeable, PoB_01 is immutable.
* **Entity quorum:** Minimum 1 entity must vote for valid result.
* **Winner locking:** Once `locked = true`, contract is read-only (except claims).
* **Role verification:** PoB_01 queries JurySC_01 for role validation before special mints.

---

## 8) Acceptance Tests (happy path)

1. Deploy PoB_01(iteration=1), deploy JurySC_01(pob, iteration=1).
2. Transfer PoB_01 ownership to JurySC_01.
3. Owner registers 3 projects (addresses + names).
4. Owner sets DevRel account, adds 2 DAO_HIC voters.
5. **Badge minting:**
   - 5 Community users mint NFTs with 30 SYS deposits → receive "Community" badges.
   - DevRel account mints badge NFT → receives "DevRel" badge.
   - 2 DAO_HIC voters mint badge NFTs → receive "DAO-HIC" badges.
   - 3 Projects mint badge NFTs → receive "Project" badges.
6. Owner activates voting; projects are locked.
7. **Voting:**
   - DevRel votes for Project 1.
   - DAO_HIC voters split: 1 votes Project 1, 1 votes Project 2 → DAO_HIC entity vote = Project 1 (majority).
   - Community votes: 3 vote Project 1, 2 vote Project 2 → Community entity vote = Project 1 (majority).
8. **Result:** 3/3 entities vote Project 1 → **Winner: Project 1**.
9. Owner locks contract for history.
10. Community participants claim 30 SYS back via PoB_01.
11. Contract is permanently locked; only claims allowed.
12. All participants keep NFT badges showing iteration #1 and their role.

---

## 9) What NOT to add (v1 freeze)

* No vote delegation, no weighted voting, no quadratic voting.
* No batch operations (claims, votes).
* No pausable voting (owner updates allowed, but trusted).
* No slashing, no rewards beyond deposit return.
* No ERC721Enumerable (find NFTs via `Transfer` logs).
* No signature-based voting.
* No off-chain voting aggregation (all on-chain).
* No burning/transferring restrictions on NFTs (they're badges, fully transferable).

---

## 10) Changes from Previous Spec

### Removed:
* JurySC minting function (Community mints directly to PoB_01)
* ERC-20 token dependency (uses native SYS)
* Single-check voting (now dual-check for Community)

### Added:
* **NFT badge system** with iteration and role traits
* **4 participant roles** (Community, DevRel, DAO_HIC, Projects)
* **Special minting functions** for each role (mintDevRel, mintDaoHic, mintProject)
* **One NFT per account** across all roles (silent duplicate prevention)
* **Role-based minting** with JurySC_01 verification callback
* **Project participants** (can mint badge, cannot vote)
* **Community dual-check** (tokenId + account validation)
* **Iteration number** embedded in NFTs
* **Direct Community minting** to PoB_01 with native SYS
* **Claims in PoB_01** instead of JurySC_01
* **Getter functions** for role verification (isDevRelAccount, isDaoHicVoter, isRegisteredProject)
* **Commemorative badge system** (NFTs remain as proof of participation)

---

## 11) Migration Notes

Both `JurySC.sol` and `PoB_01.sol` contracts need **complete rewrite** to support:

**PoB_01 (NFT Badge Contract):**
* Iteration number storage and metadata
* Role-based trait system
* Four different minting functions (mint, mintDevRel, mintDaoHic, mintProject)
* JurySC_01 verification callbacks for special mints
* One NFT per account check (hasMinted mapping)
* Community claim function with native SYS withdrawal
* Role-based metadata in tokenURI

**JurySC_01 (Voting Contract):**
* Renamed from JurySC to JurySC_01
* Iteration number storage
* Project address registration (not just names)
* Getter functions for role verification
* Community dual-check voting (tokenId + account)
* Projects cannot vote restriction
* No more lockAndMint (Community mints to PoB_01 directly)
* No more claim (moved to PoB_01)

The existing test suite must be **completely rewritten** to test:
* Badge minting for all 4 roles
* Role verification callbacks
* One NFT per account enforcement
* Community dual-check voting
* Project vote restriction
* Iteration tracking
* Native SYS deposits and claims via PoB_01
