import { expect } from "chai";
import hre from "hardhat";
const { ethers, upgrades } = hre;

describe("V1Adapter", function () {
  const DEPOSIT = ethers.parseEther("30");
  const ITERATION = 1;

  let pob, jurySC, adapter, registry;
  let owner, devRel, daoHic1, daoHic2, project1, project2, community1;

  beforeEach(async function () {
    [owner, devRel, daoHic1, daoHic2, project1, project2, community1] =
      await ethers.getSigners();

    // Deploy PoB_01
    const PoB_01 = await ethers.getContractFactory("PoB_01");
    pob = await PoB_01.deploy("PoB #1", "POB01", ITERATION, owner.address);
    await pob.waitForDeployment();

    // Deploy JurySC_01 proxy
    const JurySC_01 = await ethers.getContractFactory("JurySC_01");
    jurySC = await upgrades.deployProxy(
      JurySC_01,
      [await pob.getAddress(), ITERATION, owner.address],
      { kind: "uups" }
    );
    await jurySC.waitForDeployment();

    // Transfer PoB ownership to JurySC
    await pob.connect(owner).transferOwnership(await jurySC.getAddress());

    // Deploy PoBRegistry proxy
    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    registry = await upgrades.deployProxy(
      PoBRegistry,
      [owner.address],
      { initializer: "initialize" }
    );
    await registry.waitForDeployment();

    // Deploy V1Adapter with registry address
    const V1Adapter = await ethers.getContractFactory("V1Adapter");
    adapter = await V1Adapter.deploy(await registry.getAddress());
    await adapter.waitForDeployment();

    // Setup: register projects, devrel, dao_hic voters
    await jurySC.connect(owner).registerProject(project1.address);
    await jurySC.connect(owner).registerProject(project2.address);
    await jurySC.connect(owner).setDevRelAccount(devRel.address);
    await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
    await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);
  });

  describe("Lifecycle passthroughs", function () {
    it("returns correct iteration", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.iteration(sc)).to.equal(ITERATION);
    });

    it("returns correct isActive before activation", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.isActive(sc)).to.be.false;
    });

    it("returns startTime/endTime after activation", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();
      expect(await adapter.startTime(sc)).to.be.gt(0);
      expect(await adapter.endTime(sc)).to.be.gt(await adapter.startTime(sc));
      expect(await adapter.isActive(sc)).to.be.true;
    });

    it("returns votingEnded and hasVotingEnded", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.votingEnded(sc)).to.be.false;
      expect(await adapter.hasVotingEnded(sc)).to.be.false;
    });
  });

  describe("State passthroughs", function () {
    it("returns locked state", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.locked(sc)).to.be.false;
    });

    it("returns projectsLocked state", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.projectsLocked(sc)).to.be.false;
      await jurySC.connect(owner).activate();
      expect(await adapter.projectsLocked(sc)).to.be.true;
    });

    it("returns votingMode (0=CONSENSUS default)", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.votingMode(sc)).to.equal(0);
    });

    it("returns owner", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.owner(sc)).to.equal(owner.address);
    });
  });

  describe("Projects", function () {
    it("getProjectAddresses builds array from projectCount+projectAddress", async function () {
      const sc = await jurySC.getAddress();
      const addresses = await adapter.getProjectAddresses(sc);
      expect(addresses.length).to.equal(2);
      expect(addresses[0]).to.equal(project1.address);
      expect(addresses[1]).to.equal(project2.address);
    });

    it("isRegisteredProject", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.isRegisteredProject(sc, project1.address)).to.be.true;
      expect(await adapter.isRegisteredProject(sc, community1.address)).to.be.false;
    });
  });

  describe("Entity-generic functions", function () {
    it("getEntityVoters(0) returns [devRelAccount]", async function () {
      const sc = await jurySC.getAddress();
      const voters = await adapter.getEntityVoters(sc, 0);
      expect(voters.length).to.equal(1);
      expect(voters[0]).to.equal(devRel.address);
    });

    it("getEntityVoters(1) returns daoHicVoters", async function () {
      const sc = await jurySC.getAddress();
      const voters = await adapter.getEntityVoters(sc, 1);
      expect(voters.length).to.equal(2);
      expect(voters[0]).to.equal(daoHic1.address);
      expect(voters[1]).to.equal(daoHic2.address);
    });

    it("reverts on invalid entityId", async function () {
      const sc = await jurySC.getAddress();
      await expect(adapter.getEntityVoters(sc, 2))
        .to.be.revertedWithCustomError(adapter, "InvalidEntityId")
        .withArgs(2);
    });

    it("isEntityVoter works for both entities", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.isEntityVoter(sc, 0, devRel.address)).to.be.true;
      expect(await adapter.isEntityVoter(sc, 0, community1.address)).to.be.false;
      expect(await adapter.isEntityVoter(sc, 1, daoHic1.address)).to.be.true;
      expect(await adapter.isEntityVoter(sc, 1, community1.address)).to.be.false;
    });

    it("entityHasVoted and entityVoteOf after voting", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      // DevRel votes
      await jurySC.connect(devRel).voteDevRel(project1.address);
      expect(await adapter.entityHasVoted(sc, 0, devRel.address)).to.be.true;
      expect(await adapter.entityVoteOf(sc, 0, devRel.address)).to.equal(project1.address);

      // DAO_HIC votes
      await jurySC.connect(daoHic1).voteDaoHic(project2.address);
      expect(await adapter.entityHasVoted(sc, 1, daoHic1.address)).to.be.true;
      expect(await adapter.entityVoteOf(sc, 1, daoHic1.address)).to.equal(project2.address);
    });

    it("getEntityVote returns entity consensus vote", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      expect(await adapter.getEntityVote(sc, 0)).to.equal(project1.address);

      await jurySC.connect(daoHic1).voteDaoHic(project2.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address);
      expect(await adapter.getEntityVote(sc, 1)).to.equal(project2.address);
    });
  });

  describe("Community functions", function () {
    it("communityVoteOf and communityHasVoted", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      // Mint community NFT
      await pob.connect(community1).mint({ value: DEPOSIT });

      // Vote
      await jurySC.connect(community1).voteCommunity(0, project1.address);

      expect(await adapter.communityHasVoted(sc, 0)).to.be.true;
      expect(await adapter.communityVoteOf(sc, 0)).to.equal(project1.address);
    });

    it("getCommunityEntityVote", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await pob.connect(community1).mint({ value: DEPOSIT });
      await jurySC.connect(community1).voteCommunity(0, project1.address);

      expect(await adapter.getCommunityEntityVote(sc)).to.equal(project1.address);
    });
  });

  describe("Aggregates", function () {
    it("getVoteParticipationCounts", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);

      const [devRelCount, daoHicCount, communityCount] =
        await adapter.getVoteParticipationCounts(sc);
      expect(devRelCount).to.equal(1);
      expect(daoHicCount).to.equal(1);
      expect(communityCount).to.equal(0);
    });

    it("getProjectVoteBreakdown", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await pob.connect(community1).mint({ value: DEPOSIT });
      await jurySC.connect(community1).voteCommunity(0, project1.address);

      const [daoVotes, communityVotes] = await adapter.getProjectVoteBreakdown(sc, project1.address);
      expect(daoVotes).to.equal(1);
      expect(communityVotes).to.equal(1);
    });
  });

  describe("Results", function () {
    it("getWinner, getWinnerConsensus", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);

      const [winner, hasWinner] = await adapter.getWinner(sc);
      expect(winner).to.equal(project1.address);
      expect(hasWinner).to.be.true;

      const [winnerC, hasWinnerC] = await adapter.getWinnerConsensus(sc);
      expect(winnerC).to.equal(project1.address);
      expect(hasWinnerC).to.be.true;
    });

    it("getWinnerWeighted", async function () {
      // Set weighted mode
      await jurySC.connect(owner).setVotingMode(1); // WEIGHTED
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);

      const [winner, hasWinner] = await adapter.getWinnerWeighted(sc);
      expect(winner).to.equal(project1.address);
      expect(hasWinner).to.be.true;
    });

    it("getWinnerWithScores", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);

      const [projects, scores, totalPossible] = await adapter.getWinnerWithScores(sc);
      expect(projects.length).to.equal(2);
      expect(scores.length).to.equal(2);
      expect(totalPossible).to.be.gt(0);
    });
  });

  describe("Badge (PoB) reads", function () {
    it("pobAddress returns PoB contract", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.pobAddress(sc)).to.equal(await pob.getAddress());
    });

    it("pobIteration returns iteration", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.pobIteration(sc)).to.equal(ITERATION);
    });

    it("hasMintedBadge (uses hasMinted on V1)", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      expect(await adapter.hasMintedBadge(sc, community1.address)).to.be.false;
      await pob.connect(community1).mint({ value: DEPOSIT });
      expect(await adapter.hasMintedBadge(sc, community1.address)).to.be.true;
    });

    it("getRoleOf, claimed, ownerOfToken", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await pob.connect(community1).mint({ value: DEPOSIT });

      expect(await adapter.getRoleOf(sc, 0)).to.equal("Community");
      expect(await adapter.claimed(sc, 0)).to.be.false;
      expect(await adapter.ownerOfToken(sc, 0)).to.equal(community1.address);
    });
  });

  describe("Voting mode override via registry", function () {
    it("votingMode() returns override when set in registry", async function () {
      const sc = await jurySC.getAddress();

      // Default: contract returns 0 (CONSENSUS)
      expect(await adapter.votingMode(sc)).to.equal(0);

      // Set override to WEIGHTED (1)
      await registry.connect(owner).setVotingModeOverride(sc, 1);
      expect(await adapter.votingMode(sc)).to.equal(1);

      // Set override to CONSENSUS (0)
      await registry.connect(owner).setVotingModeOverride(sc, 0);
      expect(await adapter.votingMode(sc)).to.equal(0);
    });

    it("votingMode() returns contract value when no override set", async function () {
      const sc = await jurySC.getAddress();

      // Set contract to WEIGHTED mode
      await jurySC.connect(owner).setVotingMode(1);

      // No override set — adapter reads from contract
      expect(await adapter.votingMode(sc)).to.equal(1);
    });

    it("getWinner() returns weighted winner when override is WEIGHTED", async function () {
      // Contract is in CONSENSUS mode but override says WEIGHTED
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);

      // Set override to WEIGHTED
      await registry.connect(owner).setVotingModeOverride(sc, 1);

      // getWinner() should now route through getWinnerWeighted()
      const [winner, hasWinner] = await adapter.getWinner(sc);
      expect(winner).to.equal(project1.address);
      expect(hasWinner).to.be.true;
    });

    it("getWinner() uses base getWinner when no override", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);

      // No override — uses base getWinner (consensus)
      const [winner, hasWinner] = await adapter.getWinner(sc);
      expect(winner).to.equal(project1.address);
      expect(hasWinner).to.be.true;
    });

    it("adapter works with zero-address registry", async function () {
      // Deploy adapter with zero-address registry
      const V1Adapter = await ethers.getContractFactory("V1Adapter");
      const adapterNoRegistry = await V1Adapter.deploy(ethers.ZeroAddress);
      await adapterNoRegistry.waitForDeployment();

      const sc = await jurySC.getAddress();

      // Should still work, falling back to contract calls
      expect(await adapterNoRegistry.votingMode(sc)).to.equal(0);

      await jurySC.connect(owner).activate();
      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);

      const [winner, hasWinner] = await adapterNoRegistry.getWinner(sc);
      expect(winner).to.equal(project1.address);
      expect(hasWinner).to.be.true;
    });
  });
});
