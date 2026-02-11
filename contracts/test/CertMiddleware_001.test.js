import { expect } from "chai";
import pkg from "hardhat";

const { ethers } = pkg;

describe("CertMiddleware_001", function () {
  let mockPoB1, mockPoB2;
  let mockJury1, mockJury2;
  let middleware;
  let owner;
  let devRel, daoHic, project1, community, organizer, winner;

  beforeEach(async function () {
    [owner, devRel, daoHic, project1, community, organizer, winner] =
      await ethers.getSigners();

    // Deploy mocks for 2 rounds
    const MockPoB = await ethers.getContractFactory("MockPoB");
    mockPoB1 = await MockPoB.deploy();
    mockPoB2 = await MockPoB.deploy();

    const MockJury = await ethers.getContractFactory("MockJurySCForCert");
    mockJury1 = await MockJury.deploy();
    mockJury2 = await MockJury.deploy();

    await Promise.all([
      mockPoB1.waitForDeployment(),
      mockPoB2.waitForDeployment(),
      mockJury1.waitForDeployment(),
      mockJury2.waitForDeployment(),
    ]);

    // Deploy middleware with 2 rounds
    const CertMiddleware = await ethers.getContractFactory("CertMiddleware_001");
    middleware = await CertMiddleware.deploy(
      [await mockPoB1.getAddress(), await mockPoB2.getAddress()],
      [await mockJury1.getAddress(), await mockJury2.getAddress()],
      owner.address
    );
    await middleware.waitForDeployment();

    // Default: both rounds voting ended
    await mockJury1.setHasVotingEnded(true);
    await mockJury2.setHasVotingEnded(true);
  });

  describe("constructor", function () {
    it("stores contract arrays", async function () {
      expect(await middleware.roundCount()).to.equal(2);
      expect(await middleware.pobContracts(0)).to.equal(await mockPoB1.getAddress());
      expect(await middleware.pobContracts(1)).to.equal(await mockPoB2.getAddress());
    });

    it("reverts on empty arrays", async function () {
      const CertMiddleware = await ethers.getContractFactory("CertMiddleware_001");
      await expect(
        CertMiddleware.deploy([], [], owner.address)
      ).to.be.revertedWithCustomError(CertMiddleware, "EmptyArrays");
    });

    it("reverts on mismatched array lengths", async function () {
      const CertMiddleware = await ethers.getContractFactory("CertMiddleware_001");
      await expect(
        CertMiddleware.deploy(
          [await mockPoB1.getAddress()],
          [await mockJury1.getAddress(), await mockJury2.getAddress()],
          owner.address
        )
      ).to.be.revertedWithCustomError(CertMiddleware, "ArrayLengthMismatch");
    });
  });

  describe("registered roles bypass", function () {
    it("returns true for registered organizer", async function () {
      await middleware.connect(owner).registerRole(organizer.address, "organizer");

      const [eligible, certType] = await middleware.validate(organizer.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("organizer");
    });

    it("returns true for registered speaker", async function () {
      await middleware.connect(owner).registerRole(organizer.address, "speaker");

      const [eligible, certType] = await middleware.validate(organizer.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("speaker");
    });

    it("bypasses all voting/badge checks", async function () {
      // Even with voting not ended
      await mockJury1.setHasVotingEnded(false);
      await middleware.connect(owner).registerRole(organizer.address, "organizer");

      const [eligible] = await middleware.validate(organizer.address);
      expect(eligible).to.be.true;
    });
  });

  describe("all-rounds-complete gate", function () {
    it("rejects if round 1 voting not ended", async function () {
      await mockJury1.setHasVotingEnded(false);
      await mockPoB1.setHasMinted(devRel.address, true);
      await mockPoB2.setHasMinted(devRel.address, true);
      await mockJury1.setIsDevRelAccount(devRel.address, true);
      await mockJury2.setIsDevRelAccount(devRel.address, true);

      const [eligible] = await middleware.validate(devRel.address);
      expect(eligible).to.be.false;
    });

    it("rejects if round 2 voting not ended", async function () {
      await mockJury2.setHasVotingEnded(false);
      await mockPoB1.setHasMinted(devRel.address, true);
      await mockPoB2.setHasMinted(devRel.address, true);
      await mockJury1.setIsDevRelAccount(devRel.address, true);
      await mockJury2.setIsDevRelAccount(devRel.address, true);

      const [eligible] = await middleware.validate(devRel.address);
      expect(eligible).to.be.false;
    });
  });

  describe("badge + role check per round", function () {
    it("accepts DevRel with badges in all rounds", async function () {
      await mockPoB1.setHasMinted(devRel.address, true);
      await mockPoB2.setHasMinted(devRel.address, true);
      await mockJury1.setIsDevRelAccount(devRel.address, true);
      await mockJury2.setIsDevRelAccount(devRel.address, true);

      const [eligible, certType] = await middleware.validate(devRel.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("participant");
    });

    it("accepts DAO-HIC voter with badges in all rounds", async function () {
      await mockPoB1.setHasMinted(daoHic.address, true);
      await mockPoB2.setHasMinted(daoHic.address, true);
      await mockJury1.setIsDaoHicVoter(daoHic.address, true);
      await mockJury2.setIsDaoHicVoter(daoHic.address, true);

      const [eligible, certType] = await middleware.validate(daoHic.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("participant");
    });

    it("accepts project with badges in all rounds", async function () {
      await mockPoB1.setHasMinted(project1.address, true);
      await mockPoB2.setHasMinted(project1.address, true);
      await mockJury1.setIsRegisteredProject(project1.address, true);
      await mockJury2.setIsRegisteredProject(project1.address, true);

      const [eligible, certType] = await middleware.validate(project1.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("participant");
    });

    it("rejects if missing badge in one round", async function () {
      await mockPoB1.setHasMinted(devRel.address, true);
      // No badge in round 2
      await mockJury1.setIsDevRelAccount(devRel.address, true);
      await mockJury2.setIsDevRelAccount(devRel.address, true);

      const [eligible] = await middleware.validate(devRel.address);
      expect(eligible).to.be.false;
    });

    it("rejects if no non-community role in one round", async function () {
      await mockPoB1.setHasMinted(devRel.address, true);
      await mockPoB2.setHasMinted(devRel.address, true);
      await mockJury1.setIsDevRelAccount(devRel.address, true);
      // No role in round 2

      const [eligible] = await middleware.validate(devRel.address);
      expect(eligible).to.be.false;
    });
  });

  describe("community exclusion", function () {
    it("rejects community-only participants", async function () {
      // Has badge but no non-community role
      await mockPoB1.setHasMinted(community.address, true);
      await mockPoB2.setHasMinted(community.address, true);
      // No devRel/daoHic/project role set

      const [eligible] = await middleware.validate(community.address);
      expect(eligible).to.be.false;
    });
  });

  describe("reverse winner detection", function () {
    it("returns 'winner' for iteration winner", async function () {
      await mockPoB1.setHasMinted(project1.address, true);
      await mockPoB2.setHasMinted(project1.address, true);
      await mockJury1.setIsRegisteredProject(project1.address, true);
      await mockJury2.setIsRegisteredProject(project1.address, true);

      // Latest round (round 2) has winner
      await mockJury2.setWinner(project1.address, true);

      const [eligible, certType] = await middleware.validate(project1.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("winner");
    });

    it("uses latest round with hasWinner=true", async function () {
      await mockPoB1.setHasMinted(project1.address, true);
      await mockPoB2.setHasMinted(project1.address, true);
      await mockJury1.setIsRegisteredProject(project1.address, true);
      await mockJury2.setIsRegisteredProject(project1.address, true);

      // Round 1 has different winner, round 2 has this project as winner
      await mockJury1.setWinner(owner.address, true); // Different winner in round 1
      await mockJury2.setWinner(project1.address, true); // This project wins round 2

      const [eligible, certType] = await middleware.validate(project1.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("winner");
    });

    it("returns 'participant' if not the winner", async function () {
      await mockPoB1.setHasMinted(devRel.address, true);
      await mockPoB2.setHasMinted(devRel.address, true);
      await mockJury1.setIsDevRelAccount(devRel.address, true);
      await mockJury2.setIsDevRelAccount(devRel.address, true);

      // Winner is someone else
      await mockJury2.setWinner(project1.address, true);

      const [eligible, certType] = await middleware.validate(devRel.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("participant");
    });

    it("returns 'participant' when no winner in any round", async function () {
      await mockPoB1.setHasMinted(devRel.address, true);
      await mockPoB2.setHasMinted(devRel.address, true);
      await mockJury1.setIsDevRelAccount(devRel.address, true);
      await mockJury2.setIsDevRelAccount(devRel.address, true);

      // No winner set in any round (default hasWinner = false)

      const [eligible, certType] = await middleware.validate(devRel.address);
      expect(eligible).to.be.true;
      expect(certType).to.equal("participant");
    });
  });

  describe("owner functions", function () {
    it("owner can set templateCID", async function () {
      const cid = "QmNewTemplate";
      await expect(middleware.connect(owner).setTemplateCID(cid))
        .to.emit(middleware, "TemplateCIDSet")
        .withArgs(cid);
      expect(await middleware.templateCID()).to.equal(cid);
    });

    it("owner can register role", async function () {
      await expect(middleware.connect(owner).registerRole(organizer.address, "organizer"))
        .to.emit(middleware, "RoleRegistered")
        .withArgs(organizer.address, "organizer");
      expect(await middleware.registeredRole(organizer.address)).to.equal("organizer");
    });

    it("owner can remove role", async function () {
      await middleware.connect(owner).registerRole(organizer.address, "organizer");
      await expect(middleware.connect(owner).removeRole(organizer.address))
        .to.emit(middleware, "RoleRemoved")
        .withArgs(organizer.address);
      expect(await middleware.registeredRole(organizer.address)).to.equal("");
    });

    it("rejects empty role string", async function () {
      await expect(
        middleware.connect(owner).registerRole(organizer.address, "")
      ).to.be.revertedWith("Empty role");
    });

    it("non-owner cannot set templateCID", async function () {
      await expect(
        middleware.connect(devRel).setTemplateCID("QmTest")
      ).to.be.reverted;
    });

    it("non-owner cannot register role", async function () {
      await expect(
        middleware.connect(devRel).registerRole(organizer.address, "organizer")
      ).to.be.reverted;
    });
  });
});
