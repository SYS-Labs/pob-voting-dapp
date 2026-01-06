# PoB v1 — Role Isolation Specification

**Version:** 1.0
**Date:** 2026-01-03
**Status:** Implemented
**Contracts:** JurySC_02.sol, PoB_02.sol

---

## 1) Core Principle

**One role per address per iteration.**

An address can hold exactly ONE role at any given time within an iteration:
- **Community** (mints during active voting, pays 30 SYS)
- **DevRel** (set by owner, votes directly)
- **DAO_HIC** (added by owner, votes directly)
- **Project** (registered by owner, cannot vote)

Once assigned a role, the address **cannot** be assigned to any other role for that iteration.

---

## 2) Timeline & Role Assignment Windows

### 2.1) Phase Breakdown

| Phase | Trigger | Projects | DevRel | DAO_HIC | Community |
|-------|---------|----------|--------|---------|-----------|
| **Pre-Activation** | Before `activate()` | ✅ Can add/remove | ✅ Can set | ✅ Can add/remove | ❌ Cannot mint |
| **Activation** | `activate()` called | 🔒 LOCKED | ✅ Can change | ✅ Can change | ❌ Cannot mint |
| **Active Voting** | `startTime` ≤ now ≤ `endTime` | 🔒 LOCKED | ✅ Can change | ✅ Can change | ✅ **CAN MINT** |
| **Post-Voting** | After `endTime` | 🔒 LOCKED | 🔒 LOCKED | 🔒 LOCKED | 🔒 LOCKED |

### 2.2) Key Timing Constraints

1. **Projects lock FIRST** (at activation)
   - Projects must be finalized before voting starts
   - No new projects can be added during voting

2. **Community role assigned LAST** (during active voting)
   - By the time Community can mint, Projects are already locked
   - By the time Community can mint, DevRel and DAO_HIC should already be set

3. **Conflict Windows:**
   - **Pre-Activation**: Admin can accidentally create conflicts between Project/DevRel/DAO_HIC
   - **Active Voting**: Admin can accidentally create conflicts when changing DevRel/DAO_HIC while Community is minting

---

## 3) Role Conflict Rules

### 3.1) Scenario: Adding Projects

**Function:** `JurySC_02.registerProject(address)`
**Available:** Pre-Activation only (before `activate()`)

| If address is... | Can add as Project? | Reason |
|-----------------|---------------------|--------|
| None (no role) | ✅ Yes | Clean state |
| DevRel | ❌ **BLOCK** | DevRel cannot be judged as Project |
| DAO_HIC voter | ❌ **BLOCK** | DAO_HIC cannot be judged as Project |
| Community | N/A (Impossible*) | Projects lock before Community can mint |
| Already Project | ✅ Already registered | Duplicate check (existing) |

\* *Community can only mint during active voting, which happens AFTER projects are locked*

**Required Checks:**
```solidity
require(devRelAccount != projectAddress_, "Project cannot be DevRel");
require(!isDaoHicVoter[projectAddress_], "Project cannot be DAO_HIC voter");
```

---

### 3.2) Scenario: Setting DevRel Account

**Function:** `JurySC_02.setDevRelAccount(address)`
**Available:** Pre-Activation or during Active Voting (until `votingEnded()`)

| If address is... | Can set as DevRel? | Reason |
|-----------------|-------------------|--------|
| None (no role) | ✅ Yes | Clean state |
| Project | ❌ **BLOCK** | Project cannot judge itself |
| DAO_HIC voter | ❌ **BLOCK** | Cannot hold two voting roles |
| Community | ❌ **BLOCK** | Cannot hold two voting roles |
| Already DevRel | ✅ Update | Replacing existing (vote wiped) |

**Required Checks:**
```solidity
if (isRegisteredProject[account]) revert DevRelCannotBeProject();
if (isDaoHicVoter[account]) revert DevRelCannotBeDaoHic();
if (pob.hasMintedBadge(account)) revert DevRelCannotBeCommunity();
```

---

### 3.3) Scenario: Adding DAO_HIC Voters

**Function:** `JurySC_02.addDaoHicVoter(address)`
**Available:** Pre-Activation or during Active Voting (until `votingEnded()`)

| If address is... | Can add as DAO_HIC? | Reason |
|-----------------|---------------------|--------|
| None (no role) | ✅ Yes | Clean state |
| Project | ❌ **BLOCK** | Project cannot judge itself |
| DevRel | ❌ **BLOCK** | Cannot hold two voting roles |
| Community | ❌ **BLOCK** | Cannot hold two voting roles |
| Already DAO_HIC | ✅ Already added | Silent no-op (existing) |

**Required Checks:**
```solidity
if (devRelAccount == voter) revert DaoHicCannotBeDevRel();
if (isRegisteredProject[voter]) revert DaoHicCannotBeProject();
if (pob.hasMintedBadge(voter)) revert DaoHicCannotBeCommunity();
```

---

### 3.4) Scenario: Minting Community Badge

**Function:** `PoB_02.mint()`
**Available:** During Active Voting only (`isActive() == true`)

| If address is... | Can mint Community? | Reason |
|-----------------|---------------------|--------|
| None (no role) | ✅ Yes | Pay 30 SYS to participate |
| DevRel | ❌ **BLOCK** | DevRel votes directly, no deposit needed |
| DAO_HIC voter | ❌ **BLOCK** | DAO_HIC votes directly, no deposit needed |
| Project | ✅ Already blocked | Existing check (line 299 in JurySC) |
| Already Community | ✅ Already blocked | Existing check (`hasMinted`) |

**Required Checks:**
```solidity
// In PoB_02.mint(), after jury.isActive() check
if (jury.isDevRelAccount(msg.sender)) revert CannotMintAsDevRel();
if (jury.isDaoHicVoter(msg.sender)) revert CannotMintAsDaoHic();
```

---

## 4) Implementation Details

### 4.1) JurySC_02.sol

#### Error Declarations (lines 82-90)

```solidity
// Role isolation errors
error ProjectCannotBeDevRel();
error ProjectCannotBeDaoHic();
error DevRelCannotBeProject();
error DevRelCannotBeDaoHic();
error DevRelCannotBeCommunity();
error DaoHicCannotBeDevRel();
error DaoHicCannotBeProject();
error DaoHicCannotBeCommunity();
```

#### Function: `registerProject(address projectAddress_)` (lines 130-145)

```solidity
if (devRelAccount == projectAddress_) revert ProjectCannotBeDevRel();
if (isDaoHicVoter[projectAddress_]) revert ProjectCannotBeDaoHic();
```

#### Function: `setDevRelAccount(address account)` (lines 175-189)

```solidity
if (isRegisteredProject[account]) revert DevRelCannotBeProject();
if (isDaoHicVoter[account]) revert DevRelCannotBeDaoHic();
if (pob.hasMintedBadge(account)) revert DevRelCannotBeCommunity();
```

#### Function: `addDaoHicVoter(address voter)` (lines 195-206)

```solidity
if (devRelAccount == voter) revert DaoHicCannotBeDevRel();
if (isRegisteredProject[voter]) revert DaoHicCannotBeProject();
if (pob.hasMintedBadge(voter)) revert DaoHicCannotBeCommunity();
```

---

### 4.2) PoB_02.sol

#### Error Declarations (lines 54-55)

```solidity
// Community minting restriction errors
error CannotMintAsDevRel();
error CannotMintAsDaoHic();
```

#### View Function: `hasMintedBadge(address)` (lines 236-238)

```solidity
function hasMintedBadge(address account) external view returns (bool) {
    return hasMinted[account];
}
```

#### Function: `mint()` (lines 80-107)

Role isolation checks at lines 90-91:
```solidity
if (jury.isDevRelAccount(msg.sender)) revert CannotMintAsDevRel();
if (jury.isDaoHicVoter(msg.sender)) revert CannotMintAsDaoHic();
```

**Dependencies:**
- `jury.isDevRelAccount(address)` - JurySC_02 line 432-434
- `jury.isDaoHicVoter[address]` - JurySC_02 line 49 (public mapping)

---

## 5) Testing Requirements

### 5.1) Test File: `test/JurySC_02.test.js`

Add test suite "Role Isolation" with 11 test cases:

#### Projects Conflict Tests
```javascript
it("Should reject adding Project if address is DevRel", async function () {
  await jury.setDevRelAccount(addr1.address);
  await expect(jury.registerProject(addr1.address))
    .to.be.revertedWithCustomError(jury, "ProjectCannotBeDevRel");
});

it("Should reject adding Project if address is DAO_HIC voter", async function () {
  await jury.addDaoHicVoter(addr1.address);
  await expect(jury.registerProject(addr1.address))
    .to.be.revertedWithCustomError(jury, "ProjectCannotBeDaoHic");
});
```

#### DevRel Conflict Tests
```javascript
it("Should reject setting DevRel if address is Project", async function () {
  await jury.registerProject(addr1.address);
  await expect(jury.setDevRelAccount(addr1.address))
    .to.be.revertedWithCustomError(jury, "DevRelCannotBeProject");
});

it("Should reject setting DevRel if address is DAO_HIC voter", async function () {
  await jury.addDaoHicVoter(addr1.address);
  await expect(jury.setDevRelAccount(addr1.address))
    .to.be.revertedWithCustomError(jury, "DevRelCannotBeDaoHic");
});

it("Should reject setting DevRel if address has Community badge", async function () {
  await jury.activate();
  await time.increase(1); // Enter active voting
  await pob.connect(addr1).mint({ value: COMMUNITY_DEPOSIT });
  await expect(jury.setDevRelAccount(addr1.address))
    .to.be.revertedWithCustomError(jury, "DevRelCannotBeCommunity");
});
```

#### DAO_HIC Conflict Tests
```javascript
it("Should reject adding DAO_HIC if address is DevRel", async function () {
  await jury.setDevRelAccount(addr1.address);
  await expect(jury.addDaoHicVoter(addr1.address))
    .to.be.revertedWithCustomError(jury, "DaoHicCannotBeDevRel");
});

it("Should reject adding DAO_HIC if address is Project", async function () {
  await jury.registerProject(addr1.address);
  await expect(jury.addDaoHicVoter(addr1.address))
    .to.be.revertedWithCustomError(jury, "DaoHicCannotBeProject");
});

it("Should reject adding DAO_HIC if address has Community badge", async function () {
  await jury.activate();
  await time.increase(1); // Enter active voting
  await pob.connect(addr1).mint({ value: COMMUNITY_DEPOSIT });
  await expect(jury.addDaoHicVoter(addr1.address))
    .to.be.revertedWithCustomError(jury, "DaoHicCannotBeCommunity");
});
```

#### Community Minting Conflict Tests
```javascript
it("Should reject Community mint if address is DevRel", async function () {
  await jury.setDevRelAccount(addr1.address);
  await jury.activate();
  await time.increase(1); // Enter active voting
  await expect(pob.connect(addr1).mint({ value: COMMUNITY_DEPOSIT }))
    .to.be.revertedWithCustomError(pob, "CannotMintAsDevRel");
});

it("Should reject Community mint if address is DAO_HIC voter", async function () {
  await jury.addDaoHicVoter(addr1.address);
  await jury.activate();
  await time.increase(1); // Enter active voting
  await expect(pob.connect(addr1).mint({ value: COMMUNITY_DEPOSIT }))
    .to.be.revertedWithCustomError(pob, "CannotMintAsDaoHic");
});

it("Should reject Community mint if address is Project (existing test)", async function () {
  // This test already exists - verifies line 317 in JurySC_02
  await jury.registerProject(addr1.address);
  await jury.activate();
  await time.increase(1);
  await expect(
    pob.connect(addr1).mint({ value: COMMUNITY_DEPOSIT })
  ).to.be.revertedWithCustomError(jury, "ProjectCannotVote");
});
```

---

## 6) Security Impact

### 6.1) Risk Assessment

**Without Implementation:**
- 🟡 **MEDIUM RISK** — Addresses could hold multiple roles simultaneously
- ⚠️ **Vote Manipulation** — Could vote multiple times as different entities
- ⚠️ **Badge Gaming** — Could receive multiple badges for same iteration
- ⚠️ **Design Violation** — Core "one role per address" principle not enforced

**After Implementation:**
- 🟢 **LOW RISK** — Design constraint enforced at contract level
- ✅ **Prevention** — Impossible to assign conflicting roles
- ✅ **Transparency** — Clear error messages explain violations
- ✅ **Consistency** — All role assignment paths protected

---

## 7) Implementation Checklist

- [x] Add 8 new error definitions to JurySC_02.sol (lines 82-90)
- [x] Add 2 new error definitions to PoB_02.sol (lines 54-55)
- [x] Add `hasMintedBadge(address)` view function to PoB_02.sol (lines 236-238)
- [x] Add role conflict checks to `registerProject()` (lines 134-135)
- [x] Add role conflict checks to `setDevRelAccount()` (lines 177-179)
- [x] Add role conflict checks to `addDaoHicVoter()` (lines 197-199)
- [x] Add role conflict checks to `mint()` in PoB_02 (lines 90-91)
- [ ] Write 11 new test cases for role conflicts
- [ ] Run full test suite (`npx hardhat test`)
- [ ] Compile contracts (`npx hardhat compile`)

---

## 8) References

- **Main Spec:** `/sandbox/docs/smart_contract_specs.md`
- **Implementation:** `contracts/contracts/JurySC_02.sol`, `contracts/contracts/PoB_02.sol`
- **Documentation:** CLAUDE.md (role isolation model)
- **Tests:** `contracts/test/JurySC_02.test.js`, `contracts/test/PoB_02.test.js`

---

**Specification Status:** Implemented in contracts
**Next Step:** Write test cases for role conflict scenarios
