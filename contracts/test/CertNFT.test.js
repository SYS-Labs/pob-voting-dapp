import { expect } from "chai";
import pkg from "hardhat";

const { ethers, upgrades } = pkg;

describe("CertNFT", function () {
  let certNFT;
  let mockPoB;
  let mockJury;
  let middleware;
  let owner;
  let user1;
  let user2;
  let user3;

  const ITERATION = 1;
  const INFO_CID = "QmTestInfoCID123456789";
  const TEMPLATE_CID = "QmTemplateCID123456789";
  const PENDING_PERIOD = 48 * 60 * 60; // 48 hours in seconds

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mocks
    const MockPoB = await ethers.getContractFactory("MockPoB");
    mockPoB = await MockPoB.deploy();
    await mockPoB.waitForDeployment();

    const MockJury = await ethers.getContractFactory("MockJurySCForCert");
    mockJury = await MockJury.deploy();
    await mockJury.waitForDeployment();

    // Deploy CertNFT as UUPS proxy
    const CertNFT = await ethers.getContractFactory("CertNFT");
    certNFT = await upgrades.deployProxy(CertNFT, [owner.address], {
      kind: "uups",
    });
    await certNFT.waitForDeployment();

    // Deploy middleware
    const CertMiddleware = await ethers.getContractFactory("CertMiddleware_001");
    middleware = await CertMiddleware.deploy(
      [await mockPoB.getAddress()],
      [await mockJury.getAddress()],
      owner.address
    );
    await middleware.waitForDeployment();

    // Setup middleware
    await middleware.connect(owner).setTemplateCID(TEMPLATE_CID);

    // Link middleware to CertNFT
    await certNFT.connect(owner).setMiddleware(ITERATION, await middleware.getAddress());

    // Setup mock state: voting ended, user1 is devrel with badge
    await mockJury.setHasVotingEnded(true);
    await mockPoB.setHasMinted(user1.address, true);
    await mockJury.setIsDevRelAccount(user1.address, true);
  });

  describe("deployment", function () {
    it("initializes with correct name and symbol", async function () {
      expect(await certNFT.name()).to.equal("PoB Certificate");
      expect(await certNFT.symbol()).to.equal("POBCERT");
    });

    it("starts with nextTokenId = 1", async function () {
      expect(await certNFT.nextTokenId()).to.equal(1);
    });

    it("sets owner correctly", async function () {
      expect(await certNFT.owner()).to.equal(owner.address);
    });
  });

  describe("requestCert", function () {
    it("mints a certificate for eligible user", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);

      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      expect(tokenId).to.equal(1);

      const cert = await certNFT.certs(tokenId);
      expect(cert.iteration).to.equal(ITERATION);
      expect(cert.account).to.equal(user1.address);
      expect(cert.certType).to.equal("participant");
      expect(cert.infoCID).to.equal(INFO_CID);
      expect(cert.status).to.equal(0); // Pending
    });

    it("emits CertRequested event", async function () {
      await expect(certNFT.connect(user1).requestCert(ITERATION, INFO_CID))
        .to.emit(certNFT, "CertRequested")
        .withArgs(1, ITERATION, user1.address, "participant");
    });

    it("increments nextTokenId", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      expect(await certNFT.nextTokenId()).to.equal(2);
    });

    it("reverts if already has cert for iteration", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      await expect(
        certNFT.connect(user1).requestCert(ITERATION, INFO_CID)
      ).to.be.revertedWithCustomError(certNFT, "AlreadyHasCert");
    });

    it("reverts if no middleware set", async function () {
      await expect(
        certNFT.connect(user1).requestCert(999, INFO_CID) // iteration 999 has no middleware
      ).to.be.revertedWithCustomError(certNFT, "NoMiddleware");
    });

    it("reverts if not eligible", async function () {
      // user2 has no badge or role
      await expect(
        certNFT.connect(user2).requestCert(ITERATION, INFO_CID)
      ).to.be.revertedWithCustomError(certNFT, "NotEligible");
    });

    it("reverts with empty CID", async function () {
      await expect(
        certNFT.connect(user1).requestCert(ITERATION, "")
      ).to.be.revertedWithCustomError(certNFT, "EmptyCID");
    });

    it("reverts with CID too long", async function () {
      const longCID = "a".repeat(101);
      await expect(
        certNFT.connect(user1).requestCert(ITERATION, longCID)
      ).to.be.revertedWithCustomError(certNFT, "CIDTooLong");
    });
  });

  describe("certStatus auto-finalize", function () {
    it("returns Pending before 48 hours", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      expect(await certNFT.certStatus(tokenId)).to.equal(0); // Pending
    });

    it("returns Minted after 48 hours", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      // Advance time by 48 hours + 1 second
      await ethers.provider.send("evm_increaseTime", [PENDING_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await certNFT.certStatus(tokenId)).to.equal(1); // Minted
    });

    it("returns Cancelled if cancelled even after 48h", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await certNFT.connect(owner).cancelCert(tokenId);

      // Even after time passes
      await ethers.provider.send("evm_increaseTime", [PENDING_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await certNFT.certStatus(tokenId)).to.equal(2); // Cancelled
    });

    it("reverts for invalid token", async function () {
      await expect(
        certNFT.certStatus(999)
      ).to.be.revertedWithCustomError(certNFT, "InvalidToken");
    });
  });

  describe("cancelCert", function () {
    it("owner can cancel a pending cert", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await expect(certNFT.connect(owner).cancelCert(tokenId))
        .to.emit(certNFT, "CertCancelled")
        .withArgs(tokenId);

      expect(await certNFT.certStatus(tokenId)).to.equal(2); // Cancelled
    });

    it("non-owner cannot cancel", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await expect(
        certNFT.connect(user1).cancelCert(tokenId)
      ).to.be.reverted;
    });

    it("reverts for invalid token", async function () {
      await expect(
        certNFT.connect(owner).cancelCert(999)
      ).to.be.revertedWithCustomError(certNFT, "InvalidToken");
    });

    it("reverts if already cancelled", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).cancelCert(tokenId);

      await expect(
        certNFT.connect(owner).cancelCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NotPending");
    });
  });

  describe("soulbound transfer block", function () {
    it("blocks transfers", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await expect(
        certNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId)
      ).to.be.revertedWith("CertNFT: soulbound, transfers blocked");
    });
  });

  describe("tokenURI", function () {
    it("returns valid JSON metadata", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.name).to.equal("PoB Certificate #1");
      expect(metadata.description).to.equal("Proof-of-Builders Participation Certificate");
      expect(metadata.infoCID).to.equal(INFO_CID);
      expect(metadata.template).to.equal(TEMPLATE_CID);

      // Check attributes
      const iterAttr = metadata.attributes.find(a => a.trait_type === "Iteration");
      expect(iterAttr.value).to.equal(1);

      const typeAttr = metadata.attributes.find(a => a.trait_type === "Type");
      expect(typeAttr.value).to.equal("participant");

      const statusAttr = metadata.attributes.find(a => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Pending");
    });

    it("reflects Minted status after 48h", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await ethers.provider.send("evm_increaseTime", [PENDING_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);
      const statusAttr = metadata.attributes.find(a => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Minted");
    });

    it("reflects Cancelled status", async function () {
      await certNFT.connect(user1).requestCert(ITERATION, INFO_CID);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).cancelCert(tokenId);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);
      const statusAttr = metadata.attributes.find(a => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Cancelled");
    });
  });

  describe("setMiddleware", function () {
    it("owner can set middleware", async function () {
      await expect(
        certNFT.connect(owner).setMiddleware(2, user3.address)
      ).to.emit(certNFT, "MiddlewareSet")
        .withArgs(2, user3.address);

      expect(await certNFT.middleware(2)).to.equal(user3.address);
    });

    it("non-owner cannot set middleware", async function () {
      await expect(
        certNFT.connect(user1).setMiddleware(2, user3.address)
      ).to.be.reverted;
    });
  });
});
