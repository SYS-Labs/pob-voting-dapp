import { expect } from "chai";
import hre from "hardhat";
const { ethers, upgrades } = hre;

describe("PoBRegistry", function () {
  let PoBRegistry;
  let registry;
  let mockJurySC;
  let owner;
  let user1;
  let user2;
  let project1;
  let project2;
  let otherUser;

  const CHAIN_ID_TESTNET = 5700;
  const CHAIN_ID_MAINNET = 57;
  const CHAIN_ID_LOCAL = 31337;
  const SAMPLE_CID = "QmTzQ1JRkWErjk39mryYw2WVaphAZNAREyMchXzYywCzK1";
  const UPDATED_CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

  beforeEach(async function () {
    [owner, user1, user2, project1, project2, otherUser] = await ethers.getSigners();

    // Deploy mock JurySC for testing
    const MockJurySC = await ethers.getContractFactory("MockJurySC");
    mockJurySC = await MockJurySC.deploy();
    await mockJurySC.waitForDeployment();

    // Register projects in mock JurySC
    await mockJurySC.registerProject(project1.address);
    await mockJurySC.registerProject(project2.address);

    PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    registry = await upgrades.deployProxy(
      PoBRegistry,
      [owner.address],
      { initializer: "initialize" }
    );
    await registry.waitForDeployment();
  });

  // ========== DEPLOYMENT TESTS ==========

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("Should be upgradeable", async function () {
      const registryAddress = await registry.getAddress();
      expect(registryAddress).to.be.properAddress;
    });

    it("Should start in initialization mode", async function () {
      expect(await registry.initializationComplete()).to.be.false;
    });

    it("Should start with zero iteration count", async function () {
      expect(await registry.iterationCount()).to.equal(0);
    });
  });

  // ========== ITERATION REGISTRY TESTS ==========

  describe("Iteration Registry", function () {
    describe("registerIteration", function () {
      it("Should allow owner to register an iteration", async function () {
        await expect(registry.registerIteration(1, CHAIN_ID_TESTNET))
          .to.emit(registry, "IterationRegistered")
          .withArgs(1, CHAIN_ID_TESTNET);

        expect(await registry.iterationCount()).to.equal(1);
      });

      it("Should store correct iteration info", async function () {
        await registry.registerIteration(1, CHAIN_ID_TESTNET);

        const iteration = await registry.iterations(1);
        expect(iteration.iterationId).to.equal(1);
        expect(iteration.chainId).to.equal(CHAIN_ID_TESTNET);
        expect(iteration.roundCount).to.equal(0);
        expect(iteration.exists).to.be.true;
      });

      it("Should allow registering multiple iterations", async function () {
        await registry.registerIteration(1, CHAIN_ID_TESTNET);
        await registry.registerIteration(2, CHAIN_ID_MAINNET);
        await registry.registerIteration(3, CHAIN_ID_LOCAL);

        expect(await registry.iterationCount()).to.equal(3);
      });

      it("Should revert with invalid iteration ID (0)", async function () {
        await expect(
          registry.registerIteration(0, CHAIN_ID_TESTNET)
        ).to.be.revertedWith("Invalid iteration ID");
      });

      it("Should revert with invalid chain ID (0)", async function () {
        await expect(
          registry.registerIteration(1, 0)
        ).to.be.revertedWith("Invalid chain ID");
      });

      it("Should revert when registering duplicate iteration", async function () {
        await registry.registerIteration(1, CHAIN_ID_TESTNET);

        await expect(
          registry.registerIteration(1, CHAIN_ID_MAINNET)
        ).to.be.revertedWith("Iteration already registered");
      });

      it("Should not allow non-owner to register iteration", async function () {
        await expect(
          registry.connect(user1).registerIteration(1, CHAIN_ID_TESTNET)
        ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      });
    });

    describe("getIteration", function () {
      beforeEach(async function () {
        await registry.registerIteration(1, CHAIN_ID_TESTNET);
        await registry.registerIteration(2, CHAIN_ID_MAINNET);
      });

      it("Should return correct iteration info", async function () {
        const iteration = await registry.getIteration(1);
        expect(iteration.iterationId).to.equal(1);
        expect(iteration.chainId).to.equal(CHAIN_ID_TESTNET);
        expect(iteration.exists).to.be.true;
      });

      it("Should revert for non-existent iteration", async function () {
        await expect(
          registry.getIteration(99)
        ).to.be.revertedWith("Iteration not found");
      });
    });

    describe("getAllIterationIds", function () {
      it("Should return empty array when no iterations", async function () {
        const ids = await registry.getAllIterationIds();
        expect(ids).to.deep.equal([]);
      });

      it("Should return all iteration IDs", async function () {
        await registry.registerIteration(1, CHAIN_ID_TESTNET);
        await registry.registerIteration(2, CHAIN_ID_MAINNET);
        await registry.registerIteration(3, CHAIN_ID_LOCAL);

        const ids = await registry.getAllIterationIds();
        expect(ids.map(id => Number(id))).to.deep.equal([1, 2, 3]);
      });

      it("Should reject non-contiguous iteration IDs", async function () {
        await registry.registerIteration(1, CHAIN_ID_TESTNET);
        await expect(
          registry.registerIteration(5, CHAIN_ID_MAINNET)
        ).to.be.revertedWith("Iteration ID must be contiguous");
      });

      it("Should accept sequential contiguous iteration IDs", async function () {
        await registry.registerIteration(1, CHAIN_ID_TESTNET);
        await registry.registerIteration(2, CHAIN_ID_MAINNET);
        await registry.registerIteration(3, CHAIN_ID_LOCAL);

        const ids = await registry.getAllIterationIds();
        expect(ids.map(id => Number(id))).to.deep.equal([1, 2, 3]);
      });
    });
  });

  // ========== ROUND MANAGEMENT TESTS ==========

  describe("Round Management", function () {
    let mockJurySCAddress;

    beforeEach(async function () {
      mockJurySCAddress = await mockJurySC.getAddress();
      await registry.registerIteration(1, CHAIN_ID_LOCAL);
    });

    describe("addRound", function () {
      it("Should allow owner to add a round", async function () {
        await expect(registry.addRound(1, 1, mockJurySCAddress, 100))
          .to.emit(registry, "RoundAdded")
          .withArgs(1, 1, mockJurySCAddress, ethers.ZeroAddress, CHAIN_ID_LOCAL);

        const iteration = await registry.iterations(1);
        expect(iteration.roundCount).to.equal(1);
      });

      it("Should store correct round info", async function () {
        await registry.addRound(1, 1, mockJurySCAddress, 12345);

        const round = await registry.rounds(1, 1);
        expect(round.iterationId).to.equal(1);
        expect(round.roundId).to.equal(1);
        expect(round.jurySC).to.equal(mockJurySCAddress);
        expect(round.deployBlockHint).to.equal(12345);
        expect(round.exists).to.be.true;
      });

      it("Should allow adding multiple rounds to an iteration", async function () {
        const MockJurySC = await ethers.getContractFactory("MockJurySC");
        const jurySC2 = await MockJurySC.deploy();
        const jurySC3 = await MockJurySC.deploy();

        await registry.addRound(1, 1, mockJurySCAddress, 100);
        await registry.addRound(1, 2, await jurySC2.getAddress(), 200);
        await registry.addRound(1, 3, await jurySC3.getAddress(), 300);

        const iteration = await registry.iterations(1);
        expect(iteration.roundCount).to.equal(3);
      });

      it("Should revert when adding round to non-existent iteration", async function () {
        await expect(
          registry.addRound(99, 1, mockJurySCAddress, 100)
        ).to.be.revertedWith("Iteration not registered");
      });

      it("Should revert with invalid round ID (0)", async function () {
        await expect(
          registry.addRound(1, 0, mockJurySCAddress, 100)
        ).to.be.revertedWith("Invalid round ID");
      });

      it("Should revert with round ID exceeding MAX_ROUNDS_PER_ITERATION", async function () {
        await expect(
          registry.addRound(1, 101, mockJurySCAddress, 100)
        ).to.be.revertedWith("Round ID exceeds max");
      });

      it("Should revert with zero address jurySC", async function () {
        await expect(
          registry.addRound(1, 1, ethers.ZeroAddress, 100)
        ).to.be.revertedWith("Invalid jurySC address");
      });

      it("Should revert when adding duplicate round", async function () {
        await registry.addRound(1, 1, mockJurySCAddress, 100);

        const MockJurySC = await ethers.getContractFactory("MockJurySC");
        const jurySC2 = await MockJurySC.deploy();

        await expect(
          registry.addRound(1, 1, await jurySC2.getAddress(), 200)
        ).to.be.revertedWith("Round already exists");
      });

      it("Should revert when jurySC is already registered", async function () {
        await registry.addRound(1, 1, mockJurySCAddress, 100);

        await expect(
          registry.addRound(1, 2, mockJurySCAddress, 200)
        ).to.be.revertedWith("JurySC already registered");
      });

      it("Should not allow non-owner to add round", async function () {
        await expect(
          registry.connect(user1).addRound(1, 1, mockJurySCAddress, 100)
        ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      });

      it("Should create reverse lookup entry", async function () {
        await registry.addRound(1, 1, mockJurySCAddress, 100);

        const ref = await registry.roundByContract(CHAIN_ID_LOCAL, mockJurySCAddress);
        expect(ref.iterationId).to.equal(1);
        expect(ref.roundId).to.equal(1);
        expect(ref.exists).to.be.true;
      });
    });

    describe("getRound", function () {
      beforeEach(async function () {
        await registry.addRound(1, 1, mockJurySCAddress, 100);
      });

      it("Should return correct round info", async function () {
        const round = await registry.getRound(1, 1);
        expect(round.iterationId).to.equal(1);
        expect(round.roundId).to.equal(1);
        expect(round.jurySC).to.equal(mockJurySCAddress);
      });

      it("Should revert for non-existent round", async function () {
        await expect(
          registry.getRound(1, 99)
        ).to.be.revertedWith("Round not found");
      });

      it("Should revert for non-existent iteration", async function () {
        await expect(
          registry.getRound(99, 1)
        ).to.be.revertedWith("Round not found");
      });
    });

    describe("getRounds", function () {
      it("Should return empty array when no rounds", async function () {
        const rounds = await registry.getRounds(1);
        expect(rounds).to.deep.equal([]);
      });

      it("Should return all rounds for an iteration", async function () {
        const MockJurySC = await ethers.getContractFactory("MockJurySC");
        const jurySC2 = await MockJurySC.deploy();

        await registry.addRound(1, 1, mockJurySCAddress, 100);
        await registry.addRound(1, 2, await jurySC2.getAddress(), 200);

        const rounds = await registry.getRounds(1);
        expect(rounds.length).to.equal(2);
        expect(rounds[0].roundId).to.equal(1);
        expect(rounds[1].roundId).to.equal(2);
      });

      it("Should revert for non-existent iteration", async function () {
        await expect(
          registry.getRounds(99)
        ).to.be.revertedWith("Iteration not found");
      });
    });

    describe("getRoundByContract", function () {
      beforeEach(async function () {
        await registry.addRound(1, 1, mockJurySCAddress, 100);
      });

      it("Should return correct round info by contract address", async function () {
        const round = await registry.getRoundByContract(CHAIN_ID_LOCAL, mockJurySCAddress);
        expect(round.iterationId).to.equal(1);
        expect(round.roundId).to.equal(1);
        expect(round.jurySC).to.equal(mockJurySCAddress);
      });

      it("Should revert for non-registered contract", async function () {
        await expect(
          registry.getRoundByContract(CHAIN_ID_LOCAL, user1.address)
        ).to.be.revertedWith("Round not found for contract");
      });

      it("Should revert for wrong chain ID", async function () {
        await expect(
          registry.getRoundByContract(CHAIN_ID_TESTNET, mockJurySCAddress)
        ).to.be.revertedWith("Round not found for contract");
      });
    });

    describe("getPrevRoundContracts", function () {
      let jurySC2Address;
      let jurySC3Address;

      beforeEach(async function () {
        const MockJurySC = await ethers.getContractFactory("MockJurySC");
        const jurySC2 = await MockJurySC.deploy();
        const jurySC3 = await MockJurySC.deploy();
        jurySC2Address = await jurySC2.getAddress();
        jurySC3Address = await jurySC3.getAddress();

        await registry.addRound(1, 1, mockJurySCAddress, 100);
        await registry.addRound(1, 2, jurySC2Address, 200);
        await registry.addRound(1, 3, jurySC3Address, 300);
      });

      it("Should return empty array for first round", async function () {
        const prevRounds = await registry.getPrevRoundContracts(CHAIN_ID_LOCAL, mockJurySCAddress);
        expect(prevRounds).to.deep.equal([]);
      });

      it("Should return one previous round for second round", async function () {
        const prevRounds = await registry.getPrevRoundContracts(CHAIN_ID_LOCAL, jurySC2Address);
        expect(prevRounds.length).to.equal(1);
        expect(prevRounds[0]).to.equal(mockJurySCAddress);
      });

      it("Should return all previous rounds for later rounds", async function () {
        const prevRounds = await registry.getPrevRoundContracts(CHAIN_ID_LOCAL, jurySC3Address);
        expect(prevRounds.length).to.equal(2);
        expect(prevRounds[0]).to.equal(mockJurySCAddress);
        expect(prevRounds[1]).to.equal(jurySC2Address);
      });

      it("Should revert for non-registered contract", async function () {
        await expect(
          registry.getPrevRoundContracts(CHAIN_ID_LOCAL, user1.address)
        ).to.be.revertedWith("Round not found for contract");
      });
    });
  });

  // ========== ITERATION METADATA TESTS ==========

  describe("Iteration Metadata", function () {
    const mockJurySCAddr = "0x837992aC7b89c148F7e42755816e74E84CF985AD";

    it("Should allow owner to set iteration metadata", async function () {
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, SAMPLE_CID)
      )
        .to.emit(registry, "IterationMetadataSet")
        .withArgs(CHAIN_ID_TESTNET, mockJurySCAddr, SAMPLE_CID, owner.address);

      const cid = await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr);
      expect(cid).to.equal(SAMPLE_CID);
    });

    it("Should allow owner to update iteration metadata", async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, SAMPLE_CID);
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, UPDATED_CID);

      const cid = await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr);
      expect(cid).to.equal(UPDATED_CID);
    });

    it("Should not allow non-owner to set iteration metadata", async function () {
      await expect(
        registry.connect(user1).setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, SAMPLE_CID)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("Should revert with invalid contract address", async function () {
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, ethers.ZeroAddress, SAMPLE_CID)
      ).to.be.revertedWith("Invalid contract address");
    });

    it("Should revert with empty CID", async function () {
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, "")
      ).to.be.revertedWith("CID cannot be empty");
    });

    it("Should return empty string for unset metadata", async function () {
      const cid = await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr);
      expect(cid).to.equal("");
    });

    it("Should handle multiple chains independently", async function () {
      const testnetCID = "QmTestnet123";
      const mainnetCID = "QmMainnet456";

      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, testnetCID);
      await registry.setIterationMetadata(CHAIN_ID_MAINNET, mockJurySCAddr, mainnetCID);

      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr)).to.equal(testnetCID);
      expect(await registry.getIterationMetadata(CHAIN_ID_MAINNET, mockJurySCAddr)).to.equal(mainnetCID);
    });
  });

  // ========== PROJECT METADATA TESTS ==========

  describe("Project Metadata", function () {
    let mockJurySCAddress;

    beforeEach(async function () {
      mockJurySCAddress = await mockJurySC.getAddress();
      await registry.registerIteration(1, CHAIN_ID_LOCAL);
      await registry.addRound(1, 1, mockJurySCAddress, 0);
    });

    describe("During initialization phase", function () {
      it("Should allow owner to set any project metadata", async function () {
        await expect(
          registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmTest1")
        ).to.emit(registry, "ProjectMetadataSet");

        await expect(
          registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project2.address, "QmTest2")
        ).to.emit(registry, "ProjectMetadataSet");

        expect(await registry.getProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address)).to.equal("QmTest1");
        expect(await registry.getProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project2.address)).to.equal("QmTest2");
      });

      it("Should NOT allow projects to set their own metadata during init", async function () {
        await expect(
          registry.connect(project1).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmTest1")
        ).to.be.revertedWith("Only owner can set metadata during initialization");
      });

      it("Should NOT allow non-owner to set project metadata during init", async function () {
        await expect(
          registry.connect(otherUser).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmTest1")
        ).to.be.revertedWith("Only owner can set metadata during initialization");
      });

      it("Should show initializationComplete as false", async function () {
        expect(await registry.initializationComplete()).to.be.false;
      });
    });

    describe("After completing initialization", function () {
      beforeEach(async function () {
        await registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmInitial1");
        await registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project2.address, "QmInitial2");
        await registry.completeInitialization();
      });

      it("Should show initializationComplete as true", async function () {
        expect(await registry.initializationComplete()).to.be.true;
      });

      it("Should allow authorized projects to set their own metadata", async function () {
        await expect(
          registry.connect(project1).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmUpdated1")
        ).to.emit(registry, "ProjectMetadataSet");

        expect(await registry.getProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address)).to.equal("QmUpdated1");
      });

      it("Should NOT allow projects to set other projects' metadata", async function () {
        await expect(
          registry.connect(project1).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project2.address, "QmHack")
        ).to.be.revertedWith("Can only set own metadata");
      });

      it("Should NOT allow owner to set project metadata after init", async function () {
        await expect(
          registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmOwnerHack")
        ).to.be.revertedWith("Can only set own metadata");
      });

      it("Should NOT allow unauthorized projects to set metadata", async function () {
        await expect(
          registry.connect(otherUser).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, otherUser.address, "QmUnauth")
        ).to.be.revertedWith("Project not registered in JurySC");
      });

      it("Should still allow owner to set iteration metadata", async function () {
        await expect(
          registry.setIterationMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, "QmIterationMetadata")
        ).to.emit(registry, "IterationMetadataSet");

        expect(await registry.getIterationMetadata(CHAIN_ID_LOCAL, mockJurySCAddress)).to.equal("QmIterationMetadata");
      });
    });

    describe("Validation", function () {
      it("Should revert setProjectMetadata with zero project address", async function () {
        await expect(
          registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, ethers.ZeroAddress, SAMPLE_CID)
        ).to.be.revertedWith("Invalid project address");
      });

      it("Should revert setProjectMetadata with zero jurySC address", async function () {
        await expect(
          registry.setProjectMetadata(CHAIN_ID_LOCAL, ethers.ZeroAddress, user1.address, SAMPLE_CID)
        ).to.be.revertedWith("Invalid contract address");
      });

      it("Should revert setProjectMetadata with empty CID", async function () {
        await expect(
          registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "")
        ).to.be.revertedWith("CID cannot be empty");
      });

      it("Should revert setProjectMetadata with CID too long", async function () {
        const longCID = "Q" + "m".repeat(100);
        await expect(
          registry.setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, longCID)
        ).to.be.revertedWith("CID too long");
      });
    });
  });

  // ========== INITIALIZATION CONTROL TESTS ==========

  describe("Initialization Control", function () {
    it("Should emit InitializationCompleted event", async function () {
      const tx = await registry.completeInitialization();
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(registry, "InitializationCompleted")
        .withArgs(owner.address, block.timestamp);
    });

    it("Should NOT allow completing initialization twice", async function () {
      await registry.completeInitialization();

      await expect(
        registry.completeInitialization()
      ).to.be.revertedWith("Initialization already complete");
    });

    it("Should only allow owner to complete initialization", async function () {
      await expect(
        registry.connect(user1).completeInitialization()
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });

  // ========== TIME WINDOW ENFORCEMENT TESTS ==========

  describe("Time Window Enforcement", function () {
    let mockJurySCAddress;

    beforeEach(async function () {
      mockJurySCAddress = await mockJurySC.getAddress();
      await registry.registerIteration(1, CHAIN_ID_LOCAL);
      await registry.addRound(1, 1, mockJurySCAddress, 0);
      await registry.completeInitialization();
    });

    it("Should allow projects to set metadata BEFORE projectsLocked", async function () {
      await expect(
        registry.connect(project1).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmTest")
      ).to.emit(registry, "ProjectMetadataSet");
    });

    it("Should NOT allow projects to set metadata AFTER projectsLocked", async function () {
      await mockJurySC.lockProjects();

      await expect(
        registry.connect(project1).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, project1.address, "QmTest")
      ).to.be.revertedWith("Metadata editing closed (voting started)");
    });

    it("Should NOT allow unregistered projects to set metadata", async function () {
      await expect(
        registry.connect(otherUser).setProjectMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, otherUser.address, "QmTest")
      ).to.be.revertedWith("Project not registered in JurySC");
    });
  });

  // ========== ITERATION METADATA LOCKING TESTS ==========

  describe("Iteration Metadata Locking", function () {
    let mockJurySCAddress;

    beforeEach(async function () {
      mockJurySCAddress = await mockJurySC.getAddress();
      await registry.registerIteration(1, CHAIN_ID_LOCAL);
      await registry.addRound(1, 1, mockJurySCAddress, 0);
    });

    it("Should allow owner to set iteration metadata BEFORE lock", async function () {
      await expect(
        registry.setIterationMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, "QmIterationTest")
      ).to.emit(registry, "IterationMetadataSet");
    });

    it("Should allow owner to set iteration metadata for LOCKED iteration DURING init phase", async function () {
      await mockJurySC.lockContractForHistory();

      await expect(
        registry.setIterationMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, "QmHistoricalIteration")
      ).to.emit(registry, "IterationMetadataSet");
    });

    it("Should NOT allow owner to set iteration metadata AFTER lock (post-init)", async function () {
      await registry.completeInitialization();
      await mockJurySC.lockContractForHistory();

      await expect(
        registry.setIterationMetadata(CHAIN_ID_LOCAL, mockJurySCAddress, "QmIterationTest")
      ).to.be.revertedWith("Iteration locked (cannot modify historical data)");
    });
  });

  // ========== BATCH OPERATIONS TESTS ==========

  describe("Batch Operations", function () {
    const mockJurySCAddr = "0x837992aC7b89c148F7e42755816e74E84CF985AD";

    it("Should handle batch get project metadata", async function () {
      const cids = await registry.batchGetProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySCAddr,
        [user1.address, user2.address]
      );
      expect(cids).to.deep.equal(["", ""]);
    });

    it("Should return correct CIDs for projects with metadata", async function () {
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, user1.address, "QmUser1");
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, user2.address, "QmUser2");

      const cids = await registry.batchGetProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySCAddr,
        [user1.address, user2.address]
      );
      expect(cids).to.deep.equal(["QmUser1", "QmUser2"]);
    });

    it("Should enforce MAX_BATCH_SIZE in batchGetProjectMetadata", async function () {
      const addresses = Array(51).fill(user1.address);
      await expect(
        registry.batchGetProjectMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, addresses)
      ).to.be.revertedWith("Batch size too large");
    });

    it("Should handle empty array", async function () {
      const cids = await registry.batchGetProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySCAddr,
        []
      );
      expect(cids).to.deep.equal([]);
    });

    it("Should handle exactly MAX_BATCH_SIZE addresses", async function () {
      const addresses = Array(50).fill(user1.address);
      const cids = await registry.batchGetProjectMetadata(
        CHAIN_ID_TESTNET,
        mockJurySCAddr,
        addresses
      );
      expect(cids.length).to.equal(50);
    });
  });

  // ========== UUPS UPGRADEABILITY TESTS ==========

  describe("UUPS Upgradeability", function () {
    it("Should allow owner to upgrade", async function () {
      const PoBRegistryV2 = await ethers.getContractFactory("PoBRegistry");
      await expect(
        upgrades.upgradeProxy(await registry.getAddress(), PoBRegistryV2)
      ).to.not.be.reverted;
    });

    it("Should not allow non-owner to upgrade", async function () {
      const registryAddress = await registry.getAddress();
      const PoBRegistryV2 = await ethers.getContractFactory("PoBRegistry", user1);

      await expect(
        upgrades.upgradeProxy(registryAddress, PoBRegistryV2)
      ).to.be.reverted;
    });

    it("Should preserve state after upgrade", async function () {
      await registry.registerIteration(1, CHAIN_ID_TESTNET);
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, user1.address, SAMPLE_CID);

      const PoBRegistryV2 = await ethers.getContractFactory("PoBRegistry");
      const upgraded = await upgrades.upgradeProxy(await registry.getAddress(), PoBRegistryV2);

      expect(await upgraded.iterationCount()).to.equal(1);
      expect(await upgraded.getIterationMetadata(CHAIN_ID_TESTNET, user1.address)).to.equal(SAMPLE_CID);
    });
  });

  // ========== EDGE CASES AND VALIDATION TESTS ==========

  describe("Edge Cases and Validation", function () {
    const mockJurySCAddr = "0x837992aC7b89c148F7e42755816e74E84CF985AD";

    it("Should enforce MAX_CID_LENGTH limit", async function () {
      const longCID = "Q" + "m".repeat(100);
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, longCID)
      ).to.be.revertedWith("CID too long");
    });

    it("Should allow CID at exactly MAX_CID_LENGTH", async function () {
      const maxCID = "Q" + "m".repeat(99); // 100 chars total
      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, maxCID)
      ).to.not.be.reverted;
    });

    it("Should handle special characters in CID", async function () {
      const specialCID = "QmTest-123_ABC.xyz";
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, specialCID);
      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr)).to.equal(specialCID);
    });

    it("Should handle maximum uint256 for chainId", async function () {
      const maxChainId = ethers.MaxUint256;
      await registry.setIterationMetadata(maxChainId, mockJurySCAddr, SAMPLE_CID);
      expect(await registry.getIterationMetadata(maxChainId, mockJurySCAddr)).to.equal(SAMPLE_CID);
    });

    it("Should handle zero chainId for metadata (but not for iteration registration)", async function () {
      await registry.setIterationMetadata(0, mockJurySCAddr, SAMPLE_CID);
      expect(await registry.getIterationMetadata(0, mockJurySCAddr)).to.equal(SAMPLE_CID);
    });
  });

  // ========== VOTING MODE OVERRIDE TESTS ==========

  describe("Voting Mode Override (v4)", function () {
    const jurySCAddr = "0x837992aC7b89c148F7e42755816e74E84CF985AD";

    describe("setVotingModeOverride", function () {
      it("Should store correct value for CONSENSUS (0)", async function () {
        await registry.setVotingModeOverride(jurySCAddr, 0);
        // Stored as mode + 1 = 1
        expect(await registry.votingModeOverride(jurySCAddr)).to.equal(1);
      });

      it("Should store correct value for WEIGHTED (1)", async function () {
        await registry.setVotingModeOverride(jurySCAddr, 1);
        // Stored as mode + 1 = 2
        expect(await registry.votingModeOverride(jurySCAddr)).to.equal(2);
      });

      it("Should emit VotingModeOverrideSet event", async function () {
        await expect(registry.setVotingModeOverride(jurySCAddr, 1))
          .to.emit(registry, "VotingModeOverrideSet")
          .withArgs(jurySCAddr, 1);
      });

      it("Should revert for non-owner", async function () {
        await expect(
          registry.connect(user1).setVotingModeOverride(jurySCAddr, 1)
        ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      });

      it("Should revert for invalid mode (> 1)", async function () {
        await expect(
          registry.setVotingModeOverride(jurySCAddr, 2)
        ).to.be.revertedWith("Invalid voting mode");
      });

      it("Should revert for zero address", async function () {
        await expect(
          registry.setVotingModeOverride(ethers.ZeroAddress, 1)
        ).to.be.revertedWith("Invalid address");
      });
    });

    describe("votingModeOverride", function () {
      it("Should return 0 when not set", async function () {
        expect(await registry.votingModeOverride(jurySCAddr)).to.equal(0);
      });

      it("Should return correct value after being set", async function () {
        await registry.setVotingModeOverride(jurySCAddr, 1);
        expect(await registry.votingModeOverride(jurySCAddr)).to.equal(2);
      });
    });
  });

  // ========== OWNERSHIP TESTS ==========

  describe("Ownership", function () {
    it("Should allow ownership renouncement", async function () {
      await expect(registry.renounceOwnership()).to.not.be.reverted;
      expect(await registry.owner()).to.equal(ethers.ZeroAddress);
    });

    it("Should allow ownership transfer", async function () {
      await registry.transferOwnership(user1.address);
      expect(await registry.owner()).to.equal(user1.address);
    });

    it("Should allow new owner to perform admin functions", async function () {
      await registry.transferOwnership(user1.address);

      await expect(
        registry.connect(user1).registerIteration(1, CHAIN_ID_TESTNET)
      ).to.not.be.reverted;
    });
  });

  // ========== DATA ISOLATION TESTS ==========

  describe("Data Isolation", function () {
    const jurySC1 = "0x837992aC7b89c148F7e42755816e74E84CF985AD";
    const jurySC2 = "0x9F4BDF3E9E2B5E6F2C5A8D3B1A4E7C9F6B2D8A5C";

    it("Should isolate iteration metadata by chain and jurySC", async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, jurySC1, "QmTestnet1");
      await registry.setIterationMetadata(CHAIN_ID_MAINNET, jurySC1, "QmMainnet1");
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, jurySC2, "QmTestnet2");

      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, jurySC1)).to.equal("QmTestnet1");
      expect(await registry.getIterationMetadata(CHAIN_ID_MAINNET, jurySC1)).to.equal("QmMainnet1");
      expect(await registry.getIterationMetadata(CHAIN_ID_TESTNET, jurySC2)).to.equal("QmTestnet2");
    });

    it("Should isolate project metadata across different iterations", async function () {
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, jurySC1, user1.address, "QmIter1");
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, jurySC2, user1.address, "QmIter2");

      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, jurySC1, user1.address)).to.equal("QmIter1");
      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, jurySC2, user1.address)).to.equal("QmIter2");
    });

    it("Should isolate project metadata across different projects", async function () {
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, jurySC1, user1.address, "QmProject1");
      await registry.setProjectMetadata(CHAIN_ID_TESTNET, jurySC1, user2.address, "QmProject2");

      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, jurySC1, user1.address)).to.equal("QmProject1");
      expect(await registry.getProjectMetadata(CHAIN_ID_TESTNET, jurySC1, user2.address)).to.equal("QmProject2");
    });
  });

  // ========== EVENT EMISSION TESTS ==========

  describe("Event Emission", function () {
    const mockJurySCAddr = "0x837992aC7b89c148F7e42755816e74E84CF985AD";

    it("Should emit ProjectMetadataSet with correct setter address for owner", async function () {
      await expect(
        registry.setProjectMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, user1.address, SAMPLE_CID)
      )
        .to.emit(registry, "ProjectMetadataSet")
        .withArgs(CHAIN_ID_TESTNET, mockJurySCAddr, user1.address, SAMPLE_CID, owner.address);
    });

    it("Should emit events when updating existing metadata", async function () {
      await registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, SAMPLE_CID);

      await expect(
        registry.setIterationMetadata(CHAIN_ID_TESTNET, mockJurySCAddr, UPDATED_CID)
      )
        .to.emit(registry, "IterationMetadataSet")
        .withArgs(CHAIN_ID_TESTNET, mockJurySCAddr, UPDATED_CID, owner.address);
    });

    it("Should emit IterationRegistered event", async function () {
      await expect(registry.registerIteration(1, CHAIN_ID_TESTNET))
        .to.emit(registry, "IterationRegistered")
        .withArgs(1, CHAIN_ID_TESTNET);
    });

    it("Should emit RoundAdded event with pob address", async function () {
      const mockJurySCAddress = await mockJurySC.getAddress();
      await registry.registerIteration(1, CHAIN_ID_LOCAL);

      // MockJurySC doesn't implement pob(), so it will emit zero address
      await expect(registry.addRound(1, 1, mockJurySCAddress, 100))
        .to.emit(registry, "RoundAdded")
        .withArgs(1, 1, mockJurySCAddress, ethers.ZeroAddress, CHAIN_ID_LOCAL);
    });
  });

  // ========== MAX ROUNDS LIMIT TEST ==========

  describe("Max Rounds Limit", function () {
    it("Should enforce MAX_ROUNDS_PER_ITERATION limit", async function () {
      await registry.registerIteration(1, CHAIN_ID_LOCAL);

      const MockJurySC = await ethers.getContractFactory("MockJurySC");

      // Add 100 rounds (the max)
      for (let i = 1; i <= 100; i++) {
        const jurySC = await MockJurySC.deploy();
        await registry.addRound(1, i, await jurySC.getAddress(), i * 100);
      }

      const iteration = await registry.iterations(1);
      expect(iteration.roundCount).to.equal(100);

      // Try to add one more - should fail (roundId 101 exceeds max)
      const extraJurySC = await MockJurySC.deploy();
      await expect(
        registry.addRound(1, 101, await extraJurySC.getAddress(), 10100)
      ).to.be.revertedWith("Round ID exceeds max");
    });
  });

  // ========== PROFILE STORAGE TESTS ==========

  describe("Profile Storage (v2)", function () {
    const PICTURE_CID = "QmProfilePicture123456789";
    const BIO_CID = "QmProfileBio123456789";

    describe("setProfilePicture", function () {
      it("Should allow any user to set their own profile picture", async function () {
        await expect(registry.connect(user1).setProfilePicture(PICTURE_CID))
          .to.emit(registry, "ProfilePictureSet")
          .withArgs(user1.address, PICTURE_CID);

        expect(await registry.profilePictureCID(user1.address)).to.equal(PICTURE_CID);
      });

      it("Should allow updating profile picture", async function () {
        await registry.connect(user1).setProfilePicture(PICTURE_CID);
        const newCID = "QmNewPicture";
        await registry.connect(user1).setProfilePicture(newCID);

        expect(await registry.profilePictureCID(user1.address)).to.equal(newCID);
      });

      it("Should allow clearing profile picture with empty CID", async function () {
        await registry.connect(user1).setProfilePicture(PICTURE_CID);
        await registry.connect(user1).setProfilePicture("");

        expect(await registry.profilePictureCID(user1.address)).to.equal("");
      });

      it("Should revert with CID too long", async function () {
        const longCID = "Q" + "m".repeat(100);
        await expect(
          registry.connect(user1).setProfilePicture(longCID)
        ).to.be.revertedWith("CID too long");
      });

      it("Should isolate profile pictures between users", async function () {
        await registry.connect(user1).setProfilePicture("QmUser1Pic");
        await registry.connect(user2).setProfilePicture("QmUser2Pic");

        expect(await registry.profilePictureCID(user1.address)).to.equal("QmUser1Pic");
        expect(await registry.profilePictureCID(user2.address)).to.equal("QmUser2Pic");
      });
    });

    describe("setProfileBio", function () {
      it("Should allow any user to set their own bio", async function () {
        await expect(registry.connect(user1).setProfileBio(BIO_CID))
          .to.emit(registry, "ProfileBioSet")
          .withArgs(user1.address, BIO_CID);

        expect(await registry.profileBioCID(user1.address)).to.equal(BIO_CID);
      });

      it("Should allow updating bio", async function () {
        await registry.connect(user1).setProfileBio(BIO_CID);
        const newCID = "QmNewBio";
        await registry.connect(user1).setProfileBio(newCID);

        expect(await registry.profileBioCID(user1.address)).to.equal(newCID);
      });

      it("Should revert with CID too long", async function () {
        const longCID = "Q" + "m".repeat(100);
        await expect(
          registry.connect(user1).setProfileBio(longCID)
        ).to.be.revertedWith("CID too long");
      });
    });

    describe("Upgrade preserves profile state", function () {
      it("Should preserve profile data after upgrade", async function () {
        await registry.connect(user1).setProfilePicture(PICTURE_CID);
        await registry.connect(user1).setProfileBio(BIO_CID);

        const PoBRegistryV2 = await ethers.getContractFactory("PoBRegistry");
        const upgraded = await upgrades.upgradeProxy(await registry.getAddress(), PoBRegistryV2);

        expect(await upgraded.profilePictureCID(user1.address)).to.equal(PICTURE_CID);
        expect(await upgraded.profileBioCID(user1.address)).to.equal(BIO_CID);
      });
    });
  });
});
