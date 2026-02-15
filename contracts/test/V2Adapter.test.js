import { expect } from "chai";
import hre from "hardhat";
const { ethers, upgrades } = hre;

describe("V2Adapter", function () {
  const DEPOSIT = ethers.parseEther("30");
  const ITERATION = 2;

  let pob, jurySC, adapter;
  let owner, devRel, daoHic1, daoHic2, project1, project2, community1;

  beforeEach(async function () {
    [owner, devRel, daoHic1, daoHic2, project1, project2, community1] =
      await ethers.getSigners();

    // Deploy PoB_02
    const PoB_02 = await ethers.getContractFactory("PoB_02");
    pob = await PoB_02.deploy("PoB #2", "POB02", ITERATION, owner.address);
    await pob.waitForDeployment();

    // Deploy JurySC_02 proxy
    const JurySC_02 = await ethers.getContractFactory("JurySC_02");
    jurySC = await upgrades.deployProxy(
      JurySC_02,
      [await pob.getAddress(), ITERATION, owner.address],
      { kind: "uups" }
    );
    await jurySC.waitForDeployment();

    // Transfer PoB ownership to JurySC
    await pob.connect(owner).transferOwnership(await jurySC.getAddress());

    // Deploy V2Adapter
    const V2Adapter = await ethers.getContractFactory("V2Adapter");
    adapter = await V2Adapter.deploy();
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

    it("returns isActive, startTime, endTime after activation", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();
      expect(await adapter.isActive(sc)).to.be.true;
      expect(await adapter.startTime(sc)).to.be.gt(0);
      expect(await adapter.endTime(sc)).to.be.gt(0);
    });
  });

  describe("State", function () {
    it("returns votingMode", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.votingMode(sc)).to.equal(0); // CONSENSUS
    });

    it("returns owner", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.owner(sc)).to.equal(owner.address);
    });
  });

  describe("Projects", function () {
    it("getProjectAddresses uses native function", async function () {
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
    it("getEntityVoters(0) wraps devRelAccount", async function () {
      const sc = await jurySC.getAddress();
      const voters = await adapter.getEntityVoters(sc, 0);
      expect(voters.length).to.equal(1);
      expect(voters[0]).to.equal(devRel.address);
    });

    it("getEntityVoters(1) returns daoHicVoters", async function () {
      const sc = await jurySC.getAddress();
      const voters = await adapter.getEntityVoters(sc, 1);
      expect(voters.length).to.equal(2);
    });

    it("reverts on invalid entityId", async function () {
      const sc = await jurySC.getAddress();
      await expect(adapter.getEntityVoters(sc, 2))
        .to.be.revertedWithCustomError(adapter, "InvalidEntityId")
        .withArgs(2);
      await expect(adapter.entityVoteOf(sc, 3, owner.address))
        .to.be.revertedWithCustomError(adapter, "InvalidEntityId");
      await expect(adapter.entityHasVoted(sc, 4, owner.address))
        .to.be.revertedWithCustomError(adapter, "InvalidEntityId");
      await expect(adapter.isEntityVoter(sc, 5, owner.address))
        .to.be.revertedWithCustomError(adapter, "InvalidEntityId");
      await expect(adapter.getEntityVote(sc, 6))
        .to.be.revertedWithCustomError(adapter, "InvalidEntityId");
    });

    it("entityHasVoted and entityVoteOf after voting", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      expect(await adapter.entityHasVoted(sc, 0, devRel.address)).to.be.true;
      expect(await adapter.entityVoteOf(sc, 0, devRel.address)).to.equal(project1.address);

      await jurySC.connect(daoHic1).voteDaoHic(project2.address);
      expect(await adapter.entityHasVoted(sc, 1, daoHic1.address)).to.be.true;
      expect(await adapter.entityVoteOf(sc, 1, daoHic1.address)).to.equal(project2.address);
    });

    it("getEntityVote returns consensus for each entity", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      expect(await adapter.getEntityVote(sc, 0)).to.equal(project1.address);

      await jurySC.connect(daoHic1).voteDaoHic(project2.address);
      expect(await adapter.getEntityVote(sc, 1)).to.equal(project2.address);
    });
  });

  describe("Community", function () {
    it("community vote tracking", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await pob.connect(community1).mint({ value: DEPOSIT });
      await jurySC.connect(community1).voteCommunity(0, project1.address);

      expect(await adapter.communityHasVoted(sc, 0)).to.be.true;
      expect(await adapter.communityVoteOf(sc, 0)).to.equal(project1.address);
      expect(await adapter.getCommunityEntityVote(sc)).to.equal(project1.address);
    });
  });

  describe("Aggregates", function () {
    it("getVoteParticipationCounts", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      const [d, dao, c] = await adapter.getVoteParticipationCounts(sc);
      expect(d).to.equal(1);
      expect(dao).to.equal(0);
      expect(c).to.equal(0);
    });

    it("getProjectVoteBreakdown", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      const [daoV, commV] = await adapter.getProjectVoteBreakdown(sc, project1.address);
      expect(daoV).to.equal(1);
      expect(commV).to.equal(0);
    });
  });

  describe("Results", function () {
    it("getWinner and getWinnerConsensus", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);

      const [w, hw] = await adapter.getWinner(sc);
      expect(w).to.equal(project1.address);
      expect(hw).to.be.true;

      const [wc, hwc] = await adapter.getWinnerConsensus(sc);
      expect(wc).to.equal(project1.address);
      expect(hwc).to.be.true;
    });

    it("getWinnerWeighted", async function () {
      await jurySC.connect(owner).setVotingMode(1);
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      const [w, hw] = await adapter.getWinnerWeighted(sc);
      expect(w).to.equal(project1.address);
      expect(hw).to.be.true;
    });

    it("getWinnerWithScores", async function () {
      await jurySC.connect(owner).activate();
      const sc = await jurySC.getAddress();

      await jurySC.connect(devRel).voteDevRel(project1.address);
      const [projects, scores, total] = await adapter.getWinnerWithScores(sc);
      expect(projects.length).to.equal(2);
      expect(scores.length).to.equal(2);
      expect(total).to.be.gt(0);
    });
  });

  describe("Badge (PoB) reads", function () {
    it("pobAddress returns PoB_02 contract", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.pobAddress(sc)).to.equal(await pob.getAddress());
    });

    it("pobIteration returns iteration", async function () {
      const sc = await jurySC.getAddress();
      expect(await adapter.pobIteration(sc)).to.equal(ITERATION);
    });

    it("hasMintedBadge uses PoB_02.hasMintedBadge", async function () {
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
});
