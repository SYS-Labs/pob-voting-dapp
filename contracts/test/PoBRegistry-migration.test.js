import { expect } from "chai";
import hre from "hardhat";

const { ethers, upgrades } = hre;

describe("PoBRegistry imported-history helpers", function () {
  const ITERATION = 1;
  const ROUND = 1;
  const CHAIN_ID = 31337;
  const PROOF_CID = "bafybeiaregistrymigrationproofcid0000000000000000000000001";
  const ITERATION_CID = "bafybeiaiterationmetadata0000000000000000000000000000001";
  const PROJECT_CID = "bafybeiaprojectmetadata00000000000000000000000000000001";

  let registry;
  let mockJurySC;
  let v4Adapter;
  let owner;
  let project1;
  let project2;

  beforeEach(async function () {
    [owner, project1, project2] = await ethers.getSigners();

    const MockJurySC = await ethers.getContractFactory("MockJurySC");
    mockJurySC = await MockJurySC.deploy();
    await mockJurySC.waitForDeployment();
    await mockJurySC.registerProject(project1.address);
    await mockJurySC.registerProject(project2.address);

    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    registry = await upgrades.deployProxy(PoBRegistry, [owner.address], {
      initializer: "initialize",
    });
    await registry.waitForDeployment();

    const V4Adapter = await ethers.getContractFactory("V4Adapter");
    v4Adapter = await V4Adapter.deploy();
    await v4Adapter.waitForDeployment();
    await registry.setAdapter(4, await v4Adapter.getAddress());
  });

  it("registers imported iteration and round with version 4", async function () {
    await expect(registry.registerImportedIteration(ITERATION, CHAIN_ID, PROOF_CID))
      .to.emit(registry, "ImportedIteration");

    await expect(
      registry.registerImportedRound(ITERATION, ROUND, await mockJurySC.getAddress(), 123, 4, PROOF_CID)
    ).to.emit(registry, "ImportedRound");

    expect(await registry.importedIterations(ITERATION)).to.be.true;
    expect(await registry.importedRounds(ITERATION, ROUND)).to.be.true;
    expect(await registry.roundVersion(ITERATION, ROUND)).to.equal(4);
  });

  it("imports metadata and blocks writes after the imported round is sealed", async function () {
    await registry.registerImportedIteration(ITERATION, CHAIN_ID, PROOF_CID);
    await registry.registerImportedRound(ITERATION, ROUND, await mockJurySC.getAddress(), 123, 4, PROOF_CID);

    await expect(
      registry.importIterationMetadata(CHAIN_ID, await mockJurySC.getAddress(), ITERATION_CID, PROOF_CID)
    ).to.emit(registry, "ImportedIterationMetadata");

    await expect(
      registry.importProjectMetadataBatch(
        CHAIN_ID,
        await mockJurySC.getAddress(),
        [project1.address, project2.address],
        [PROJECT_CID, `${PROJECT_CID}-b`],
        PROOF_CID
      )
    ).to.emit(registry, "ImportedProjectMetadata");

    expect(await registry.iterationMetadata(CHAIN_ID, await mockJurySC.getAddress())).to.equal(ITERATION_CID);
    expect(await registry.projectMetadata(CHAIN_ID, await mockJurySC.getAddress(), project1.address)).to.equal(PROJECT_CID);

    await registry.sealImportedRound(ITERATION, ROUND, PROOF_CID);

    await expect(
      registry.setIterationMetadata(CHAIN_ID, await mockJurySC.getAddress(), "bafynewiterationcid")
    ).to.be.revertedWithCustomError(registry, "ImportedRoundSealed");

    await expect(
      registry.setProjectMetadata(CHAIN_ID, await mockJurySC.getAddress(), project1.address, "bafynewprojectcid")
    ).to.be.revertedWithCustomError(registry, "ImportedRoundSealed");
  });
});
