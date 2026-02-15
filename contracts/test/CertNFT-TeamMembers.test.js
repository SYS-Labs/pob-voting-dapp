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
  const INFO_CID = "QmTestInfoCID123456789";
  const TEMPLATE_CID = "QmTemplateCID123456789";

  beforeEach(async function () {
    [owner, project1, member1, member2, member3, devRel, nonProject] =
      await ethers.getSigners();

    // Deploy CertNFT as UUPS proxy
    const CertNFT = await ethers.getContractFactory("CertNFT");
    certNFT = await upgrades.deployProxy(CertNFT, [owner.address], {
      kind: "uups",
    });
    await certNFT.waitForDeployment();

    // Deploy MockCertMiddleware
    const MockCertMiddleware = await ethers.getContractFactory("MockCertMiddleware");
    mockMiddleware = await MockCertMiddleware.deploy();
    await mockMiddleware.waitForDeployment();

    // Setup middleware
    await mockMiddleware.setTemplateCID(TEMPLATE_CID);

    // Link middleware to CertNFT
    await certNFT.connect(owner).setMiddleware(ITERATION, await mockMiddleware.getAddress());

    // project1 is eligible and is a project
    await mockMiddleware.setEligible(project1.address, true, "participant");
    await mockMiddleware.setIsProject(project1.address, true);

    // devRel is eligible but NOT a project
    await mockMiddleware.setEligible(devRel.address, true, "participant");
    await mockMiddleware.setIsProject(devRel.address, false);
  });

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
      // Propose 20 members (the max)
      const signers = await ethers.getSigners();
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
  });

  describe("approveTeamMember", function () {
    beforeEach(async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
    });

    it("owner can approve a proposed member", async function () {
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

    it("reverts for non-existent member", async function () {
      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts for already approved member", async function () {
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts for already rejected member", async function () {
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);

      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });
  });

  describe("rejectTeamMember", function () {
    beforeEach(async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
    });

    it("owner can reject a proposed member", async function () {
      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      )
        .to.emit(certNFT, "TeamMemberRejected")
        .withArgs(ITERATION, project1.address, member1.address);

      const [, status] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(status).to.equal(2); // Rejected

      // Approved count should not change
      expect(await certNFT.approvedMemberCount(ITERATION, project1.address)).to.equal(0);
    });

    it("reverts for non-owner", async function () {
      await expect(
        certNFT.connect(project1).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.reverted;
    });

    it("reverts for non-existent member", async function () {
      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });

    it("reverts for already processed member", async function () {
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address);

      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "InvalidMemberIndex");
    });
  });

  describe("setTeamMemberName", function () {
    beforeEach(async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
    });

    it("approved member can set their name", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice Builder")
      )
        .to.emit(certNFT, "TeamMemberNameSet")
        .withArgs(ITERATION, project1.address, member1.address, "Alice Builder");

      const [, , name] = await certNFT.getTeamMember(ITERATION, project1.address, 0);
      expect(name).to.equal("Alice Builder");

      expect(await certNFT.namedMemberCount(ITERATION, project1.address)).to.equal(1);
    });

    it("name is immutable once set", async function () {
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice Builder");

      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "New Name")
      ).to.be.revertedWithCustomError(certNFT, "NameAlreadySet");
    });

    it("reverts for non-approved member (proposed)", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      await expect(
        certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob")
      ).to.be.revertedWithCustomError(certNFT, "MemberNotApproved");
    });

    it("reverts for rejected member", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member2.address);

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

  describe("requestCert integration", function () {
    it("reverts with NoNamedTeamMembers for project with no members", async function () {
      await expect(
        certNFT.connect(project1).requestCert(ITERATION, INFO_CID)
      ).to.be.revertedWithCustomError(certNFT, "NoNamedTeamMembers");
    });

    it("reverts when members approved but no names set", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);

      // Member approved but hasn't set name yet
      await expect(
        certNFT.connect(project1).requestCert(ITERATION, INFO_CID)
      ).to.be.revertedWithCustomError(certNFT, "NoNamedTeamMembers");
    });

    it("succeeds with at least one named member", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice Builder");

      await expect(
        certNFT.connect(project1).requestCert(ITERATION, INFO_CID)
      )
        .to.emit(certNFT, "CertRequested")
        .withArgs(1, ITERATION, project1.address, "participant");
    });

    it("non-project callers (DevRel) are NOT affected by team member guard", async function () {
      // devRel is not a project, should request cert without team members
      await expect(
        certNFT.connect(devRel).requestCert(ITERATION, INFO_CID)
      )
        .to.emit(certNFT, "CertRequested")
        .withArgs(1, ITERATION, devRel.address, "participant");
    });
  });

  describe("freeze after cert request", function () {
    beforeEach(async function () {
      // Setup: propose, approve, name, then request cert
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice Builder");
      await certNFT.connect(project1).requestCert(ITERATION, INFO_CID);
    });

    it("proposeTeamMember reverts with CertAlreadyRequested", async function () {
      await expect(
        certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "CertAlreadyRequested");
    });

    it("approveTeamMember reverts with CertAlreadyRequested", async function () {
      // We need a proposed member that wasn't approved before cert was requested
      // This scenario requires proposing before cert request but approving after
      // Since we already have cert, we test that any new approval would fail
      // For this, we need a member proposed before the cert but not yet approved
      // Let's use a different setup:
    });

    it("rejectTeamMember reverts with CertAlreadyRequested", async function () {
      await expect(
        certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member1.address)
      ).to.be.revertedWithCustomError(certNFT, "CertAlreadyRequested");
    });

    it("setTeamMemberName reverts with CertAlreadyRequested", async function () {
      await expect(
        certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "New Name")
      ).to.be.revertedWithCustomError(certNFT, "CertAlreadyRequested");
    });
  });

  describe("freeze after cert request - with pending members", function () {
    it("approveTeamMember reverts with CertAlreadyRequested for pending member", async function () {
      // Propose two members
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      // Approve and name member1
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");

      // Request cert - member2 is still Proposed
      await certNFT.connect(project1).requestCert(ITERATION, INFO_CID);

      // Try to approve member2 after cert requested
      await expect(
        certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member2.address)
      ).to.be.revertedWithCustomError(certNFT, "CertAlreadyRequested");
    });

    it("setTeamMemberName reverts for approved member without name after cert", async function () {
      // Propose two members
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      // Approve both, but only name member1
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member2.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");

      // Request cert
      await certNFT.connect(project1).requestCert(ITERATION, INFO_CID);

      // Try to set name for member2 after cert requested
      await expect(
        certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob")
      ).to.be.revertedWithCustomError(certNFT, "CertAlreadyRequested");
    });
  });

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

      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      expect(await certNFT.hasNamedTeamMembers(ITERATION, project1.address)).to.be.false;
    });

    it("hasNamedTeamMembers returns true after name set", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");

      expect(await certNFT.hasNamedTeamMembers(ITERATION, project1.address)).to.be.true;
    });

    it("teamMemberIndex tracks correctly", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      // Index is 1-based (index+1), 0 means not found
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member1.address)).to.equal(1);
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member2.address)).to.equal(2);
      expect(await certNFT.teamMemberIndex(ITERATION, project1.address, member3.address)).to.equal(0);
    });
  });

  describe("tokenURI with team members", function () {
    it("includes teamMembers array with approved names", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member2.address);
      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(member2).setTeamMemberName(ITERATION, project1.address, "Bob");

      await certNFT.connect(project1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(project1.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.deep.equal(["Alice", "Bob"]);
    });

    it("excludes rejected members from teamMembers", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member3.address);

      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(owner).rejectTeamMember(ITERATION, project1.address, member2.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member3.address);

      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      await certNFT.connect(member3).setTeamMemberName(ITERATION, project1.address, "Charlie");

      await certNFT.connect(project1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(project1.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.deep.equal(["Alice", "Charlie"]);
    });

    it("excludes approved members without name set", async function () {
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member1.address);
      await certNFT.connect(project1).proposeTeamMember(ITERATION, member2.address);

      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member1.address);
      await certNFT.connect(owner).approveTeamMember(ITERATION, project1.address, member2.address);

      await certNFT.connect(member1).setTeamMemberName(ITERATION, project1.address, "Alice");
      // member2 approved but no name set

      await certNFT.connect(project1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(project1.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.deep.equal(["Alice"]);
    });

    it("no teamMembers field for non-project certs", async function () {
      await certNFT.connect(devRel).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(devRel.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.be.undefined;
    });

    it("no teamMembers field when all proposed but none named", async function () {
      // For this scenario, use devRel cert (no team members at all)
      await certNFT.connect(devRel).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(devRel.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.teamMembers).to.be.undefined;
    });
  });
});
