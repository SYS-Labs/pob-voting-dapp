import { expect } from "chai";
import hre from "hardhat";

const { ethers, upgrades } = hre;

describe("JurySC_04", function () {
  const DEPOSIT = ethers.parseEther("30");
  const ITERATION = 7;
  const PROOF_CID = "bafybeigdyrzt4migrationproofcid0000000000000000000000001";

  let pob;
  let jurySC;
  let adapter;
  let owner;
  let smt1;
  let daoHic1;
  let daoHic2;
  let project1;
  let project2;
  let project3;
  let community1;
  let community2;

  beforeEach(async function () {
    [owner, smt1, daoHic1, daoHic2, project1, project2, project3, community1, community2] = await ethers.getSigners();

    const PoB_04 = await ethers.getContractFactory("PoB_04");
    pob = await PoB_04.deploy("Proof of Builders v4", "POB4", ITERATION, owner.address);
    await pob.waitForDeployment();

    const JurySC_04 = await ethers.getContractFactory("JurySC_04");
    jurySC = await upgrades.deployProxy(JurySC_04, [await pob.getAddress(), ITERATION, owner.address], {
      kind: "uups",
    });
    await jurySC.waitForDeployment();

    await pob.connect(owner).transferOwnership(await jurySC.getAddress());

    const V4Adapter = await ethers.getContractFactory("V4Adapter");
    adapter = await V4Adapter.deploy();
    await adapter.waitForDeployment();
  });

  it("keeps the normal fresh-round voting flow intact", async function () {
    await jurySC.connect(owner).registerProject(project1.address);
    await jurySC.connect(owner).registerProject(project2.address);
    await jurySC.connect(owner).addSmtVoter(smt1.address);
    await jurySC.connect(owner).addDaoHicVoter(daoHic1.address);
    await jurySC.connect(owner).activate();

    await pob.connect(community1).mint({ value: DEPOSIT });

    await jurySC.connect(smt1).voteSmt(project1.address);
    await jurySC.connect(daoHic1).voteDaoHic(project1.address);
    await jurySC.connect(community1).voteCommunity(0, project1.address);

    const [winner, hasWinner] = await jurySC.getWinnerConsensus();
    expect(hasWinner).to.be.true;
    expect(winner).to.equal(project1.address);
  });

  it("imports historical state, exposes it through the adapter, and seals it", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const endTime = latestBlock.timestamp - 60;
    const startTime = endTime - 48 * 60 * 60;

    await jurySC.connect(owner).enableMigrationMode();
    await jurySC.connect(owner).importProjectBatch([project1.address, project2.address], PROOF_CID);
    await jurySC.connect(owner).importEntityVoterBatch(0, [smt1.address], PROOF_CID);
    await jurySC.connect(owner).importEntityVoterBatch(1, [daoHic1.address, daoHic2.address], PROOF_CID);

    await jurySC.connect(owner).importEntityVoteBatch(0, [smt1.address], [project1.address], PROOF_CID);
    await jurySC.connect(owner).importEntityVoteBatch(0, [smt1.address], [project1.address], PROOF_CID);
    await jurySC.connect(owner).importEntityVoteBatch(1, [daoHic1.address, daoHic2.address], [project1.address, project2.address], PROOF_CID);
    await jurySC.connect(owner).importCommunityVoteBatch([10, 11], [project1.address, project1.address], PROOF_CID);
    await jurySC.connect(owner).importRoundState(startTime, endTime, false, 0, true, false, 1, PROOF_CID);
    await jurySC.connect(owner).importBadgeBatch(
      [10, 11, 12, 13],
      [community1.address, community2.address, smt1.address, daoHic1.address],
      ["Community", "Community", "SMT", "DAO-HIC"],
      [false, true, true, true],
      PROOF_CID
    );

    const counts = await jurySC.getVoteParticipationCounts();
    expect(counts[0]).to.equal(1n);
    expect(counts[1]).to.equal(2n);
    expect(counts[2]).to.equal(2n);
    expect(await jurySC.votingEnded()).to.be.true;
    expect(await jurySC.communityVoteOf(10)).to.equal(project1.address);
    expect(await jurySC.daoHicVoteOf(daoHic1.address)).to.equal(project1.address);
    expect(await jurySC.smtVoteOf(smt1.address)).to.equal(project1.address);

    const [winner, hasWinner] = await jurySC.getWinnerWeighted();
    expect(hasWinner).to.be.true;
    expect(winner).to.equal(project1.address);

    expect(await adapter.getEntityVoters(await jurySC.getAddress(), 0)).to.deep.equal([smt1.address]);
    expect(await adapter.getEntityVoters(await jurySC.getAddress(), 1)).to.deep.equal([daoHic1.address, daoHic2.address]);
    expect(await adapter.getRoleOf(await jurySC.getAddress(), 10)).to.equal("Community");
    expect(await adapter.getWinner(await jurySC.getAddress())).to.deep.equal([project1.address, true]);

    await jurySC.connect(owner).sealImportedHistory(PROOF_CID);

    await expect(
      jurySC.connect(owner).importProjectBatch([project3.address], PROOF_CID)
    ).to.be.revertedWithCustomError(jurySC, "ImportedHistoryAlreadySealed");

    await expect(
      pob.connect(community1).claim(10)
    ).to.be.revertedWithCustomError(pob, "ImportedBadgeClaimDisabled");

    await expect(
      pob.connect(project1).mintProject()
    ).to.be.revertedWithCustomError(pob, "MintingIsClosed");
  });
});
