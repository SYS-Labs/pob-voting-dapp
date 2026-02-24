import { expect } from "chai";
import pkg from "hardhat";

const { ethers, upgrades } = pkg;

describe("CertNFT", function () {
  let certNFT;
  let mockPoB;
  let mockJury;
  let gate;
  let mockRegistry;
  let owner;
  let user1;
  let user2;
  let user3;

  const ITERATION = 1;
  const TEMPLATE_CID = "QmTemplateCID123456789";
  const TEMPLATE_HASH = ethers.keccak256(ethers.toUtf8Bytes(TEMPLATE_CID));
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

    // Deploy CertGate (formerly CertMiddleware)
    const CertGate = await ethers.getContractFactory("CertGate");
    gate = await CertGate.deploy(
      [await mockPoB.getAddress()],
      [await mockJury.getAddress()],
      owner.address
    );
    await gate.waitForDeployment();

    // Deploy MockPoBRegistry and set template for tokenURI tests
    const MockPoBRegistry = await ethers.getContractFactory("MockPoBRegistry");
    mockRegistry = await MockPoBRegistry.deploy();
    await mockRegistry.waitForDeployment();
    await mockRegistry.setTemplate(ITERATION, TEMPLATE_HASH, TEMPLATE_CID);

    // Link gate + registry to CertNFT
    await certNFT.connect(owner).setMiddleware(ITERATION, await gate.getAddress());
    await certNFT.connect(owner).setPoBRegistry(await mockRegistry.getAddress());

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
    it("mints a certificate with Requested status", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);

      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      expect(tokenId).to.equal(1);

      const cert = await certNFT.certs(tokenId);
      expect(cert.iteration).to.equal(ITERATION);
      expect(cert.account).to.equal(user1.address);
      expect(cert.certType).to.equal("participant");
      expect(cert.status).to.equal(3); // Requested
      expect(cert.requestTime).to.equal(0); // No timer yet
    });

    it("emits CertRequested event", async function () {
      await expect(certNFT.connect(user1).requestCert(ITERATION))
        .to.emit(certNFT, "CertRequested")
        .withArgs(1, ITERATION, user1.address, "participant");
    });

    it("increments nextTokenId", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      expect(await certNFT.nextTokenId()).to.equal(2);
    });

    it("reverts if already has cert for iteration", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      await expect(
        certNFT.connect(user1).requestCert(ITERATION)
      ).to.be.revertedWithCustomError(certNFT, "AlreadyHasCert");
    });

    it("reverts if no middleware set", async function () {
      await expect(
        certNFT.connect(user1).requestCert(999) // iteration 999 has no middleware
      ).to.be.revertedWithCustomError(certNFT, "NoMiddleware");
    });

    it("reverts if not eligible", async function () {
      // user2 has no badge or role
      await expect(
        certNFT.connect(user2).requestCert(ITERATION)
      ).to.be.revertedWithCustomError(certNFT, "NotEligible");
    });

  });

  describe("approveCert", function () {
    let tokenId;

    beforeEach(async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      tokenId = await certNFT.certOf(user1.address, ITERATION);
    });

    it("owner can approve a Requested cert", async function () {
      await expect(certNFT.connect(owner).approveCert(tokenId))
        .to.emit(certNFT, "CertApproved")
        .withArgs(tokenId);

      expect(await certNFT.certStatus(tokenId)).to.equal(0); // Pending

      const cert = await certNFT.certs(tokenId);
      expect(cert.status).to.equal(0); // Pending
      expect(cert.requestTime).to.be.greaterThan(0); // Timer started
    });

    it("non-owner cannot approve", async function () {
      await expect(
        certNFT.connect(user1).approveCert(tokenId)
      ).to.be.reverted;
    });

    it("reverts for non-Requested cert (already approved)", async function () {
      await certNFT.connect(owner).approveCert(tokenId);
      await expect(
        certNFT.connect(owner).approveCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NotRequested");
    });

    it("reverts for invalid token", async function () {
      await expect(
        certNFT.connect(owner).approveCert(999)
      ).to.be.revertedWithCustomError(certNFT, "InvalidToken");
    });

    it("after approval, 48h auto-finalize works", async function () {
      await certNFT.connect(owner).approveCert(tokenId);
      expect(await certNFT.certStatus(tokenId)).to.equal(0); // Pending

      await ethers.provider.send("evm_increaseTime", [PENDING_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await certNFT.certStatus(tokenId)).to.equal(1); // Minted
    });
  });

  describe("certStatus", function () {
    it("returns Requested after requestCert", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      expect(await certNFT.certStatus(tokenId)).to.equal(3); // Requested
    });

    it("returns Pending after approval", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);
      expect(await certNFT.certStatus(tokenId)).to.equal(0); // Pending
    });

    it("returns Minted after 48 hours post-approval", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);

      await ethers.provider.send("evm_increaseTime", [PENDING_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await certNFT.certStatus(tokenId)).to.equal(1); // Minted
    });

    it("does NOT auto-finalize a Requested cert (no timer)", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      // Even after a long time, Requested stays Requested
      await ethers.provider.send("evm_increaseTime", [PENDING_PERIOD * 10]);
      await ethers.provider.send("evm_mine", []);

      expect(await certNFT.certStatus(tokenId)).to.equal(3); // Still Requested
    });

    it("returns Cancelled if cancelled even after 48h", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);
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
    it("owner can cancel a Requested cert", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await expect(certNFT.connect(owner).cancelCert(tokenId))
        .to.emit(certNFT, "CertCancelled")
        .withArgs(tokenId);

      expect(await certNFT.certStatus(tokenId)).to.equal(2); // Cancelled
    });

    it("owner can cancel a Pending cert", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);

      await certNFT.connect(owner).cancelCert(tokenId);
      expect(await certNFT.certStatus(tokenId)).to.equal(2); // Cancelled
    });

    it("non-owner cannot cancel", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
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
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).cancelCert(tokenId);

      await expect(
        certNFT.connect(owner).cancelCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NotPending");
    });
  });

  describe("finalizeCert", function () {
    it("owner can finalize an approved (Pending) cert", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);

      await expect(certNFT.connect(owner).finalizeCert(tokenId))
        .to.emit(certNFT, "CertFinalized")
        .withArgs(tokenId);

      expect(await certNFT.certStatus(tokenId)).to.equal(1); // Minted
    });

    it("reverts for Requested cert (must approve first)", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await expect(
        certNFT.connect(owner).finalizeCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NotPending");
    });

    it("non-owner cannot finalize", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);

      await expect(
        certNFT.connect(user1).finalizeCert(tokenId)
      ).to.be.reverted;
    });

    it("reverts for invalid token", async function () {
      await expect(
        certNFT.connect(owner).finalizeCert(999)
      ).to.be.revertedWithCustomError(certNFT, "InvalidToken");
    });

    it("reverts if cert is already cancelled", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);
      await certNFT.connect(owner).cancelCert(tokenId);

      await expect(
        certNFT.connect(owner).finalizeCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NotPending");
    });

    it("reverts if cert is already minted", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);
      await certNFT.connect(owner).finalizeCert(tokenId);

      await expect(
        certNFT.connect(owner).finalizeCert(tokenId)
      ).to.be.revertedWithCustomError(certNFT, "NotPending");
    });
  });

  describe("soulbound transfer block", function () {
    it("blocks transfers", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      await expect(
        certNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId)
      ).to.be.revertedWith("CertNFT: soulbound, transfers blocked");
    });
  });

  describe("tokenURI", function () {
    it("returns valid JSON metadata with Requested status", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);

      expect(metadata.name).to.equal("PoB Certificate #1");
      expect(metadata.description).to.equal("Proof-of-Builders Participation Certificate");
      expect(metadata.template).to.equal(TEMPLATE_CID);

      // Check attributes
      const iterAttr = metadata.attributes.find(a => a.trait_type === "Iteration");
      expect(iterAttr.value).to.equal(1);

      const typeAttr = metadata.attributes.find(a => a.trait_type === "Type");
      expect(typeAttr.value).to.equal("participant");

      const statusAttr = metadata.attributes.find(a => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Requested");
    });

    it("reflects Pending status after approval", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);
      const statusAttr = metadata.attributes.find(a => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Pending");
    });

    it("reflects Minted status after 48h post-approval", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).approveCert(tokenId);

      await ethers.provider.send("evm_increaseTime", [PENDING_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);
      const statusAttr = metadata.attributes.find(a => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Minted");
    });

    it("reflects Cancelled status", async function () {
      await certNFT.connect(user1).requestCert(ITERATION);
      const tokenId = await certNFT.certOf(user1.address, ITERATION);
      await certNFT.connect(owner).cancelCert(tokenId);

      const uri = await certNFT.tokenURI(tokenId);
      const metadata = JSON.parse(uri);
      const statusAttr = metadata.attributes.find(a => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Cancelled");
    });
  });

  describe("renderSVG", function () {
    const SVG_TEMPLATE = '<svg><text>{{CERT_TYPE}}</text><text>{{ITERATION}}</text><text>{{TEAM_MEMBERS}}</text><text>{{ACCOUNT}}</text><text>{{STATUS}}</text><text>{{TOKEN_ID}}</text></svg>';

    let tokenId;

    beforeEach(async function () {
      // Set the SVG template in PoBRegistry with matching hash
      const templateBytes = ethers.toUtf8Bytes(SVG_TEMPLATE);
      const templateHash = ethers.keccak256(templateBytes);
      await mockRegistry.setTemplate(ITERATION, templateHash, "QmSvgTemplate");

      await certNFT.connect(user1).requestCert(ITERATION);
      tokenId = await certNFT.certOf(user1.address, ITERATION);
    });

    it("correctly replaces all placeholders", async function () {
      const templateBytes = ethers.toUtf8Bytes(SVG_TEMPLATE);
      const result = await certNFT.renderSVG(tokenId, templateBytes);

      expect(result).to.include("participant");
      expect(result).to.include(">1<"); // iteration
      expect(result).to.include(user1.address.toLowerCase());
      expect(result).to.include("Requested");
      expect(result).to.include(">1<"); // tokenId (also 1)
    });

    it("reverts on hash mismatch", async function () {
      const wrongTemplate = ethers.toUtf8Bytes("wrong template");
      await expect(
        certNFT.renderSVG(tokenId, wrongTemplate)
      ).to.be.revertedWithCustomError(certNFT, "TemplateHashMismatch");
    });

    it("reverts if template too large", async function () {
      // Set a hash that matches a large template
      const largeBytes = new Uint8Array(102401); // > 100KB
      await expect(
        certNFT.renderSVG(tokenId, largeBytes)
      ).to.be.revertedWithCustomError(certNFT, "TemplateTooLarge");
    });

    it("reverts if no active template hash", async function () {
      // Setup user2 on iteration 2 — no template set in registry for iteration 2
      const MockCertGate = await ethers.getContractFactory("MockCertGate");
      const mockGate2 = await MockCertGate.deploy();
      await mockGate2.waitForDeployment();
      await certNFT.connect(owner).setMiddleware(2, await mockGate2.getAddress());
      await mockGate2.setEligible(user2.address, true, "participant");
      await certNFT.connect(user2).requestCert(2);
      const tokenId2 = await certNFT.certOf(user2.address, 2);

      const templateBytes = ethers.toUtf8Bytes(SVG_TEMPLATE);
      // Iteration 2 has no template in registry → NoActiveTemplate
      await expect(
        certNFT.renderSVG(tokenId2, templateBytes)
      ).to.be.revertedWithCustomError(certNFT, "NoActiveTemplate");
    });

    it("XML-escapes special characters in cert type", async function () {
      // Setup a user with a certType containing special chars via registered role
      await gate.connect(owner).registerRole(user2.address, "org & <admin>");
      await mockPoB.setHasMinted(user2.address, true);
      await certNFT.connect(user2).requestCert(ITERATION);
      const tokenId2 = await certNFT.certOf(user2.address, ITERATION);

      const templateBytes = ethers.toUtf8Bytes(SVG_TEMPLATE);
      const result = await certNFT.renderSVG(tokenId2, templateBytes);

      expect(result).to.include("org &amp; &lt;admin&gt;");
      expect(result).not.to.include("org & <admin>");
    });

    it("returns empty team members for non-project", async function () {
      const templateBytes = ethers.toUtf8Bytes(SVG_TEMPLATE);
      const result = await certNFT.renderSVG(tokenId, templateBytes);

      // The {{TEAM_MEMBERS}} placeholder should be replaced with empty string
      expect(result).not.to.include("{{TEAM_MEMBERS}}");
    });

    it("reverts MissingPlaceholder when template omits a placeholder", async function () {
      // Template missing {{TOKEN_ID}}
      const incomplete = '<svg><text>{{CERT_TYPE}}</text><text>{{ITERATION}}</text><text>{{TEAM_MEMBERS}}</text><text>{{ACCOUNT}}</text><text>{{STATUS}}</text></svg>';
      const incompleteBytes = ethers.toUtf8Bytes(incomplete);
      const incompleteHash = ethers.keccak256(incompleteBytes);
      await mockRegistry.setTemplate(ITERATION, incompleteHash, "QmIncomplete");
      await expect(
        certNFT.renderSVG(tokenId, incompleteBytes)
      ).to.be.revertedWithCustomError(certNFT, "MissingPlaceholder");
    });
  });

  describe("setMiddleware", function () {
    it("owner can set middleware", async function () {
      await expect(
        certNFT.connect(owner).setMiddleware(2, await gate.getAddress())
      ).to.emit(certNFT, "MiddlewareSet")
        .withArgs(2, await gate.getAddress());

      expect(await certNFT.middleware(2)).to.equal(await gate.getAddress());
    });

    it("non-owner cannot set middleware", async function () {
      await expect(
        certNFT.connect(user1).setMiddleware(2, await gate.getAddress())
      ).to.be.reverted;
    });

    it("reverts for zero address", async function () {
      await expect(
        certNFT.connect(owner).setMiddleware(2, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(certNFT, "ZeroAddress");
    });

    it("reverts for EOA (non-contract) address", async function () {
      await expect(
        certNFT.connect(owner).setMiddleware(2, user3.address)
      ).to.be.revertedWithCustomError(certNFT, "NotAContract");
    });
  });

  describe("setPoBRegistry", function () {
    it("owner can set registry", async function () {
      await expect(
        certNFT.connect(owner).setPoBRegistry(await mockRegistry.getAddress())
      ).to.emit(certNFT, "PoBRegistrySet")
        .withArgs(await mockRegistry.getAddress());

      expect(await certNFT.pobRegistry()).to.equal(await mockRegistry.getAddress());
    });

    it("non-owner cannot set registry", async function () {
      await expect(
        certNFT.connect(user1).setPoBRegistry(await mockRegistry.getAddress())
      ).to.be.reverted;
    });

    it("reverts for zero address", async function () {
      await expect(
        certNFT.connect(owner).setPoBRegistry(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(certNFT, "ZeroAddress");
    });

    it("reverts for EOA (non-contract) address", async function () {
      await expect(
        certNFT.connect(owner).setPoBRegistry(user3.address)
      ).to.be.revertedWithCustomError(certNFT, "NotAContract");
    });
  });
});
