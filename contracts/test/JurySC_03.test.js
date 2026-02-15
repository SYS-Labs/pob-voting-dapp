import { expect } from "chai";
import hre from "hardhat";

const { ethers, upgrades } = hre;

describe("JurySC_03 (SMT replaces DevRel)", function () {
  const DEPOSIT = ethers.parseEther("30");
  const ITERATION = 1;

  let pob;
  let jurySC;
  let owner;
  let smt1, smt2, smt3;
  let daoHic1, daoHic2, daoHic3;
  let project1, project2, project3;
  let community1, community2, community3, community4, community5;

  beforeEach(async function () {
    [
      owner,
      smt1, smt2, smt3,
      daoHic1, daoHic2, daoHic3,
      project1, project2, project3,
      community1, community2, community3, community4, community5,
    ] = await ethers.getSigners();

    const PoB_03 = await ethers.getContractFactory("PoB_03");
    pob = await PoB_03.deploy("Proof of Builders v3", "POB3", ITERATION, owner.address);
    await pob.waitForDeployment();

    const JurySC_03 = await ethers.getContractFactory("JurySC_03");
    jurySC = await upgrades.deployProxy(JurySC_03, [await pob.getAddress(), ITERATION, owner.address], {
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
    });

    it("reverts on unknown project", async function () {
      await expect(jurySC.connect(owner).removeProject(community1.address)).to.be.revertedWithCustomError(
        jurySC,
        "InvalidProject",
      );
    });

    it("disallows removal once projects locked", async function () {
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).activate();

      await expect(jurySC.connect(owner).removeProject(project1.address)).to.be.revertedWithCustomError(
        jurySC,
        "ProjectsLocked",
      );
    });
  });

  describe("SMT voter management", function () {
    it("adds and lists SMT voters", async function () {
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addSmtVoter(smt2.address);

      expect(await jurySC.isSmtVoter(smt1.address)).to.be.true;
      expect(await jurySC.isSmtVoter(smt2.address)).to.be.true;
      expect(await jurySC.isSmtVoter(community1.address)).to.be.false;

      const voters = await jurySC.getSmtVoters();
      expect(voters.length).to.equal(2);
      expect(voters).to.include(smt1.address);
      expect(voters).to.include(smt2.address);
    });

    it("removes SMT voter and cleans up votes", async function () {
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addSmtVoter(smt2.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).activate();

      // smt1 votes
      await jurySC.connect(smt1).voteSmt(project1.address);
      expect(await jurySC.smtHasVoted(smt1.address)).to.be.true;

      // Remove smt1 (voting hasn't ended, owner can still manage)
      // Need to check: votingEnded() is false during active voting
      // removeSmtVoter checks votingEnded(), which is false during active voting
      await jurySC.connect(owner).removeSmtVoter(smt1.address);

      expect(await jurySC.isSmtVoter(smt1.address)).to.be.false;
      expect(await jurySC.smtHasVoted(smt1.address)).to.be.false;
      expect(await jurySC.smtVoteOf(smt1.address)).to.equal(ethers.ZeroAddress);

      const voters = await jurySC.getSmtVoters();
      expect(voters.length).to.equal(1);
      expect(voters[0]).to.equal(smt2.address);
    });

    it("prevents adding SMT voter who is DAO_HIC", async function () {
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await expect(
        jurySC.connect(owner).addSmtVoter(daoHic1.address)
      ).to.be.revertedWithCustomError(jurySC, "SmtCannotBeDaoHic");
    });

    it("prevents adding SMT voter who is a project", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await expect(
        jurySC.connect(owner).addSmtVoter(project1.address)
      ).to.be.revertedWithCustomError(jurySC, "SmtCannotBeProject");
    });

    it("prevents adding DAO_HIC voter who is SMT", async function () {
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await expect(
        jurySC.connect(owner).addDaoHicVoter(smt1.address)
      ).to.be.revertedWithCustomError(jurySC, "DaoHicCannotBeSmt");
    });
  });

  describe("activation", function () {
    it("requires at least one project, SMT voter and DAO voter", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);

      await jurySC.connect(owner).activate();

      expect(await jurySC.projectsLocked()).to.equal(true);

      const startTime = await jurySC.startTime();
      const endTime = await jurySC.endTime();
      expect(startTime).to.be.gt(0);
      expect(endTime).to.equal(startTime + BigInt(48 * 3600));
    });

    it("reverts activation without SMT voters", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);

      await expect(jurySC.connect(owner).activate()).to.be.revertedWithCustomError(jurySC, "NotEnoughVoters");
    });

    it("reverts activation without DAO_HIC voters", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);

      await expect(jurySC.connect(owner).activate()).to.be.revertedWithCustomError(jurySC, "NotEnoughVoters");
    });

    it("reverts activation without projects", async function () {
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);

      await expect(jurySC.connect(owner).activate()).to.be.revertedWithCustomError(jurySC, "InvalidProject");
    });
  });

  describe("voting", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addSmtVoter(smt2.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);
      await jurySC.connect(owner).activate();

      await pob.connect(community1).mint({ value: DEPOSIT });
      await pob.connect(community2).mint({ value: DEPOSIT });
    });

    it("allows community voting via project address", async function () {
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      expect(await jurySC.communityVoteOf(0)).to.equal(project1.address);
      expect(await jurySC.communityHasVoted(0)).to.be.true;

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts[0]).to.equal(0n); // smtCount
      expect(counts[1]).to.equal(0n); // daoHicCount
      expect(counts[2]).to.equal(1n); // communityCount
    });

    it("allows SMT voting", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      expect(await jurySC.smtVoteOf(smt1.address)).to.equal(project1.address);
      expect(await jurySC.smtHasVoted(smt1.address)).to.be.true;

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts[0]).to.equal(1n); // smtCount
    });

    it("allows each SMT voter to cast a vote independently", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project2.address);

      expect(await jurySC.smtVoteOf(smt1.address)).to.equal(project1.address);
      expect(await jurySC.smtVoteOf(smt2.address)).to.equal(project2.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts[0]).to.equal(2n); // smtCount
    });

    it("allows DAO_HIC voting", async function () {
      await jurySC.connect(daoHic1).voteDaoHic(project2.address);
      expect(await jurySC.daoHicVoteOf(daoHic1.address)).to.equal(project2.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts[1]).to.equal(1n); // daoHicCount
    });

    it("prevents non-SMT voter from voting as SMT", async function () {
      await expect(
        jurySC.connect(community1).voteSmt(project1.address)
      ).to.be.revertedWithCustomError(jurySC, "NotSmtVoter");
    });

    it("prevents a registered project from being added as SMT", async function () {
      await expect(
        jurySC.connect(owner).addSmtVoter(project1.address)
      ).to.be.revertedWithCustomError(jurySC, "SmtCannotBeProject");
    });

    it("prevents a registered project from voting as Community", async function () {
      const tx = await pob.connect(project1).mint({ value: DEPOSIT });
      const receipt = await tx.wait();
      const tokenId = receipt.logs[0].args[2];

      await expect(
        jurySC.connect(project1).voteCommunity(tokenId, project1.address)
      ).to.be.revertedWithCustomError(jurySC, "ProjectCannotVote");
    });
  });

  describe("voting dynamics", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addSmtVoter(smt2.address);
      await jurySC.connect(owner).addSmtVoter(smt3.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);
      await jurySC.connect(owner).activate();

      await pob.connect(community1).mint({ value: DEPOSIT });
      await pob.connect(community2).mint({ value: DEPOSIT });
    });

    it("SMT majority consensus: 2-of-3 for project1", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project1.address);
      await jurySC.connect(smt3).voteSmt(project2.address);

      expect(await jurySC.getSmtEntityVote()).to.equal(project1.address);
    });

    it("SMT tie returns zero address", async function () {
      // Only 2 SMT voters vote for different projects
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project2.address);

      // Tie: 1 vs 1 (smt3 hasn't voted, doesn't affect tally)
      expect(await jurySC.getSmtEntityVote()).to.equal(ethers.ZeroAddress);
    });

    it("recalculates SMT majority when voters change votes", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project1.address);
      expect(await jurySC.getSmtEntityVote()).to.equal(project1.address);

      // smt2 changes to project2
      await jurySC.connect(smt2).voteSmt(project2.address);
      // 1 vs 1, not a clear majority but smt1 has project1 and smt2 has project2
      // Since smt3 hasn't voted, it's still 1 vs 1 = tie
      expect(await jurySC.getSmtEntityVote()).to.equal(ethers.ZeroAddress);

      // smt1 changes to project2
      await jurySC.connect(smt1).voteSmt(project2.address);
      expect(await jurySC.getSmtEntityVote()).to.equal(project2.address);

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts[0]).to.equal(2n); // only 2 SMT voters have voted
    });

    it("ignores removed SMT voter from tallies", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project2.address);
      expect(await jurySC.getSmtEntityVote()).to.equal(ethers.ZeroAddress); // tie

      await jurySC.connect(owner).removeSmtVoter(smt2.address);
      expect(await jurySC.getSmtEntityVote()).to.equal(project1.address); // smt1's vote wins

      const counts = await jurySC.getVoteParticipationCounts();
      expect(counts[0]).to.equal(1n);
    });

    it("produces consistent winner after mixed vote changes", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address);
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(community2).voteCommunity(1, project2.address);

      let [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(project1.address); // SMT + Community = 2 entities

      // Change SMT votes to project2
      await jurySC.connect(smt1).voteSmt(project2.address);
      await jurySC.connect(smt2).voteSmt(project2.address);
      // Change DAO to project2
      await jurySC.connect(daoHic1).voteDaoHic(project2.address);

      [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(project2.address); // SMT + DAO = 2 entities
    });
  });

  describe("manual closure", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).activate();
    });

    it("allows owner to close manually", async function () {
      await jurySC.connect(owner).closeManually();

      expect(await jurySC.manuallyClosed()).to.be.true;
      expect(await jurySC.isActive()).to.be.false;
      expect(await jurySC.votingEnded()).to.be.true;
    });

    it("reverts if closeManually is called twice", async function () {
      await jurySC.connect(owner).closeManually();
      await expect(jurySC.connect(owner).closeManually()).to.be.revertedWithCustomError(jurySC, "AlreadyClosed");
    });
  });

  describe("entity aggregation", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addSmtVoter(smt2.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);
      await jurySC.connect(owner).activate();

      await pob.connect(community1).mint({ value: DEPOSIT });
      await pob.connect(community2).mint({ value: DEPOSIT });
    });

    it("computes winner when majority exists", async function () {
      // SMT -> project1
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project1.address);
      // DAO -> project1
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);
      // Community -> project1
      await jurySC.connect(community1).voteCommunity(0, project1.address);

      const [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.true;
      expect(winner).to.equal(project1.address);
    });

    it("returns no winner when entities split", async function () {
      // Each entity votes for a different project or ties
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project2.address); // SMT tie
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project2.address); // DAO tie
      await jurySC.connect(community1).voteCommunity(0, project1.address);
      await jurySC.connect(community2).voteCommunity(1, project2.address); // Community tie

      const [winner, hasWinner] = await jurySC.getWinner();
      expect(hasWinner).to.be.false;
      expect(winner).to.equal(ethers.ZeroAddress);
    });

    it("getEntityVoteCounts returns correct values", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project2.address);

      const entityVotes = await jurySC.getEntityVoteCounts();
      expect(entityVotes[0]).to.equal(project1.address); // SMT
      expect(entityVotes[1]).to.equal(project2.address); // DAO
      expect(entityVotes[2]).to.equal(ethers.ZeroAddress); // Community (no votes)
    });

    it("getProjectVoteBreakdown returns SMT, DAO, and Community counts", async function () {
      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(community1).voteCommunity(0, project1.address);

      const [smtVotes, daoVotes, communityVotes] = await jurySC.getProjectVoteBreakdown(project1.address);
      expect(smtVotes).to.equal(2n);
      expect(daoVotes).to.equal(1n);
      expect(communityVotes).to.equal(1n);
    });
  });

  describe("PoB_03 role minting", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).registerProject(project1.address);
    });

    it("allows SMT voter to mint badge after voting ends", async function () {
      await jurySC.connect(owner).activate();
      await jurySC.connect(owner).closeManually();

      await expect(pob.connect(smt1).mintSmt()).to.emit(pob, "Transfer").withArgs(
        ethers.ZeroAddress,
        smt1.address,
        0n,
      );
      expect(await pob.ownerOf(0)).to.equal(smt1.address);
      expect(await pob.getRoleOf(0)).to.equal("SMT");
    });

    it("rejects SMT mint from non-authorized account", async function () {
      await jurySC.connect(owner).activate();
      await jurySC.connect(owner).closeManually();

      await expect(pob.connect(community1).mintSmt()).to.be.revertedWithCustomError(pob, "NotAuthorized");
    });

    it("rejects SMT mint before voting ends", async function () {
      await jurySC.connect(owner).activate();

      await expect(pob.connect(smt1).mintSmt()).to.be.revertedWithCustomError(pob, "VotingNotEnded");
    });

    it("allows DAO_HIC voter to mint badge", async function () {
      await jurySC.connect(owner).activate();
      await jurySC.connect(owner).closeManually();

      await expect(pob.connect(daoHic1).mintDaoHic()).to.emit(pob, "Transfer").withArgs(
        ethers.ZeroAddress,
        daoHic1.address,
        0n,
      );
      expect(await pob.ownerOf(0)).to.equal(daoHic1.address);
      expect(await pob.getRoleOf(0)).to.equal("DAO-HIC");
    });

    it("allows project to mint badge after activation", async function () {
      await jurySC.connect(owner).activate();

      await expect(pob.connect(project1).mintProject()).to.emit(pob, "Transfer").withArgs(
        ethers.ZeroAddress,
        project1.address,
        0n,
      );
      expect(await pob.getRoleOf(0)).to.equal("Project");
    });

    it("prevents SMT voters from minting Community badge", async function () {
      await jurySC.connect(owner).activate();

      await expect(
        pob.connect(smt1).mint({ value: DEPOSIT })
      ).to.be.revertedWithCustomError(pob, "CannotMintAsSmt");
    });

    it("prevents DAO_HIC voters from minting Community badge", async function () {
      await jurySC.connect(owner).activate();

      await expect(
        pob.connect(daoHic1).mint({ value: DEPOSIT })
      ).to.be.revertedWithCustomError(pob, "CannotMintAsDaoHic");
    });
  });

  describe("dual voting modes (CONSENSUS vs WEIGHTED)", function () {
    it("defaults to CONSENSUS mode", async function () {
      expect(await jurySC.votingMode()).to.equal(0);
    });

    it("allows owner to change mode before activation", async function () {
      await jurySC.connect(owner).setVotingMode(1); // WEIGHTED
      expect(await jurySC.votingMode()).to.equal(1);

      await jurySC.connect(owner).setVotingMode(0); // back to CONSENSUS
      expect(await jurySC.votingMode()).to.equal(0);
    });

    it("prevents changing mode after activation", async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).activate();

      await expect(
        jurySC.connect(owner).setVotingMode(1)
      ).to.be.revertedWithCustomError(jurySC, "AlreadyActivated");
    });

    describe("WEIGHTED mode with SMT proportional voting", function () {
      beforeEach(async function () {
        await jurySC.connect(owner).registerProject(project1.address);
        await jurySC.connect(owner).registerProject(project2.address);
        await jurySC.connect(owner).registerProject(project3.address);
        await jurySC.connect(owner).addSmtVoter(smt1.address);
        await jurySC.connect(owner).addSmtVoter(smt2.address);
        await jurySC.connect(owner).addSmtVoter(smt3.address);
        await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
        await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);
        await jurySC.connect(owner).addDaoHicVoter(daoHic3.address);
        await jurySC.connect(owner).activate();
      });

      it("CONSENSUS mode: SMT majority counts as one entity vote", async function () {
        // SMT: 2 for project1, 1 for project2 → entity vote = project1
        await jurySC.connect(smt1).voteSmt(project1.address);
        await jurySC.connect(smt2).voteSmt(project1.address);
        await jurySC.connect(smt3).voteSmt(project2.address);

        // DAO: all for project3
        await jurySC.connect(daoHic1).voteDaoHic(project3.address);
        await jurySC.connect(daoHic2).voteDaoHic(project3.address);
        await jurySC.connect(daoHic3).voteDaoHic(project3.address);

        // Community: majority for project1
        await pob.connect(community1).mint({ value: DEPOSIT });
        await jurySC.connect(community1).voteCommunity(0, project1.address);
        await pob.connect(community2).mint({ value: DEPOSIT });
        await jurySC.connect(community2).voteCommunity(1, project1.address);

        const [winner, hasWinner] = await jurySC.getWinnerConsensus();
        expect(hasWinner).to.be.true;
        expect(winner).to.equal(project1.address); // SMT + Community = 2 entities
      });

      it("WEIGHTED mode: SMT weight is proportional", async function () {
        // SMT: 2/3 for project1, 1/3 for project2
        await jurySC.connect(smt1).voteSmt(project1.address);
        await jurySC.connect(smt2).voteSmt(project1.address);
        await jurySC.connect(smt3).voteSmt(project2.address);

        // DAO: all for project2
        await jurySC.connect(daoHic1).voteDaoHic(project2.address);
        await jurySC.connect(daoHic2).voteDaoHic(project2.address);
        await jurySC.connect(daoHic3).voteDaoHic(project2.address);

        // No community votes

        const [addresses, scores, totalPossible] = await jurySC.getWinnerWithScores();
        expect(totalPossible).to.equal(ethers.parseEther("1"));

        const p1Index = addresses.findIndex(addr => addr === project1.address);
        const p2Index = addresses.findIndex(addr => addr === project2.address);

        // Project 1: SMT 2/3 * 1/3 = 2/9
        // Project 2: SMT 1/3 * 1/3 + DAO 3/3 * 1/3 = 1/9 + 1/3 = 4/9
        // Project 2 should win
        expect(scores[p2Index]).to.be.gt(scores[p1Index]);

        const [winner, hasWinner] = await jurySC.getWinnerWeighted();
        expect(hasWinner).to.be.true;
        expect(winner).to.equal(project2.address);
      });
    });
  });

  describe("post-voting security", function () {
    async function setupVotingScenario() {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).registerProject(project2.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addSmtVoter(smt2.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic2.address);
      await jurySC.connect(owner).activate();

      await jurySC.connect(smt1).voteSmt(project1.address);
      await jurySC.connect(smt2).voteSmt(project1.address);
      await jurySC.connect(daoHic1).voteDaoHic(project1.address);
      await jurySC.connect(daoHic2).voteDaoHic(project1.address);

      await pob.connect(community1).mint({ value: DEPOSIT });
      await jurySC.connect(community1).voteCommunity(0, project1.address);
    }

    describe("after voting ends naturally", function () {
      beforeEach(async function () {
        await setupVotingScenario();
        await ethers.provider.send("evm_increaseTime", [48 * 3600]);
        await ethers.provider.send("evm_mine");
      });

      it("prevents removing SMT voters", async function () {
        await expect(jurySC.connect(owner).removeSmtVoter(smt1.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents adding SMT voters", async function () {
        await expect(jurySC.connect(owner).addSmtVoter(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents removing DAO_HIC voters", async function () {
        await expect(jurySC.connect(owner).removeDaoHicVoter(daoHic1.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("prevents adding DAO_HIC voters", async function () {
        await expect(jurySC.connect(owner).addDaoHicVoter(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("allows locking contract for history", async function () {
        await expect(jurySC.connect(owner).lockContractForHistory())
          .to.emit(jurySC, "ContractLockedForHistory")
          .withArgs(project1.address);

        expect(await jurySC.locked()).to.be.true;
      });
    });

    describe("after contract is locked for history", function () {
      beforeEach(async function () {
        await setupVotingScenario();
        await ethers.provider.send("evm_increaseTime", [48 * 3600]);
        await ethers.provider.send("evm_mine");
        await jurySC.connect(owner).lockContractForHistory();
      });

      it("prevents community minting after voting ends", async function () {
        await expect(pob.connect(community2).mint({ value: DEPOSIT }))
          .to.be.revertedWithCustomError(pob, "NotActive");
      });

      it("prevents voting after locked", async function () {
        await expect(jurySC.connect(smt1).voteSmt(project2.address))
          .to.be.revertedWithCustomError(jurySC, "NotActive");
        await expect(jurySC.connect(daoHic1).voteDaoHic(project2.address))
          .to.be.revertedWithCustomError(jurySC, "NotActive");
      });

      it("prevents ownership transfer", async function () {
        await expect(jurySC.connect(owner).transferOwnership(community2.address))
          .to.be.revertedWithCustomError(jurySC, "ContractLocked");
      });

      it("still allows community claims", async function () {
        const balanceBefore = await ethers.provider.getBalance(community1.address);
        await pob.connect(community1).claim(0);
        const balanceAfter = await ethers.provider.getBalance(community1.address);
        expect(balanceAfter).to.be.gt(balanceBefore);
        expect(await pob.claimed(0)).to.be.true;
      });
    });
  });

  describe("NFT transfer restrictions", function () {
    beforeEach(async function () {
      await jurySC.connect(owner).registerProject(project1.address);
      await jurySC.connect(owner).addSmtVoter(smt1.address);
      await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
      await jurySC.connect(owner).activate();
    });

    it("blocks NFT transfers during active voting", async function () {
      await pob.connect(community1).mint({ value: DEPOSIT });

      await expect(
        pob.connect(community1).transferFrom(community1.address, community2.address, 0)
      ).to.be.revertedWithCustomError(pob, "TransferDuringVotingNotAllowed");
    });

    it("allows NFT transfers after voting ends", async function () {
      await pob.connect(community1).mint({ value: DEPOSIT });
      await jurySC.connect(owner).closeManually();

      await expect(pob.connect(community1).transferFrom(community1.address, community2.address, 0)).to.not.be.reverted;
      expect(await pob.ownerOf(0)).to.equal(community2.address);
    });
  });
});
