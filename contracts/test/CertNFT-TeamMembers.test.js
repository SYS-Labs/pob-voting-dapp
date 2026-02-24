import { expect } from "chai";
import pkg from "hardhat";

const { ethers, upgrades } = pkg;

describe("CertNFT - Team Members", function () {
  let certNFT;
  let mockMiddleware;
  let owner;
  let project1;
  let member1, member2, member3;
  let devRel;
  let nonProject;

  const ITERATION = 1;
  const TEMPLATE_CID = "QmTemplateCID123456789";

  beforeEach(async function () {
    [owner, project1, member1, member2, member3, devRel, nonProject] =
      await ethers.getSigners();

    const CertNFT = await ethers.getContractFactory("CertNFT");
    certNFT = await upgrades.deployProxy(CertNFT, [owner.address], {
      kind: "uups",
    });
    await certNFT.waitForDeployment();

    const MockCertGate = await ethers.getContractFactory("MockCertGate");
    mockMiddleware = await MockCertGate.deploy();
    await mockMiddleware.waitForDeployment();

    await certNFT.connect(owner).setMiddleware(ITERATION, await mockMiddleware.getAddress());

    await mockMiddleware.setEligible(project1.address, true, "participant");
    await mockMiddleware.setIsProject(project1.address, true);

    await mockMiddleware.setEligible(devRel.address, true, "participant");
    await mockMiddleware.setIsProject(devRel.address, false);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Get project1 to Stage 2 (cert Requested). Returns tokenId.
   *  Caller must ensure at least one named member exists before calling. */
  async function requestAndGetTokenId() {
    await certNFT.connect(project1).requestCert(ITERATION);
    return certNFT.certOf(project1.address, ITERATION);
  }

  /**
   * Cycle: propose member → name member → requestCert → approveTeamMember → cancelCert.
   * Returns to Stage 1 with `memberToApprove` having MemberStatus.Approved.
   * Returns the tokenId (now Cancelled).
   */
  async function setupStage1WithApprovedMember(memberToApprove) {
    await certNFT.connect(project1).proposeTeamMember(ITERATION, memberToApprove.address);
    await certNFT.connect(memberToApprove).setTeamMemberName(ITERATION, project1.address, "Seed Name");
    const tokenId = await requestAndGetTokenId();
    await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, memberToApprove.address);
    await certNFT.connect(owner).cancelCert(tokenId);
    return tokenId;
  }

  // ── proposeTeamMember ─────────────────────────────────────────────────────

  describe("proposeTeamMember", function () {
    it("project can propose a team member", async function () {
      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address)
      )
        .to.emit(certNFT, "TeamMemberProposed")
        .withArgs(ITERATION, project1.address, member1.address);

      const count = await certNFT.getTeamMemberCount(ITERATION, project1.address);
      expect(count).to.equal(1);

      const [addr, status, name] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(addr).to.equal(member1.address);
      expect(status).to.equal(0); // Proposed
      expect(name).to.equal("");
    });

    it("project can propose itself as a team member", async function () {
      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, project1.address)
      )
        .to.emit(certNFT, "TeamMemberProposed")
        .withArgs(ITERATION, project1.address, project1.address);

      const count = await certNFT.getTeamMemberCount(ITERATION, project1.address);
      expect(count).to.equal(1);
    });

    it("project can propose multiple members", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      const count = await certNFT.getTeamMemberCount(ITERATION, project1.address);
      expect(count).to.equal(2);
    });

    it("reverts for non-project caller", async function () {
      await expect(
        certNFT.connect(nonProject).proposeTeamMember(ITERATION, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "NotProjectForIteration");
    });

    it("reverts for duplicate member", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);

      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "MemberAlreadyExists");
    });

    it("reverts for address(0) member", async function () {
      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts when max members reached", async function () {
      for (let i = 0; i < 20; i++) {
        const addr = ethers.Wallet.createRandom().address;
        await certNFT.connect(project1).proposeTeamMember(ITERATION, addr);
      }

      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "TooManyMembers");
    });

    it("reverts when no middleware set", async function () {
      await expect(
        certNFT.connect(project1).proposeTeamMember(999, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "NoMiddleware");
    });

    it("reverts with WrongStage in Stage 2 (cert Requested)", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).requestCert(ITERATION);

      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });

    it("succeeds in Stage 1 after cancelled cert", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      const tokenId = await requestAndGetTokenId();
      await certNFT.connect(owner).cancelCert(tokenId);

      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address)
      ).to.emit(certNFT, "TeamMemberProposed");
    });
  });

  // ── approveTeamMember ─────────────────────────────────────────────────────

  describe("approveTeamMember", function () {
    let tokenId;

    beforeEach(async function () {
      // Stage 2: propose, name, then request cert
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      tokenId = await requestAndGetTokenId();
    });

    it("owner can approve a proposed member (Stage 2)", async function () {
      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      )
        .to.emit(certNFT, "TeamMemberApproved")
        .withArgs(ITERATION, project1.address, member1.address);

      const [, status] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(status).to.equal(1); // Approved

      expect(await certNFT.approvedMemberCount(ITERATION, project1.address)).to.equal(1);
    });

    it("reverts for non-owner", async function () {
      await expect(
        certNFT.connect(project1).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.reverted;
    });

    it("reverts for non-existent member (Stage 2)", async function () {
      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts for already approved member (Stage 2)", async function () {
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts for already rejected member (Stage 2)", async function () {
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts with WrongStage in Stage 1 (no cert)", async function () {
      // Cancel cert to go back to Stage 1
      await certNFT.connect(owner).cancelCert(tokenId);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });

    it("reverts with WrongStage in Stage 3 (cert Pending)", async function () {
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      // Approve cert → Stage 3
      await certNFT.connect(owner).approveCert(tokenId);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });
  });

  // ── rejectTeamMember ──────────────────────────────────────────────────────

  describe("rejectTeamMember", function () {
    let tokenId;

    beforeEach(async function () {
      // Stage 2: propose, name, then request cert
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      tokenId = await requestAndGetTokenId();
    });

    it("owner can reject a proposed member (Stage 2)", async function () {
      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      )
        .to.emit(certNFT, "TeamMemberRejected")
        .withArgs(ITERATION, project1.address, member1.address);

      const [, status] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(status).to.equal(2); // Rejected

      expect(await certNFT.approvedMemberCount(ITERATION, project1.address)).to.equal(0);
    });

    it("reverts for non-owner", async function () {
      await expect(
        certNFT.connect(project1).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.reverted;
    });

    it("reverts for non-existent member (Stage 2)", async function () {
      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts for already processed member (Stage 2)", async function () {
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);

      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("decrements namedMemberCount when rejecting a named proposed member", async function () {
      // beforeEach: member1 proposed, cert requested (Stage 2)
      // Cancel to go back to Stage 1, set name, then resubmit to Stage 2
      await certNFT.connect(owner).cancelCert(tokenId);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);

      await certNFT.connect(project1).resubmitCert(tokenId); // Stage 2

      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.emit(certNFT, "TeamMemberRejected");

      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(0);
    });

    it("hasNamedTeamMembers becomes false when last named member is rejected", async function () {
      // beforeEach: member1 proposed, cert requested (Stage 2)
      // Cancel, propose member2, set names, resubmit
      await certNFT.connect(owner).cancelCert(tokenId);

      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob");
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(2);
      expect(await certNFT.hasNamedTeamMembers(ITERATION, project1.address)).to.be.true;

      await certNFT.connect(project1).resubmitCert(tokenId); // Stage 2

      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);

      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member2.address);
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(0);
      expect(await certNFT.hasNamedTeamMembers(ITERATION, project1.address)).to.be.false;
    });

    it("reverts with WrongStage in Stage 1 (no cert)", async function () {
      await certNFT.connect(owner).cancelCert(tokenId);

      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });
  });

  // ── removeTeamMember ──────────────────────────────────────────────────────

  describe("removeTeamMember", function () {
    it("project can remove a Proposed member in Stage 1", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      await expect(
        certNFT.connect(project1).removeTeamMember(ITERATION, member1.address)
      )
        .to.emit(certNFT, "TeamMemberRemoved")
        .withArgs(ITERATION, project1.address, member1.address);

      expect(await certNFT.getTeamMemberCount(ITERATION, project1.address)).to.equal(1);
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member1.address)).to.equal(0);
    });

    it("swap-and-pop preserves index of last member", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member3.address);

      // Remove member1 (index 0) — member3 swaps into its slot
      await certNFT.connect(project1).removeTeamMember(ITERATION, member1.address);

      expect(await certNFT.getTeamMemberCount(ITERATION, project1.address)).to.equal(2);
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member1.address)).to.equal(0); // deleted
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member3.address)).to.equal(1); // moved to slot 0 (idx+1=1)
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member2.address)).to.equal(2); // unchanged
    });

    it("reverts for non-existent member", async function () {
      await expect(
        certNFT.connect(project1).removeTeamMember(ITERATION, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("can remove an Approved member in Stage 1, decrements approvedMemberCount", async function () {
      await setupStage1WithApprovedMember(member1);
      // member1 is now Approved, cert is Cancelled (Stage 1)
      expect(await certNFT.approvedMemberCount(ITERATION, project1.address)).to.equal(1);

      await expect(
        certNFT.connect(project1).removeTeamMember(ITERATION, member1.address)
      )
        .to.emit(certNFT, "TeamMemberRemoved")
        .withArgs(ITERATION, project1.address, member1.address);

      expect(await certNFT.approvedMemberCount(ITERATION, project1.address)).to.equal(0);
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member1.address)).to.equal(0);
    });

    it("namedMemberCount decremented when named member is removed", async function () {
      // Propose member1, set name while Proposed (no approval required)
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);

      await certNFT.connect(project1).removeTeamMember(ITERATION, member1.address);
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(0);
    });

    it("reverts with WrongStage in Stage 2 (cert Requested)", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).requestCert(ITERATION);

      await expect(
        certNFT.connect(project1).removeTeamMember(ITERATION, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });

    it("succeeds in Stage 1 after cancelled cert", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      const tokenId = await requestAndGetTokenId();
      await certNFT.connect(owner).cancelCert(tokenId);

      // member1 is Proposed, cert is Cancelled → Stage 1
      await expect(
        certNFT.connect(project1).removeTeamMember(ITERATION, member1.address)
      ).to.emit(certNFT, "TeamMemberRemoved");
    });
  });

  // ── setTeamMemberName ─────────────────────────────────────────────────────

  describe("setTeamMemberName", function () {
    let firstTokenId;

    beforeEach(async function () {
      // Cycle: propose → requestCert → approve → cancelCert
      // Result: member1 is Approved, cert is Cancelled (Stage 1)
      firstTokenId = await setupStage1WithApprovedMember(member1);
    });

    it("approved member can set their name (Stage 1)", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice Builder")
      )
        .to.emit(certNFT, "TeamMemberNameSet")
        .withArgs(ITERATION, project1.address, member1.address, "Alice Builder");

      const [, , name] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(name).to.equal("Alice Builder");

      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);
    });

    it("name is re-editable in Stage 1 (not immutable)", async function () {
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice Builder");

      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice Updated")
      ).to.emit(certNFT, "TeamMemberNameSet");

      const [, , name] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(name).to.equal("Alice Updated");
    });

    it("namedMemberCount only increments on first name set", async function () {
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);

      // Updating does not increment count again
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice v2");
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);
    });

    it("reverts with WrongStage in Stage 2 (cert Requested)", async function () {
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      // Resubmit → Stage 2
      await certNFT.connect(project1).resubmitCert(firstTokenId);

      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice v2")
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });

    it("proposed member can set their name (no approval required)", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      // member2 is Proposed (not yet Approved) — should succeed

      await expect(
        certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob")
      )
        .to.emit(certNFT, "TeamMemberNameSet")
        .withArgs(ITERATION, project1.address, member2.address, "Bob");

      // member1 already named by setupStage1WithApprovedMember + member2 = 2
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(2);
    });

    it("reverts for rejected member", async function () {
      // Propose member2 in Stage 1, then do a resubmit cycle to reject them
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(project1).resubmitCert(firstTokenId); // → Stage 2
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member2.address);
      await certNFT.connect(owner).cancelCert(firstTokenId); // → Stage 1

      await expect(
        certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob")
      ).to.be.revertedWithCustomError(certNFT, "MemberNotApproved");
    });

    it("reverts for non-team-member", async function () {
      await expect(
        certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob")
      ).to.be.revertedWithCustomError(certNFT, "NotTeamMember");
    });

    it("reverts with empty name", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "")
      ).to.be.revertedWithCustomError(certNFT, "EmptyName");
    });

    it("reverts with name too long", async function () {
      const longName = "A".repeat(65);
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, longName)
      ).to.be.revertedWithCustomError(certNFT, "NameTooLong");
    });

    it("accepts name at exactly max length", async function () {
      const maxName = "A".repeat(64);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, maxName);

      const [, , name] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(name).to.equal(maxName);
    });

    it("reverts with name containing double quote", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, 'Alice "Builder"')
      ).to.be.revertedWithCustomError(certNFT, "NameContainsInvalidBytes");
    });

    it("reverts with name containing backslash", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice\\Builder")
      ).to.be.revertedWithCustomError(certNFT, "NameContainsInvalidBytes");
    });

    it("reverts with name containing control character", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice\nBuilder")
      ).to.be.revertedWithCustomError(certNFT, "NameContainsInvalidBytes");
    });

    it("reverts with name containing null byte", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice\x00Builder")
      ).to.be.revertedWithCustomError(certNFT, "NameContainsInvalidBytes");
    });
  });

  // ── requestCert integration ───────────────────────────────────────────────

  describe("requestCert integration", function () {
    it("project cannot request cert without named team members", async function () {
      await expect(
        certNFT.connect(project1).requestCert(ITERATION)
      ).to.be.revertedWithCustomError(certNFT, "NoNamedTeamMembers");
    });

    it("project can request cert after naming at least one member", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");

      await expect(
        certNFT.connect(project1).requestCert(ITERATION)
      ).to.emit(certNFT, "CertRequested");
    });

    it("non-project callers (DevRel) are not affected by team member logic", async function () {
      await expect(
        certNFT.connect(devRel).requestCert(ITERATION)
      )
        .to.emit(certNFT, "CertRequested")
        .withArgs(1, ITERATION, devRel.address, "participant");
    });

    it("resubmitCert reverts with NoNamedTeamMembers after named count drops to zero", async function () {
      // Propose + name member1, request cert
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(project1.address, ITERATION);

      // Reject the named member (decrements namedMemberCount)
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(0);

      // Cancel cert → Stage 1
      await certNFT.connect(owner).cancelCert(tokenId);

      // Resubmit should fail — no named members remain
      await expect(
        certNFT.connect(project1).resubmitCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NoNamedTeamMembers");
    });

    it("resubmitCert succeeds when at least one named member remains", async function () {
      // Propose + name two members, request cert
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob");
      await certNFT.connect(project1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(project1.address, ITERATION);

      // Reject one named member
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);
      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);

      // Cancel cert → Stage 1
      await certNFT.connect(owner).cancelCert(tokenId);

      // Resubmit should succeed — member2 is still named
      await expect(
        certNFT.connect(project1).resubmitCert(tokenId)
      ).to.emit(certNFT, "CertResubmitted");
    });

    it("approveCert reverts when a project has no approved team members", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(project1.address, ITERATION);

      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);
      expect(await certNFT.approvedMemberCount(ITERATION, project1.address)).to.equal(0);

      await expect(
        certNFT.connect(owner).approveCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NoApprovedTeamMembers");
    });
  });

  // ── lifecycle stage enforcement ───────────────────────────────────────────

  describe("lifecycle stage enforcement", function () {
    it("proposeTeamMember blocked in Stage 2 (WrongStage)", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).requestCert(ITERATION);

      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });

    it("approveTeamMember blocked in Stage 1 (no cert) with WrongStage", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });

    it("approveTeamMember allowed in Stage 2 for pending member", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(project1).requestCert(ITERATION);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member2.address)
      ).to.emit(certNFT, "TeamMemberApproved");
    });

    it("setTeamMemberName blocked in Stage 2 (WrongStage)", async function () {
      const tokenId = await setupStage1WithApprovedMember(member1);
      await certNFT.connect(project1).resubmitCert(tokenId); // → Stage 2

      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice")
      ).to.be.revertedWithCustomError(certNFT, "WrongStage");
    });

    it("rejectTeamMember allowed in Stage 2", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(project1).requestCert(ITERATION);

      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.emit(certNFT, "TeamMemberRejected");
    });
  });

  // ── view functions ────────────────────────────────────────────────────────

  describe("view functions", function () {
    it("getTeamMembers returns full array", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      const members = await certNFT.getTeamMembers(ITERATION, project1.address);
      expect(members.length).to.equal(2);
      expect(members[0].memberAddress).to.equal(member1.address);
      expect(members[1].memberAddress).to.equal(member2.address);
    });

    it("getTeamMembers returns empty array for no members", async function () {
      const members = await certNFT.getTeamMembers(ITERATION, project1.address);
      expect(members.length).to.equal(0);
    });

    it("getTeamMemberCount returns correct count", async function () {
      expect(await certNFT.getTeamMemberCount(ITERATION, project1.address)).to.equal(0);

      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      expect(await certNFT.getTeamMemberCount(ITERATION, project1.address)).to.equal(1);

      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      expect(await certNFT.getTeamMemberCount(ITERATION, project1.address)).to.equal(2);
    });

    it("getTeamMember reverts for out-of-bounds index", async function () {
      await expect(
        certNFT.getTeamMember(ITERATION, project1.address, 0)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("hasNamedTeamMembers returns false when no named members", async function () {
      expect(await certNFT.hasNamedTeamMembers(ITERATION, project1.address)).to.be.false;

      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      expect(await certNFT.hasNamedTeamMembers(ITERATION, project1.address)).to.be.false;
    });

    it("hasNamedTeamMembers returns true after name set", async function () {
      const tokenId = await setupStage1WithApprovedMember(member1);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");

      expect(await certNFT.hasNamedTeamMembers(ITERATION, project1.address)).to.be.true;
    });

    it("teamMemberIndex tracks correctly", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member1.address)).to.equal(1);
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member2.address)).to.equal(2);
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member3.address)).to.equal(0);
    });
  });

  // ── tokenURI with team members ────────────────────────────────────────────

  describe("tokenURI with team members", function () {
    /**
     * Full lifecycle: propose → requestCert → approve/reject members (Stage 2)
     * → cancelCert → setNames (Stage 1) → resubmitCert → tokenURI works.
     *
     * membersConfig: [{ member, action: 'approve'|'reject'|'skip', name?: string }]
     * Returns the tokenId.
     */
    async function setupProjectWithNamedMembers(membersConfig) {
      // Phase 1: propose all members and name the first one (Stage 1)
      for (const { member } of membersConfig) {
        await certNFT.connect(project1).proposeTeamMember(ITERATION, member.address);
      }
      // Name at least one member so requestCert passes the guard
      const first = membersConfig.find(c => c.name);
      if (first) {
        await certNFT.connect(first.member).setTeamMemberName(ITERATION, project1.address, "Temp");
      }

      // Phase 2: request cert → Stage 2
      const tokenId = await requestAndGetTokenId();

      // Phase 3: approve/reject in Stage 2
      for (const { member, action } of membersConfig) {
        if (action === "approve") {
          await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member.address);
        } else if (action === "reject") {
          await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member.address);
        }
      }

      // Phase 4: cancel → Stage 1
      await certNFT.connect(owner).cancelCert(tokenId);

      // Phase 5: approved members set names (Stage 1)
      for (const { member, action, name } of membersConfig) {
        if (action === "approve" && name) {
          await certNFT.connect(member).setTeamMemberName(ITERATION, project1.address, name);
        }
      }

      // Phase 6: resubmit → Stage 2 (cert now Requested, tokenId reused)
      await certNFT.connect(project1).resubmitCert(tokenId);

      return tokenId;
    }

    it("includes teamMembers array with approved names", async function () {
      const tokenId = await setupProjectWithNamedMembers([
        { member: member1, action: "approve", name: "Alice" },
        { member: member2, action: "approve", name: "Bob" },
      ]);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.deep.equal(["Alice", "Bob"]);
    });

    it("excludes rejected members from teamMembers", async function () {
      const tokenId = await setupProjectWithNamedMembers([
        { member: member1, action: "approve", name: "Alice" },
        { member: member2, action: "reject", name: null },
        { member: member3, action: "approve", name: "Charlie" },
      ]);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.deep.equal(["Alice", "Charlie"]);
    });

    it("excludes approved members without name set", async function () {
      const tokenId = await setupProjectWithNamedMembers([
        { member: member1, action: "approve", name: "Alice" },
        { member: member2, action: "approve", name: null }, // approved but no name set
      ]);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.deep.equal(["Alice"]);
    });

    it("no teamMembers field for non-project certs", async function () {
      await certNFT.connect(devRel).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(devRel.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.be.undefined;
    });

    it("no teamMembers field when all proposed but none named", async function () {
      await certNFT.connect(devRel).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(devRel.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.be.undefined;
    });
  });
});
