import { expect } from "chai";
import pkg from "hardhat";

const { ethers, upgrades } = pkg;
const { deployContract } = pkg;

describe("JurySC_01 (address-based projects)", function () {
  const DEPOSIT = ethers.parseEther("30");
  const ITERATION = 1;

  let pob;
  let jurySC;
  let owner;
  let devRel;
  let daoHic1;
  let daoHic2;
  let project1;
  let project2;
  let project3;
  let community1;
  let community2;
  let community3;

  beforeEach(async function () {
    [
      owner,
      devRel,
      daoHic1,
      daoHic2,
      project1,
      project2,
      project3,
      community1,
      community2,
      community3,
    ] = await ethers.getSigners();

    const PoB_01 = await ethers.getContractFactory("PoB_01");
    pob = await PoB_01.deploy("Proof of Builders v1", "POB1", ITERATION, owner.address);
    await pob.waitForDeployment();

    const JurySC_01 = await ethers.getContractFactory("JurySC_01");
    jurySC = await upgrades.deployProxy(JurySC_01, [await pob.getAddress(), ITERATION, owner.address], {
      kind: "uups",
    });
    await jurySC.waitForDeployment();

    await pob.connect(owner).transferOwnership(await jurySC.getAddress());
  });

  describe("project registration", function () {
    it("indexes projects by address", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);

      expect(await jurySC.projectCount()).to.equal(2);
      expect(await jurySC.projectAddress(1)).to.equal(project1.address);
      expect(await jurySC.projectAddress(2)).to.equal(project2.address);
      expect(await jurySC.projectIdOf(project1.address)).to.equal(1);
      expect(await jurySC.isRegisteredProject(project1.address)).to.be.true;
    });

    it("prevents duplicate registration", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await expect(jurySC.connect(owner).registerProject(project1.address)).to.be.revertedWithCustomError(
        jurySC,
        "InvalidProject",
      );
    });

    it("restricts registration to owner", async function () {
      await expect(jurySC.connect(community1).registerProject(project1.address)).to.be.reverted;
    });
  });

  describe("project removal", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).registerProject(project3.address);
    });

    it("removes project before activation and compacts indexes", async function () {
      await jurySC.connect(owner).removeProject(project2.address);

      expect(await jurySC.projectCount()).to.equal(2);
      expect(await jurySC.isRegisteredProject(project2.address)).to.be.false;

      const addresses = [await jurySC.projectAddress(1), await jurySC.projectAddress(2)];
      expect(addresses).to.include(project1.address);
      expect(addresses).to.include(project3.address);
      expect(await jurySC.projectIdOf(project3.address)).to.be.oneOf([1n, 2n]);
    });

    it("reverts on unknown project", async function () {
      await expect(jurySC.connect(owner).removeProject(community1.address)).to.be.revertedWithCustomError(
        jurySC,
        "InvalidProject",
      );
    });

    it("disallows removal once projects locked", async function () {
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      await expect(jurySC.connect(owner).removeProject(project1.address)).to.be.revertedWithCustomError(
        jurySC,
        "ProjectsLocked",
      );
    });
  });

  describe("activation", function () {
    it("requires at least one project, devrel and dao voter", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);

      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      expect(await jurySC.projectsLocked()).to.equal(true);
      expect(await jurySC.startTime()).to.equal(now);
      expect(await jurySC.endTime()).to.equal(now + 48 * 3600);
    });

    it("reverts activation without projects", async function () {
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      const now = Math.floor(Date.now() / 1000);

      await expect(jurySC.connect(owner).activate(now)).to.be.revertedWithCustomError(jurySC, "InvalidProject");
    });
  });

  describe("voting", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);

      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      // Community can only mint after activation (during active voting)
      await pob.connect(community1).mint({ value: DEPOSIT });
      await pob.connect(community2).mint({ value: DEPOSIT });
    });

    it("allows community voting via project address", async function () {
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      expect(await jurySC.communityVoteOf(0)).to.equal(project1.address);
      expect(await jurySC.communityHasVoted(0)).to.be.true;

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts.devRelCount).to.equal(0n);
      expect(counts.daoHicCount).to.equal(0n);
      expect(counts.communityCount).to.equal(1n);
    });

    it("allows each community account to vote independently", async function () {
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(community2).voteCommunity(1, project2.address);

      expect(await jurySC.communityVoteOf(0)).to.equal(project1.address);
      expect(await jurySC.communityVoteOf(1)).to.equal(project2.address);
    });

    it("prevents voting for unregistered address", async function () {
      await expect(jurySC.connect(community1).voteCommunity(0, project3.address)).to.be.revertedWithCustomError(
        jurySC,
        "InvalidProject",
      );
    });

    it("allows DevRel voting via address", async function () {
      await jurySC.connect(devRel).voteDevRel(project2.address);
      expect(await jurySC.devRelVote()).to.equal(project2.address);
    });

    it("allows DAO_HIC voting via address", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project2.address);
      expect(await jurySC.daoHicVoteOf(daoHic1.address)).to.equal(project2.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts.daoHicCount).to.equal(1n);
    });

    it("allows each DAO_HIC voter to cast a vote", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address);

      expect(await jurySC.daoHicVoteOf(daoHic1.address)).to.equal(project1.address);
      expect(await jurySC.daoHicVoteOf(daoHic2.address)).to.equal(project2.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts.daoHicCount).to.equal(2n);
    });

    it("prevents a registered project from voting as DevRel even if assigned", async function () {
      await jurySC.connect(owner).setDevRelAccount(project1.address);

      await expect(jurySC.connect(project1).voteDevRel(project1.address)).to.be.revertedWithCustomError(
        jurySC,
        "ProjectCannotVote",
      );
    });

    it("prevents a registered project from voting as DAO_HIC even if listed", async function () {
      await jurySC.connect(owner).addDaoHicVoter(project1.address);

      await expect(jurySC.connect(project1).voteDaoHic(project1.address)).to.be.revertedWithCustomError(
        jurySC,
        "ProjectCannotVote",
      );
    });
  });

  describe("voting dynamics", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);

      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      // Community can only mint after activation (during active voting)
      await pob.connect(community1).mint({ value: DEPOSIT });
      await pob.connect(community2).mint({ value: DEPOSIT });
    });

    it("updates DevRel entity vote when the account revotes", async function () {
      await jurySC.connect(devRel).voteDevRel(project1.address);
      expect(await jurySC.getDevRelEntityVote()).to.equal(project1.address);

      await jurySC.connect(devRel).voteDevRel(project2.address);
      expect(await jurySC.getDevRelEntityVote()).to.equal(project2.address);
    });

    it("recalculates DAO_HIC majority when voters change votes", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);
      expect(await jurySC.getDaoHicEntityVote()).to.equal(project1.address);

      await jurySC.connect(daoHic2).voteDaoHic(project2.address);
      expect(await jurySC.getDaoHicEntityVote()).to.equal(ethers.ZeroAddress);

      await jurySC.connect(daoHic1).voteDaoHic(project2.address);
      expect(await jurySC.getDaoHicEntityVote()).to.equal(project2.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts.daoHicCount).to.equal(2n);
    });

    it("ignores removed DAO_HIC voter from tallies", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address);
      expect(await jurySC.getDaoHicEntityVote()).to.equal(ethers.ZeroAddress);

      await jurySC.connect(owner).removeDaoHicVoter(daoHic2.address);
      expect(await jurySC.daoHicHasVoted(daoHic2.address)).to.be.false;
      expect(await jurySC.daoHicVoteOf(daoHic2.address)).to.equal(ethers.ZeroAddress);
      expect(await jurySC.getDaoHicEntityVote()).to.equal(project1.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts.daoHicCount).to.equal(1n);
    });

    it("produces consistent winner after mixed vote changes", async function () {
      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address);
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(community2).voteCommunity(1, project2.address);

      let [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(project1.address);

      await jurySC.connect(devRel).voteDevRel(project2.address);
      await jurySC.connect(daoHic1).voteDaoHic(project2.address);

      [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(project2.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts.devRelCount).to.equal(1n);
      expect(counts.daoHicCount).to.equal(2n);
      expect(counts.communityCount).to.equal(2n);
    });
  });

  describe("voting stress cases", function () {
    const COMMUNITY_TOTAL = 70;
    const DAO_TOTAL = 10;
    let daoWallets;
    let communityWallets;
    let projectAddresses;

    beforeEach(async function () {
      projectAddresses = [project1.address, project2.address, project3.address];

      for (let i = 0; i < 2; i++) {
        const wallet = ethers.Wallet.createRandom();
        projectAddresses.push(wallet.address);
      }

      for (const projectAddr of projectAddresses) {
        await jurySC.connect(owner).registerProject(projectAddr);
      }
      await jurySC.connect(owner).setDevRelAccount(devRel.address);

      daoWallets = [];
      communityWallets = [];

      for (let i = 0; i < DAO_TOTAL; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        daoWallets.push(wallet);
        await owner.sendTransaction({ to: wallet.address, value: ethers.parseEther("5") });
        await jurySC.connect(owner).addDaoHicVoter(wallet.address);
      }

      for (let i = 0; i < COMMUNITY_TOTAL; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        communityWallets.push(wallet);
        await owner.sendTransaction({ to: wallet.address, value: ethers.parseEther("40") });
      }

      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      // Community can only mint after activation (during active voting)
      for (let i = 0; i < COMMUNITY_TOTAL; i++) {
        await pob.connect(communityWallets[i]).mint({ value: DEPOSIT });
      }
    });

    it("maintains accurate counts across large mixed voting sequences", async function () {
      const devRelSequence = [
        projectAddresses[0],
        projectAddresses[1],
        projectAddresses[2],
        projectAddresses[1],
        projectAddresses[0],
      ];

      const communityDistribution = [18, 20, 15, 10, 7];
      const expectedCommunityTallies = new Array(projectAddresses.length).fill(0);
      const expectedDaoTallies = new Array(projectAddresses.length).fill(0);
      const daoCurrentVotes = new Map();
      const communityCurrentVotes = new Map();

      const castDaoVote = async (index, project) => {
        const voterWallet = daoWallets[index];
        const previous = daoCurrentVotes.get(index);
        if (previous) {
          const prevIdx = projectAddresses.indexOf(previous);
          expectedDaoTallies[prevIdx]--;
        }
        await jurySC.connect(voterWallet).voteDaoHic(project);
        daoCurrentVotes.set(index, project);
        const newIdx = projectAddresses.indexOf(project);
        expectedDaoTallies[newIdx]++;
      };

      const castCommunityVote = async (index, project) => {
        const previous = communityCurrentVotes.get(index);
        if (previous) {
          const prevIdx = projectAddresses.indexOf(previous);
          expectedCommunityTallies[prevIdx]--;
        }
        await jurySC.connect(communityWallets[index]).voteCommunity(index, project);
        communityCurrentVotes.set(index, project);
        const pIdx = projectAddresses.indexOf(project);
        expectedCommunityTallies[pIdx]++;
      };

      await jurySC.connect(devRel).voteDevRel(projectAddresses[0]);

      const daoInitialTargets = [];
      for (let i = 0; i < DAO_TOTAL; i++) {
        daoInitialTargets.push(projectAddresses[i % projectAddresses.length]);
      }
      for (let i = 0; i < DAO_TOTAL; i++) {
        await castDaoVote(i, daoInitialTargets[i]);
      }

      let communityIndex = 0;
      for (let p = 0; p < projectAddresses.length; p++) {
        for (let j = 0; j < communityDistribution[p]; j++) {
          await castCommunityVote(communityIndex, projectAddresses[p]);
          communityIndex++;
        }
      }

      let counts = await jurySC.getVoteParticipationCounts();
      expect(counts.devRelCount).to.equal(1n);
      expect(counts.daoHicCount).to.equal(BigInt(DAO_TOTAL));
      expect(counts.communityCount).to.equal(BigInt(COMMUNITY_TOTAL));

      for (const target of devRelSequence) {
        await jurySC.connect(devRel).voteDevRel(target);
      }

      const daoSwitcherCount = Math.max(1, Math.floor(DAO_TOTAL / 10));
      const daoSwitchTargets = [
        projectAddresses[2],
        projectAddresses[3],
        projectAddresses[1],
      ];
      for (let i = 0; i < daoSwitcherCount; i++) {
        await castDaoVote(i, daoSwitchTargets[0]);
        await castDaoVote(i, daoSwitchTargets[1]);
        await castDaoVote(i, daoSwitchTargets[2]);
      }

      const daoMajorityTarget = projectAddresses[1];
      const daoMajorityCount = Math.floor(DAO_TOTAL * 0.7);
      for (let i = 0; i < daoMajorityCount; i++) {
        await castDaoVote(i, daoMajorityTarget);
      }

      // Test community vote changes: ~10% of community voters change their minds
      const communitySwitcherCount = Math.max(1, Math.floor(COMMUNITY_TOTAL * 0.1));
      const communitySwitchTargets = [
        projectAddresses[2],
        projectAddresses[3],
        projectAddresses[0],
      ];
      for (let i = 0; i < communitySwitcherCount; i++) {
        await castCommunityVote(i, communitySwitchTargets[0]);
        await castCommunityVote(i, communitySwitchTargets[1]);
        await castCommunityVote(i, communitySwitchTargets[2]);
      }

      expect(await jurySC.getDaoHicEntityVote()).to.equal(daoMajorityTarget);

      let [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(daoMajorityTarget);

      const removedIndex = 0;
      const removedVote = daoCurrentVotes.get(removedIndex);
      if (removedVote) {
        const removedIdx = projectAddresses.indexOf(removedVote);
        expectedDaoTallies[removedIdx]--;
      }
      await jurySC.connect(owner).removeDaoHicVoter(daoWallets[removedIndex].address);
      daoCurrentVotes.delete(removedIndex);

      counts = await jurySC.getVoteParticipationCounts();
      expect(counts.daoHicCount).to.equal(BigInt(DAO_TOTAL - 1));

      [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(daoMajorityTarget);

      const finalCounts = await jurySC.getVoteParticipationCounts();
      expect(finalCounts.devRelCount).to.equal(1n);
      expect(finalCounts.daoHicCount).to.equal(BigInt(DAO_TOTAL - 1));
      expect(finalCounts.communityCount).to.equal(BigInt(COMMUNITY_TOTAL));

      for (let i = 0; i < projectAddresses.length; i++) {
        const projectAddr = projectAddresses[i];
        const [daoVotes, communityVotes] = await jurySC.getProjectVoteBreakdown(projectAddr);
        expect(daoVotes).to.equal(BigInt(expectedDaoTallies[i]));
        expect(communityVotes).to.equal(BigInt(expectedCommunityTallies[i]));
      }
    });
  });

  describe("manual closure", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);

      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      // Community can only mint after activation (during active voting)
      await pob.connect(community1).mint({ value: DEPOSIT });
      await pob.connect(community2).mint({ value: DEPOSIT });
    });

    it("allows owner to close manually and records timestamp", async function () {
      await jurySC.connect(owner).closeManually();

      expect(await jurySC.manuallyClosed()).to.be.true;
      const manualEndTime = await jurySC.manualEndTime();
      expect(manualEndTime).to.be.gt(0);
      expect(await jurySC.isActive()).to.be.false;
      expect(await jurySC.votingEnded()).to.be.true;
    });

    it("prevents non-owner from closing manually", async function () {
      await expect(jurySC.connect(community1).closeManually()).to.be.reverted;
    });

    it("allows locking after manual close", async function () {
      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(owner).closeManually();

      await expect(jurySC.connect(owner).lockContractForHistory()).to.emit(jurySC, "ContractLockedForHistory");
    });

    it("reverts if closeManually is called twice", async function () {
      await jurySC.connect(owner).closeManually();
      await expect(jurySC.connect(owner).closeManually()).to.be.revertedWithCustomError(jurySC, "AlreadyClosed");
    });

    it("reverts manual close before activation", async function () {
      const jurySC2 = jurySC.connect(owner);
      const JurySC_01 = await ethers.getContractFactory("JurySC_01");
      const jurySCFresh = await upgrades.deployProxy(
        JurySC_01,
        [await pob.getAddress(), ITERATION, owner.address],
        { kind: "uups" }
      );
      await jurySCFresh.waitForDeployment();

      await expect(jurySCFresh.connect(owner).closeManually()).to.be.revertedWithCustomError(jurySCFresh, "NotActive");
    });
  });

  describe("entity aggregation", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);

      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      // Community can only mint after activation (during active voting)
      await pob.connect(community1).mint({ value: DEPOSIT });
      await pob.connect(community2).mint({ value: DEPOSIT });
    });

    it("returns majority address for DAO_HIC entity vote", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);

      expect(await jurySC.getDaoHicEntityVote()).to.equal(project1.address);
    });

    it("returns zero address on DAO_HIC tie", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address);

      expect(await jurySC.getDaoHicEntityVote()).to.equal(ethers.ZeroAddress);
    });

    it("returns majority address for Community entity vote", async function () {
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(community2).voteCommunity(1, project1.address);

      expect(await jurySC.getCommunityEntityVote()).to.equal(project1.address);
    });

    it("returns zero address on Community tie", async function () {
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(community2).voteCommunity(1, project2.address);

      expect(await jurySC.getCommunityEntityVote()).to.equal(ethers.ZeroAddress);
    });

    it("computes winner address when majority exists", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(devRel).voteDevRel(project1.address);

      const [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(project1.address);
    });

    it("returns no winner when entities split", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address);
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(devRel).voteDevRel(project2.address);

      const [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.false;
      expect(winner).to.equal(ethers.ZeroAddress);
    });
  });

  describe("PoB role minting", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).registerProject(project1.address);
    });

    it("allows DevRel account to mint via trusted owner reference", async function () {
      // DevRel can only mint after voting has ended
      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);
      await jurySC.connect(owner).closeManually();

      await expect(pob.connect(devRel).mintDevRel()).to.emit(pob, "Transfer").withArgs(
        ethers.ZeroAddress,
        devRel.address,
        0n,
      );
      expect(await pob.ownerOf(0)).to.equal(devRel.address);
      expect(await pob.getRoleOf(0)).to.equal("DevRel");
    });

    it("rejects DevRel mint from non-authorized account", async function () {
      await expect(pob.connect(community1).mintDevRel()).to.be.revertedWithCustomError(pob, "NotAuthorized");
    });

    it("allows DAO_HIC voter to mint without passing jury address", async function () {
      // DAO_HIC can only mint after voting has ended
      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);
      await jurySC.connect(owner).closeManually();

      await expect(pob.connect(daoHic1).mintDaoHic()).to.emit(pob, "Transfer").withArgs(
        ethers.ZeroAddress,
        daoHic1.address,
        0n,
      );
      expect(await pob.ownerOf(0)).to.equal(daoHic1.address);
      expect(await pob.getRoleOf(0)).to.equal("DAO-HIC");
    });

    it("allows registered project to mint its badge without external parameter", async function () {
      // Project can only mint after projects are locked (after activation)
      const now = Math.floor(Date.now() / 1000);
      await jurySC.connect(owner).activate(now);

      await expect(pob.connect(project1).mintProject()).to.emit(pob, "Transfer").withArgs(
        ethers.ZeroAddress,
        project1.address,
        0n,
      );
      expect(await pob.ownerOf(0)).to.equal(project1.address);
      expect(await pob.getRoleOf(0)).to.equal("Project");
    });
  });

  describe("post-voting security", function () {
    async function setupVotingScenario() {
      // Setup: register projects, voters
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).setDevRelAccount(devRel.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);

      // Activate with current block timestamp
      const block = await ethers.provider.getBlock("latest");
      await jurySC.connect(owner).activate(block.timestamp + 1);

      // Cast votes
      await jurySC.connect(devRel).voteDevRel(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);

      // Mint community badge and vote
      await pob.connect(community1).mint({ value: DEPOSIT });
      await jurySC.connect(community1).voteCommunity(0, project1.address);
    }

    describe("after voting ends naturally", function () {
      beforeEach(async function () {
        await setupVotingScenario();
        // Fast forward 48 hours
        await ethers.provider.send("evm_increaseTime", [48 * 3600]);
        await ethers.provider.send("evm_mine");
      });

      it("prevents removing DAO_HIC voters", async function () {
        await expect(jurySC.connect(owner).removeDaoHicVoter(daoHic1.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents adding DAO_HIC voters", async function () {
        await expect(jurySC.connect(owner).addDaoHicVoter(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents changing DevRel account", async function () {
        await expect(jurySC.connect(owner).setDevRelAccount(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("allows locking contract for history after voting ends with winner", async function () {
        await expect(jurySC.connect(owner).lockContractForHistory())
          .to.emit(jurySC, "ContractLockedForHistory")
          .withArgs(project1.address);

        expect(await jurySC.locked()).to.be.true;
      });
    });

    describe("no consensus scenario", function () {
      beforeEach(async function () {
        // Setup projects and voters
        await jurySC.connect(owner).registerProject(project1.address);
        await jurySC.connect(owner).registerProject(project2.address);
        await jurySC.connect(owner).setDevRelAccount(devRel.address);
        await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
        await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);

        // Activate
        const block = await ethers.provider.getBlock("latest");
        await jurySC.connect(owner).activate(block.timestamp + 1);

        // Create complete tie: all entities abstain or tie internally
        // DevRel: doesn't vote (entity vote = 0)
        // DAO_HIC: splits 1-1 (entity vote = 0)
        // Community: splits 1-1 (entity vote = 0)

        await jurySC.connect(daoHic1).voteDaoHic(project1.address);
        await jurySC.connect(daoHic2).voteDaoHic(project2.address);

        await pob.connect(community1).mint({ value: DEPOSIT });
        await jurySC.connect(community1).voteCommunity(0, project1.address);

        await pob.connect(community2).mint({ value: DEPOSIT });
        await jurySC.connect(community2).voteCommunity(1, project2.address);

        // Fast forward 48 hours
        await ethers.provider.send("evm_increaseTime", [48 * 3600]);
        await ethers.provider.send("evm_mine");
      });

      it("allows locking even without consensus (tie scenario)", async function () {
        const [winningProject, hasWinner] = await jurySC.getWinner();

        // Verify no consensus
        expect(hasWinner).to.be.false;
        expect(winningProject).to.equal(ethers.ZeroAddress);

        // Should still be able to lock
        await expect(jurySC.connect(owner).lockContractForHistory())
          .to.emit(jurySC, "ContractLockedForHistory")
          .withArgs(ethers.ZeroAddress);

        expect(await jurySC.locked()).to.be.true;
      });

      it("still allows community claims after locking with no consensus", async function () {
        await jurySC.connect(owner).lockContractForHistory();

        const balanceBefore = await ethers.provider.getBalance(community1.address);
        await pob.connect(community1).claim(0);
        const balanceAfter = await ethers.provider.getBalance(community1.address);

        expect(balanceAfter).to.be.gt(balanceBefore);
        expect(await pob.claimed(0)).to.be.true;
      });
    });

    describe("after manual close", function () {
      beforeEach(async function () {
        await setupVotingScenario();
        // Owner manually closes voting
        await jurySC.connect(owner).closeManually();
      });

      it("prevents removing DAO_HIC voters after manual close", async function () {
        await expect(jurySC.connect(owner).removeDaoHicVoter(daoHic1.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents adding DAO_HIC voters after manual close", async function () {
        await expect(jurySC.connect(owner).addDaoHicVoter(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents changing DevRel account after manual close", async function () {
        await expect(jurySC.connect(owner).setDevRelAccount(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });
    });

    describe("after contract is locked for history", function () {
      beforeEach(async function () {
        await setupVotingScenario();
        // Fast forward and lock
        await ethers.provider.send("evm_increaseTime", [48 * 3600]);
        await ethers.provider.send("evm_mine");
        await jurySC.connect(owner).lockContractForHistory();
      });

      it("prevents community minting after voting ends", async function () {
        // Community can only mint during active voting
        await expect(pob.connect(community2).mint({ value: DEPOSIT }))
          .to.be.revertedWithCustomError(pob, "NotActive");
      });

      it("prevents voting after locked (NotActive checked first)", async function () {
        // Voting reverts with NotActive because isActive() is false after voting ends
        await expect(jurySC.connect(devRel).voteDevRel(project2.address))
          .to.be.revertedWithCustomError(jurySC, "NotActive");

        await expect(jurySC.connect(daoHic1).voteDaoHic(project2.address))
          .to.be.revertedWithCustomError(jurySC, "NotActive");
      });

      it("prevents contract upgrades", async function () {
        const JurySC_01V2 = await ethers.getContractFactory("JurySC_01");
        await expect(
          upgrades.upgradeProxy(await jurySC.getAddress(), JurySC_01V2)
        ).to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents ownership transfer", async function () {
        await expect(jurySC.connect(owner).transferOwnership(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents ownership renunciation", async function () {
        await expect(jurySC.connect(owner).renounceOwnership())
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("still allows community claims", async function () {
        // Community can still claim their deposits
        const balanceBefore = await ethers.provider.getBalance(community1.address);
        await pob.connect(community1).claim(0);
        const balanceAfter = await ethers.provider.getBalance(community1.address);

        // Should have received deposit back (minus gas)
        expect(balanceAfter).to.be.gt(balanceBefore);
        expect(await pob.claimed(0)).to.be.true;
      });
    });
  });
});
