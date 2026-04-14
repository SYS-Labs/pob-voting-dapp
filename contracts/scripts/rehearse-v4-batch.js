import fs from "fs";
import path from "path";
import hre from "hardhat";

const { ethers, upgrades } = hre;

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function roundKey(iterationId, roundId) {
  return `${iterationId}:${roundId}`;
}

function normalizeAddress(address) {
  return typeof address === "string" ? address.toLowerCase() : ethers.ZeroAddress.toLowerCase();
}

function toComparableAddress(address) {
  return address ? normalizeAddress(address) : ethers.ZeroAddress.toLowerCase();
}

function compareAddressArrays(actual, expected) {
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (normalizeAddress(actual[i]) !== normalizeAddress(expected[i])) return false;
  }
  return true;
}

function groupByRound(items) {
  const map = new Map();
  for (const item of items) {
    const key = roundKey(item.iterationId, item.roundId);
    const existing = map.get(key);
    if (existing) {
      existing.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function fail(errors, message) {
  errors.push(message);
}

async function deployRound(iterationId, roundId, owner) {
  const PoBRenderer_01 = await ethers.getContractFactory("PoBRenderer_01", owner);
  const renderer = await PoBRenderer_01.deploy();
  await renderer.waitForDeployment();

  const PoB_04 = await ethers.getContractFactory("PoB_04", owner);
  const pob = await upgrades.deployProxy(PoB_04, [
    `Migrated Proof of Builders ${iterationId}.${roundId}`,
    `MPOB${iterationId}${roundId}`,
    iterationId,
    owner.address,
    await renderer.getAddress(),
    owner.address
  ], {
    initializer: "initialize",
    kind: "uups",
  });
  await pob.waitForDeployment();

  const JurySC_04 = await ethers.getContractFactory("JurySC_04", owner);
  const jury = await upgrades.deployProxy(JurySC_04, [await pob.getAddress(), iterationId, owner.address], {
    initializer: "initialize",
    kind: "uups",
  });
  await jury.waitForDeployment();

  const transferTx = await pob.transferOwnership(await jury.getAddress());
  await transferTx.wait();

  const deploymentReceipt = await jury.deploymentTransaction()?.wait();
  return {
    pob,
    jury,
    deployBlockHint: deploymentReceipt?.blockNumber ?? await ethers.provider.getBlockNumber(),
  };
}

async function importRound({
  chainId,
  proofCid,
  registry,
  round,
  roundResult,
  iterationMetadata,
  projectMetadata,
  removedProjectMetadata,
  badgeGroup,
  owner,
  v4AdapterAddress,
}) {
  const { pob, jury, deployBlockHint } = await deployRound(round.iterationId, round.roundId, owner);
  const juryAddress = await jury.getAddress();
  const pobAddress = await pob.getAddress();

  const iterationInfo = await registry.iterations(round.iterationId);
  if (!iterationInfo.exists) {
    await (await registry.registerImportedIteration(round.iterationId, chainId, proofCid)).wait();
  }

  await (await registry.registerImportedRound(round.iterationId, round.roundId, juryAddress, deployBlockHint, 4, proofCid)).wait();
  await (await jury.enableMigrationMode()).wait();

  for (const batch of chunk(round.projects, 100)) {
    await (await jury.importProjectBatch(batch, proofCid)).wait();
  }

  if (iterationMetadata?.currentCid) {
    await (await registry.importIterationMetadata(chainId, juryAddress, iterationMetadata.currentCid, proofCid)).wait();
  }

  for (const batch of chunk(projectMetadata, 50)) {
    await (await registry.importProjectMetadataBatch(
      chainId,
      juryAddress,
      batch.map((entry) => entry.projectAddress),
      batch.map((entry) => entry.currentCid),
      proofCid
    )).wait();
  }

  for (const batch of chunk(round.entity0Voters, 100)) {
    await (await jury.importEntityVoterBatch(0, batch, proofCid)).wait();
  }

  for (const batch of chunk(round.entity1Voters, 100)) {
    await (await jury.importEntityVoterBatch(1, batch, proofCid)).wait();
  }

  for (const batch of chunk(round.entity0Votes, 100)) {
    await (await jury.importEntityVoteBatch(
      0,
      batch.map((entry) => entry.voter),
      batch.map((entry) => entry.project),
      proofCid
    )).wait();
  }

  for (const batch of chunk(round.entity1Votes, 100)) {
    await (await jury.importEntityVoteBatch(
      1,
      batch.map((entry) => entry.voter),
      batch.map((entry) => entry.project),
      proofCid
    )).wait();
  }

  for (const batch of chunk(round.communityVotes, 100)) {
    await (await jury.importCommunityVoteBatch(
      batch.map((entry) => entry.tokenId),
      batch.map((entry) => entry.project),
      proofCid
    )).wait();
  }

  const state = round.roundState;
  await (await jury.importRoundState(
    Number(state.startTime),
    Number(state.endTime),
    Boolean(state.manuallyClosed),
    Number(state.manualEndTime || 0),
    Boolean(state.projectsLocked),
    Boolean(state.locked),
    Number(state.votingMode),
    proofCid
  )).wait();

  for (const batch of chunk(badgeGroup.badges, 100)) {
    await (await jury.importBadgeBatch(
      batch.map((entry) => entry.tokenId),
      batch.map((entry) => entry.owner),
      batch.map((entry) => entry.role),
      batch.map((entry) => Boolean(entry.claimed)),
      proofCid
    )).wait();
  }

  await (await jury.sealImportedHistory(proofCid)).wait();
  await (await registry.sealImportedRound(round.iterationId, round.roundId, proofCid)).wait();

  const errors = [];
  const roundInfo = await registry.rounds(round.iterationId, round.roundId);
  if (!roundInfo.exists) fail(errors, "round missing from registry");
  if (normalizeAddress(roundInfo.jurySC) !== normalizeAddress(juryAddress)) {
    fail(errors, `registry jury mismatch: expected ${juryAddress}, got ${roundInfo.jurySC}`);
  }
  if (Number(roundInfo.deployBlockHint) !== Number(deployBlockHint)) {
    fail(errors, `deploy block hint mismatch: expected ${deployBlockHint}, got ${roundInfo.deployBlockHint}`);
  }
  if (!(await registry.importedIterations(round.iterationId))) fail(errors, "iteration not marked imported");
  if (!(await registry.importedRounds(round.iterationId, round.roundId))) fail(errors, "round not marked imported");
  if (!(await registry.importedRoundSealed(round.iterationId, round.roundId))) fail(errors, "round not sealed in registry");

  const roundVersion = await registry.roundVersion(round.iterationId, round.roundId);
  if (Number(roundVersion) !== 4) fail(errors, `round version mismatch: expected 4, got ${roundVersion}`);

  const [resolvedJury, resolvedAdapter] = await registry.getAdapterConfig(round.iterationId, round.roundId);
  if (normalizeAddress(resolvedJury) !== normalizeAddress(juryAddress)) {
    fail(errors, `adapter config jury mismatch: expected ${juryAddress}, got ${resolvedJury}`);
  }
  if (normalizeAddress(resolvedAdapter) !== normalizeAddress(v4AdapterAddress)) {
    fail(errors, `adapter config mismatch: expected ${v4AdapterAddress}, got ${resolvedAdapter}`);
  }

  const importedIterationCid = await registry.iterationMetadata(chainId, juryAddress);
  const expectedIterationCid = iterationMetadata?.currentCid ?? "";
  if (importedIterationCid !== expectedIterationCid) {
    fail(errors, `iteration metadata mismatch: expected ${expectedIterationCid || "<empty>"}, got ${importedIterationCid || "<empty>"}`);
  }

  for (const entry of projectMetadata) {
    const cid = await registry.projectMetadata(chainId, juryAddress, entry.projectAddress);
    if (cid !== entry.currentCid) {
      fail(errors, `project metadata mismatch for ${entry.projectAddress}: expected ${entry.currentCid}, got ${cid}`);
    }
  }

  for (const entry of removedProjectMetadata) {
    const cid = await registry.projectMetadata(chainId, juryAddress, entry.projectAddress);
    if (cid !== "") {
      fail(errors, `removed project metadata should stay off-chain for ${entry.projectAddress}, got ${cid}`);
    }
  }

  const onchainProjects = await jury.getProjectAddresses();
  if (!compareAddressArrays(onchainProjects, round.projects)) {
    fail(errors, "project address list mismatch");
  }

  const smtVoters = await jury.getSmtVoters();
  if (!compareAddressArrays(smtVoters, round.entity0Voters)) {
    fail(errors, "SMT voter list mismatch");
  }

  const daoHicVoters = await jury.getDaoHicVoters();
  if (!compareAddressArrays(daoHicVoters, round.entity1Voters)) {
    fail(errors, "DAO-HIC voter list mismatch");
  }

  for (const voter of round.entity0Voters) {
    const expectedVote = round.entity0Votes.find((entry) => normalizeAddress(entry.voter) === normalizeAddress(voter))?.project ?? null;
    const actualVote = await jury.smtVoteOf(voter);
    if (toComparableAddress(actualVote) !== toComparableAddress(expectedVote)) {
      fail(errors, `SMT vote mismatch for ${voter}: expected ${expectedVote ?? ethers.ZeroAddress}, got ${actualVote}`);
    }
  }

  for (const voter of round.entity1Voters) {
    const expectedVote = round.entity1Votes.find((entry) => normalizeAddress(entry.voter) === normalizeAddress(voter))?.project ?? null;
    const actualVote = await jury.daoHicVoteOf(voter);
    if (toComparableAddress(actualVote) !== toComparableAddress(expectedVote)) {
      fail(errors, `DAO-HIC vote mismatch for ${voter}: expected ${expectedVote ?? ethers.ZeroAddress}, got ${actualVote}`);
    }
  }

  for (const vote of round.communityVotes) {
    const actualVote = await jury.communityVoteOf(vote.tokenId);
    if (normalizeAddress(actualVote) !== normalizeAddress(vote.project)) {
      fail(errors, `community vote mismatch for token ${vote.tokenId}: expected ${vote.project}, got ${actualVote}`);
    }
  }

  const [smtCount, daoHicCount, communityCount] = await jury.getVoteParticipationCounts();
  if (Number(smtCount) !== round.entity0Votes.length) {
    fail(errors, `SMT vote count mismatch: expected ${round.entity0Votes.length}, got ${smtCount}`);
  }
  if (Number(daoHicCount) !== round.entity1Votes.length) {
    fail(errors, `DAO-HIC vote count mismatch: expected ${round.entity1Votes.length}, got ${daoHicCount}`);
  }
  if (Number(communityCount) !== round.communityVotes.length) {
    fail(errors, `community vote count mismatch: expected ${round.communityVotes.length}, got ${communityCount}`);
  }

  const entityVotes = await jury.getEntityVoteCounts();
  const expectedEntityVotes = [
    roundResult.entityVotes.entity0,
    roundResult.entityVotes.entity1,
    roundResult.entityVotes.community,
  ];
  for (let i = 0; i < expectedEntityVotes.length; i++) {
    if (toComparableAddress(entityVotes[i]) !== toComparableAddress(expectedEntityVotes[i])) {
      fail(errors, `entity vote mismatch at index ${i}: expected ${expectedEntityVotes[i] ?? ethers.ZeroAddress}, got ${entityVotes[i]}`);
    }
  }

  const juryState = {
    startTime: Number(await jury.startTime()),
    endTime: Number(await jury.endTime()),
    manuallyClosed: await jury.manuallyClosed(),
    manualEndTime: Number(await jury.manualEndTime()),
    projectsLocked: await jury.projectsLocked(),
    locked: await jury.locked(),
    votingMode: Number(await jury.votingMode()),
    votingEnded: await jury.votingEnded(),
  };

  if (juryState.startTime !== Number(state.startTime)) fail(errors, `startTime mismatch: expected ${state.startTime}, got ${juryState.startTime}`);
  if (juryState.endTime !== Number(state.endTime)) fail(errors, `endTime mismatch: expected ${state.endTime}, got ${juryState.endTime}`);
  if (juryState.manuallyClosed !== Boolean(state.manuallyClosed)) fail(errors, `manuallyClosed mismatch: expected ${state.manuallyClosed}, got ${juryState.manuallyClosed}`);
  if (juryState.manualEndTime !== Number(state.manualEndTime || 0)) fail(errors, `manualEndTime mismatch: expected ${state.manualEndTime || 0}, got ${juryState.manualEndTime}`);
  if (juryState.projectsLocked !== Boolean(state.projectsLocked)) fail(errors, `projectsLocked mismatch: expected ${state.projectsLocked}, got ${juryState.projectsLocked}`);
  if (!juryState.locked) fail(errors, "locked should be true after sealing imported history");
  if (juryState.votingMode !== Number(state.votingMode)) fail(errors, `votingMode mismatch: expected ${state.votingMode}, got ${juryState.votingMode}`);
  if (juryState.votingEnded !== Boolean(state.votingEnded)) fail(errors, `votingEnded mismatch: expected ${state.votingEnded}, got ${juryState.votingEnded}`);

  const [winnerProject, hasWinner] = await jury.getWinner();
  if (Boolean(hasWinner) !== Boolean(roundResult.winner.hasWinner)) {
    fail(errors, `winner flag mismatch: expected ${roundResult.winner.hasWinner}, got ${hasWinner}`);
  }
  if (toComparableAddress(winnerProject) !== toComparableAddress(roundResult.winner.projectAddress)) {
    fail(errors, `winner address mismatch: expected ${roundResult.winner.projectAddress ?? ethers.ZeroAddress}, got ${winnerProject}`);
  }

  if (roundResult.projectScores) {
    const [scoreAddresses, scores, totalPossible] = await jury.getWinnerWithScores();
    if (!compareAddressArrays(scoreAddresses, roundResult.projectScores.addresses)) {
      fail(errors, "project score address order mismatch");
    }
    const actualScores = scores.map((score) => score.toString());
    const expectedScores = roundResult.projectScores.scores.map((score) => String(score));
    if (actualScores.length !== expectedScores.length || actualScores.some((score, index) => score !== expectedScores[index])) {
      fail(errors, `project scores mismatch: expected ${expectedScores.join(",")}, got ${actualScores.join(",")}`);
    }
    if (totalPossible.toString() !== String(roundResult.projectScores.totalPossible)) {
      fail(errors, `total possible score mismatch: expected ${roundResult.projectScores.totalPossible}, got ${totalPossible}`);
    }
  }

  if (normalizeAddress(await pob.owner()) !== normalizeAddress(juryAddress)) {
    fail(errors, `PoB owner mismatch: expected ${juryAddress}, got ${await pob.owner()}`);
  }
  if (!(await pob.importedHistorySealed())) fail(errors, "PoB imported history not sealed");
  if (!(await jury.importedHistorySealed())) fail(errors, "Jury imported history not sealed");

  const highestTokenId = badgeGroup.badges.reduce((max, badge) => Math.max(max, Number(badge.tokenId)), -1);
  const nextId = Number(await pob.nextId());
  if (highestTokenId >= 0 && nextId !== highestTokenId + 1) {
    fail(errors, `nextId mismatch: expected ${highestTokenId + 1}, got ${nextId}`);
  }

  for (const badge of badgeGroup.badges) {
    const tokenId = Number(badge.tokenId);
    const ownerAddress = await pob.ownerOf(tokenId);
    if (normalizeAddress(ownerAddress) !== normalizeAddress(badge.owner)) {
      fail(errors, `badge owner mismatch for token ${tokenId}: expected ${badge.owner}, got ${ownerAddress}`);
    }
    const role = await pob.roleOf(tokenId);
    if (role !== badge.role) {
      fail(errors, `badge role mismatch for token ${tokenId}: expected ${badge.role}, got ${role}`);
    }
    const claimed = await pob.claimed(tokenId);
    if (Boolean(claimed) !== Boolean(badge.claimed)) {
      fail(errors, `badge claimed mismatch for token ${tokenId}: expected ${badge.claimed}, got ${claimed}`);
    }
  }

  return {
    iterationId: round.iterationId,
    roundId: round.roundId,
    juryAddress,
    pobAddress,
    deployBlockHint,
    proofCid,
    sourceState: {
      locked: Boolean(state.locked),
    },
    importedState: {
      locked: juryState.locked,
    },
    counts: {
      projects: round.projects.length,
      projectMetadata: projectMetadata.length,
      removedProjectMetadata: removedProjectMetadata.length,
      badges: badgeGroup.badges.length,
      smtVoters: round.entity0Voters.length,
      daoHicVoters: round.entity1Voters.length,
      smtVotes: round.entity0Votes.length,
      daoHicVotes: round.entity1Votes.length,
      communityVotes: round.communityVotes.length,
    },
    validation: {
      ok: errors.length === 0,
      errors,
    },
  };
}

async function main() {
  const batchDir = process.env.BATCH_DIR?.trim();
  if (!batchDir) {
    throw new Error("BATCH_DIR is required");
  }

  const resolvedBatchDir = path.resolve(batchDir);
  const manifest = readJson(path.join(resolvedBatchDir, "manifest.json"));
  const rounds = readJson(path.join(resolvedBatchDir, "rounds.json"));
  const results = readJson(path.join(resolvedBatchDir, "results.json"));
  const iterationMetadataEntries = readJson(path.join(resolvedBatchDir, "iteration-metadata.json"));
  const projectMetadataEntries = readJson(path.join(resolvedBatchDir, "project-metadata.json"));
  const badgeGroups = readJson(path.join(resolvedBatchDir, "badges.json"));
  const removedProjectMetadataPath = path.join(resolvedBatchDir, "removed-project-metadata.json");
  const removedProjectMetadataEntries = fs.existsSync(removedProjectMetadataPath)
    ? readJson(removedProjectMetadataPath)
    : [];

  const proofCid = process.env.PROOF_CID?.trim();
  if (!proofCid) {
    throw new Error("PROOF_CID is required; publish the validated batch to IPFS first and use the proof manifest CID");
  }
  if (proofCid.length > 100) {
    throw new Error(`proofCid exceeds 100 characters: ${proofCid}`);
  }

  const [owner] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 31337 && chainId !== 57) {
    throw new Error(`Expected rehearsal chainId 31337 or 57, received ${chainId}`);
  }

  const PoBRegistry = await ethers.getContractFactory("PoBRegistry", owner);
  const registry = await upgrades.deployProxy(PoBRegistry, [owner.address], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();

  const V4Adapter = await ethers.getContractFactory("V4Adapter", owner);
  const v4Adapter = await V4Adapter.deploy();
  await v4Adapter.waitForDeployment();
  const v4AdapterAddress = await v4Adapter.getAddress();
  await (await registry.setAdapter(4, v4AdapterAddress)).wait();

  const resultByRound = new Map(results.map((entry) => [roundKey(entry.iterationId, entry.roundId), entry]));
  const iterationMetadataByRound = new Map(
    iterationMetadataEntries.map((entry) => [roundKey(entry.iterationId, entry.anchorRoundId), entry])
  );
  const projectMetadataByRound = groupByRound(projectMetadataEntries);
  const removedProjectMetadataByRound = groupByRound(removedProjectMetadataEntries);
  const badgesByRound = new Map(badgeGroups.map((entry) => [roundKey(entry.iterationId, entry.roundId), entry]));

  const sortedRounds = [...rounds].sort((a, b) => {
    if (a.iterationId !== b.iterationId) return a.iterationId - b.iterationId;
    return a.roundId - b.roundId;
  });

  const report = {
    batchId: manifest.batchId,
    batchDir: resolvedBatchDir,
    proofCid,
    chainId,
    networkName: hre.network.name,
    registryAddress: await registry.getAddress(),
    v4AdapterAddress,
    startedAt: new Date().toISOString(),
    rounds: [],
  };

  for (const round of sortedRounds) {
    const key = roundKey(round.iterationId, round.roundId);
    const roundResult = resultByRound.get(key);
    const badgeGroup = badgesByRound.get(key);
    if (!roundResult) throw new Error(`Missing result entry for ${key}`);
    if (!badgeGroup) throw new Error(`Missing badge entry for ${key}`);

    console.log(`Rehearsing iteration ${round.iterationId} round ${round.roundId}...`);
    const roundReport = await importRound({
      chainId,
      proofCid,
      registry,
      round,
      roundResult,
      iterationMetadata: iterationMetadataByRound.get(key) ?? null,
      projectMetadata: projectMetadataByRound.get(key) ?? [],
      removedProjectMetadata: removedProjectMetadataByRound.get(key) ?? [],
      badgeGroup,
      owner,
      v4AdapterAddress,
    });
    report.rounds.push(roundReport);
    if (!roundReport.validation.ok) {
      throw new Error(`Validation failed for iteration ${round.iterationId} round ${round.roundId}: ${roundReport.validation.errors.join(" | ")}`);
    }
  }

  report.completedAt = new Date().toISOString();
  report.ok = report.rounds.every((entry) => entry.validation.ok);

  const reportPath = path.join(process.cwd(), `rehearsal-v4-batch-${manifest.batchId}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`Rehearsal complete. Report written to ${reportPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
