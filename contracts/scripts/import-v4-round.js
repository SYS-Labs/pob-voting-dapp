/**
 * Import historical round data into deployed JurySC_04 / PoB_04 contracts.
 *
 * Usage:
 *   IMPORT_FILE=./migration-artifacts/example-round.json \
 *   npx hardhat run scripts/import-v4-round.js --network hardhat
 *
 * Expected JSON shape:
 * {
 *   "targetChainId": 31337,
 *   "registryAddress": "0x...",            // optional
 *   "iteration": 1,
 *   "roundId": 1,
 *   "juryAddress": "0x...",
 *   "registerImportedRound": true,          // optional
 *   "registerImportedIteration": true,      // optional
 *   "deployBlockHint": 123,
 *   "proofCid": "bafy...",
 *   "iterationMetadataCid": "bafy...",    // optional
 *   "projectMetadata": [{"project":"0x...","cid":"bafy..."}],
 *   "projects": ["0x..."],
 *   "smtVoters": ["0x..."],
 *   "daoHicVoters": ["0x..."],
 *   "smtVotes": [{"voter":"0x...","project":"0x..."}],
 *   "daoHicVotes": [{"voter":"0x...","project":"0x..."}],
 *   "communityVotes": [{"tokenId":0,"project":"0x..."}],
 *   "roundState": {
 *     "startTime": 1,
 *     "endTime": 2,
 *     "manuallyClosed": false,
 *     "manualEndTime": 0,
 *     "projectsLocked": true,
 *     "locked": false,
 *     "votingMode": 1
 *   },
 *   "badges": [{"tokenId":0,"owner":"0x...","role":"Community","claimed":false}],
 *   "sealRegistryRound": true               // optional, default true when registryAddress exists
 * }
 *
 * Supported migration normalization:
 * - legacy entity-0 / badge role label `DevRel` is translated to `SMT`
 */

import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeMigratedRole(role) {
  return role === "DevRel" ? "SMT" : role;
}

function writeReport(reportFile, report) {
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
}

async function main() {
  const importFile = process.env.IMPORT_FILE?.trim();
  if (!importFile) {
    throw new Error("IMPORT_FILE is required");
  }

  const raw = fs.readFileSync(importFile, "utf8");
  const payload = JSON.parse(raw);

  const network = hre.network.name;
  const isLocal = network === "localhost" || network === "hardhat";
  let signer;
  if (isLocal) {
    [signer] = await ethers.getSigners();
  } else {
    if (!process.env.OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set in environment");
    signer = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY.trim(), ethers.provider);
  }

  const currentChainId = Number((await ethers.provider.getNetwork()).chainId);
  if (payload.targetChainId && Number(payload.targetChainId) !== currentChainId) {
    throw new Error(`Chain mismatch: payload=${payload.targetChainId}, provider=${currentChainId}`);
  }

  const proofCid = payload.proofCid;
  if (!proofCid) {
    throw new Error("proofCid is required");
  }

  const jury = await ethers.getContractAt("JurySC_04", payload.juryAddress, signer);
  const juryIteration = Number(await jury.iteration());
  if (juryIteration !== Number(payload.iteration)) {
    throw new Error(`Iteration mismatch: contract=${juryIteration}, payload=${payload.iteration}`);
  }

  const registryAddress = payload.registryAddress || process.env.POB_REGISTRY?.trim() || null;
  const sealRegistryRound = payload.sealRegistryRound ?? Boolean(registryAddress);
  const reportFile = `import-v4-report-iteration-${payload.iteration}-round-${payload.roundId}-${Date.now()}.json`;
  const report = {
    importFile,
    network,
    chainId: currentChainId,
    traceId: payload.traceId || `iteration-${payload.iteration}-round-${payload.roundId}`,
    migrationBatchId: payload.migrationBatchId || null,
    proofCid,
    juryAddress: payload.juryAddress,
    registryAddress,
    iteration: payload.iteration,
    roundId: payload.roundId,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  writeReport(reportFile, report);

  const record = async (name, txPromiseFactory) => {
    console.log(`[${report.traceId}] sending ${name}`);
    const tx = await txPromiseFactory();
    console.log(`[${report.traceId}] ${name} tx: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      throw new Error(`${name} failed in tx ${receipt.hash}`);
    }
    report.steps.push({ name, txHash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status });
    writeReport(reportFile, report);
    console.log(`[${report.traceId}] confirmed ${name} at block ${receipt.blockNumber}`);
    return receipt;
  };

  if (!(await jury.migrationMode())) {
    await record("enableMigrationMode", () => jury.enableMigrationMode());
  }

  if (registryAddress) {
    const registry = await ethers.getContractAt("PoBRegistry", registryAddress, signer);
    const iterationInfo = await registry.iterations(payload.iteration);
    if (!iterationInfo.exists && payload.registerImportedIteration) {
      await record("registerImportedIteration", () => registry.registerImportedIteration(payload.iteration, currentChainId, proofCid));
    }

    const roundInfo = await registry.rounds(payload.iteration, payload.roundId);
    if (!roundInfo.exists && payload.registerImportedRound) {
      await record("registerImportedRound", () => registry.registerImportedRound(
        payload.iteration,
        payload.roundId,
        payload.juryAddress,
        Number(payload.deployBlockHint || 0),
        4,
        proofCid
      ));
    }

    if (payload.iterationMetadataCid) {
      await record("importIterationMetadata", () => registry.importIterationMetadata(currentChainId, payload.juryAddress, payload.iterationMetadataCid, proofCid));
    }
  }

  if (Array.isArray(payload.projects) && payload.projects.length > 0) {
    for (const batch of chunk(payload.projects, 100)) {
      await record("importProjectBatch", () => jury.importProjectBatch(batch, proofCid));
    }
  }

  if (registryAddress && Array.isArray(payload.projectMetadata) && payload.projectMetadata.length > 0) {
    const registry = await ethers.getContractAt("PoBRegistry", registryAddress, signer);
    for (const batch of chunk(payload.projectMetadata, 50)) {
      await record("importProjectMetadataBatch", () => registry.importProjectMetadataBatch(
        currentChainId,
        payload.juryAddress,
        batch.map((entry) => entry.project),
        batch.map((entry) => entry.cid),
        proofCid
      ));
    }
  }

  if (Array.isArray(payload.smtVoters) && payload.smtVoters.length > 0) {
    for (const batch of chunk(payload.smtVoters, 100)) {
      await record("importSmtVoters", () => jury.importEntityVoterBatch(0, batch, proofCid));
    }
  }

  if (Array.isArray(payload.daoHicVoters) && payload.daoHicVoters.length > 0) {
    for (const batch of chunk(payload.daoHicVoters, 100)) {
      await record("importDaoHicVoters", () => jury.importEntityVoterBatch(1, batch, proofCid));
    }
  }

  if (Array.isArray(payload.smtVotes) && payload.smtVotes.length > 0) {
    for (const batch of chunk(payload.smtVotes, 100)) {
      await record("importSmtVotes", () => jury.importEntityVoteBatch(
        0,
        batch.map((entry) => entry.voter),
        batch.map((entry) => entry.project),
        proofCid
      ));
    }
  }

  if (Array.isArray(payload.daoHicVotes) && payload.daoHicVotes.length > 0) {
    for (const batch of chunk(payload.daoHicVotes, 100)) {
      await record("importDaoHicVotes", () => jury.importEntityVoteBatch(
        1,
        batch.map((entry) => entry.voter),
        batch.map((entry) => entry.project),
        proofCid
      ));
    }
  }

  if (Array.isArray(payload.communityVotes) && payload.communityVotes.length > 0) {
    for (const batch of chunk(payload.communityVotes, 100)) {
      await record("importCommunityVotes", () => jury.importCommunityVoteBatch(
        batch.map((entry) => entry.tokenId),
        batch.map((entry) => entry.project),
        proofCid
      ));
    }
  }

  if (payload.roundState) {
    const state = payload.roundState;
    await record("importRoundState", () => jury.importRoundState(
      Number(state.startTime),
      Number(state.endTime),
      Boolean(state.manuallyClosed),
      Number(state.manualEndTime || 0),
      Boolean(state.projectsLocked),
      Boolean(state.locked),
      Number(state.votingMode),
      proofCid
    ));
  }

  if (Array.isArray(payload.badges) && payload.badges.length > 0) {
    for (const batch of chunk(payload.badges, 100)) {
      await record("importBadgeBatch", () => jury.importBadgeBatch(
        batch.map((entry) => entry.tokenId),
        batch.map((entry) => entry.owner),
        batch.map((entry) => normalizeMigratedRole(entry.role)),
        batch.map((entry) => Boolean(entry.claimed)),
        proofCid
      ));
    }
  }

  await record("sealImportedHistory", () => jury.sealImportedHistory(proofCid));

  if (registryAddress && sealRegistryRound) {
    const registry = await ethers.getContractAt("PoBRegistry", registryAddress, signer);
    await record("sealImportedRound", () => registry.sealImportedRound(payload.iteration, payload.roundId, proofCid));
  }

  report.completedAt = new Date().toISOString();
  writeReport(reportFile, report);
  console.log(`Saved import report to ${reportFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
