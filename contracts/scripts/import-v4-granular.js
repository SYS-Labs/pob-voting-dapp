/**
 * Granular v4 historical import workflow.
 *
 * Runs one explicit import/registry/seal action per invocation and records the
 * result in the deployment status ledger.
 *
 * Usage:
 *   IMPORT_ACTION=seal-jury IMPORT_FILE=./migration-import-payloads/mainnet-i2-r1.json \
 *   npx hardhat run scripts/import-v4-granular.js --network mainnet
 */

import hre from "hardhat";
const { ethers, network } = hre;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATUS_FILE = path.resolve(__dirname, "../../deployment-partial-status.md");
const RECEIPT_POLL_MS = 10_000;
const RECEIPT_TIMEOUT_MS = 1_800_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function requireEnv(name) {
  const value = readOptionalEnv(name);
  if (!value) throw new Error(`${name} is required for action ${getActionName()}`);
  return value;
}

function readOptionalIntegerEnv(name) {
  const value = readOptionalEnv(name);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer (received: ${value})`);
  }
  return parsed;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function getActionName() {
  return readOptionalEnv("IMPORT_ACTION") || readOptionalEnv("ACTION") || "help";
}

function buildOperationId(traceId, action) {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-");
  return `${slugify(traceId)}-${slugify(action)}-${timestamp}-p${process.pid}`;
}

function relativeFromRepoRoot(filePath) {
  return path.relative(path.resolve(__dirname, "../.."), filePath) || path.basename(filePath);
}

function txHashFromReceipt(receipt) {
  return receipt?.hash || receipt?.transactionHash || null;
}

function isSubmitOnly() {
  return readOptionalEnv("TX_SUBMIT_ONLY") === "1" || readOptionalEnv("SUBMIT_ONLY") === "1";
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function normalizeMigratedRole(role) {
  return role === "DevRel" ? "SMT" : role;
}

function loadPayload() {
  const importFile = requireEnv("IMPORT_FILE");
  const payload = JSON.parse(fs.readFileSync(importFile, "utf8"));
  if (!payload.proofCid) throw new Error("payload.proofCid is required");
  if (!payload.juryAddress || !ethers.isAddress(payload.juryAddress)) throw new Error("payload.juryAddress is invalid");
  if (!payload.iteration || !payload.roundId) throw new Error("payload.iteration and payload.roundId are required");
  return { importFile, payload };
}

function inferTraceId(payload) {
  return readOptionalEnv("TRACE_ID") || payload.traceId || `${network.name}-i${payload.iteration}-r${payload.roundId}`;
}

function ensureStatusFile(filePath) {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, "# Deployment Status Ledger\n\nThis file tracks granular migration deployment and import actions.\n\n");
}

function formatKeyValueLines(record) {
  return Object.entries(record)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `- ${key}: \`${String(value)}\``)
    .join("\n");
}

function appendStatusEntry(filePath, entry) {
  ensureStatusFile(filePath);
  const sections = [
    `## ${entry.operationId}`,
    `- Trace ID: \`${entry.traceId}\``,
    `- Timestamp: \`${entry.timestamp}\``,
    `- Network: \`${entry.network}\``,
    `- Chain ID: \`${entry.chainId}\``,
    `- Action: \`${entry.action}\``,
    `- Iteration: \`${entry.iteration}\``,
    `- Round: \`${entry.roundId}\``,
    `- Status: \`${entry.status}\``,
    entry.artifactFile ? `- Artifact: \`${entry.artifactFile}\`` : null,
    "",
    "### Inputs",
    formatKeyValueLines(entry.inputs),
    "",
    "### Outcome",
    formatKeyValueLines(entry.outcome),
    "",
  ].filter(Boolean);
  fs.appendFileSync(filePath, `${sections.join("\n")}\n`);
}

function writeArtifact(operationId, payload) {
  const filePath = path.resolve(process.cwd(), `import-action-${operationId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

async function waitForConfirmation(txHash, pollMs = RECEIPT_POLL_MS, timeoutMs = RECEIPT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  polling ${txHash} every ${pollMs / 1000}s...`);
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (receipt !== null) {
      process.stdout.write(` confirmed (block ${receipt.blockNumber})\n`);
      if (receipt.status === 0) throw new Error(`Transaction reverted: ${txHash}`);
      return receipt;
    }
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  throw new Error(`Timed out (${timeoutMs / 1000}s) waiting for ${txHash}`);
}

async function resolveSigner() {
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  if (isLocal) {
    const [signer] = await ethers.getSigners();
    return signer;
  }
  const privateKey = readOptionalEnv("OWNER_PRIVATE_KEY");
  if (!privateKey) throw new Error("OWNER_PRIVATE_KEY must be provided in the environment for non-local networks");
  return new ethers.Wallet(privateKey, ethers.provider);
}

async function sendTransaction(signer, txData) {
  const txRequest = { ...txData };
  const txNonce = readOptionalIntegerEnv("TX_NONCE");
  if (txNonce !== null) txRequest.nonce = txNonce;

  const explicitGasPrice = readOptionalEnv("TX_GAS_PRICE");
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  if (!isLocal) {
    const feeData = await ethers.provider.getFeeData();
    const resolvedGasPrice = explicitGasPrice ? BigInt(explicitGasPrice) : feeData.gasPrice ?? feeData.maxFeePerGas ?? null;
    if (resolvedGasPrice === null) throw new Error("Unable to resolve gas price; provide TX_GAS_PRICE explicitly");
    txRequest.type = 0;
    txRequest.maxFeePerGas = null;
    txRequest.maxPriorityFeePerGas = null;
    txRequest.gasPrice = resolvedGasPrice;
  }

  const tx = await signer.sendTransaction(txRequest);
  console.log("  tx:", tx.hash);
  if (isSubmitOnly()) {
    console.log("  submit-only mode: not waiting for receipt");
    return { hash: tx.hash, transactionHash: tx.hash, blockNumber: null, pending: true, nonce: tx.nonce };
  }
  return await waitForConfirmation(tx.hash);
}

async function getContracts(payload, signer) {
  const jury = await ethers.getContractAt("JurySC_04", payload.juryAddress, signer);
  const registryAddress = payload.registryAddress || readOptionalEnv("POB_REGISTRY");
  const registry = registryAddress ? await ethers.getContractAt("PoBRegistry", registryAddress, signer) : null;
  return { jury, registry, registryAddress };
}

function selectBatch(items, size) {
  const batchIndex = readOptionalIntegerEnv("BATCH_INDEX") ?? 0;
  const batches = chunk(items || [], size);
  if (batches.length === 0) throw new Error("selected action has no items to import");
  if (batchIndex >= batches.length) throw new Error(`BATCH_INDEX ${batchIndex} out of range; batch count is ${batches.length}`);
  return { batch: batches[batchIndex], batchIndex, batchCount: batches.length };
}

function receiptOutcome(receipt, extra = {}) {
  return {
    ...extra,
    txHash: txHashFromReceipt(receipt),
    blockNumber: receipt.blockNumber ?? null,
    pending: Boolean(receipt.pending),
    nonce: receipt.nonce ?? null,
  };
}

const actions = {
  "enable-migration-mode": {
    description: "Enable JurySC_04 migration mode",
    async run({ signer, payload, jury }) {
      if (await jury.migrationMode()) return { skipped: true, reason: "migration mode already enabled" };
      const receipt = await sendTransaction(signer, await jury.enableMigrationMode.populateTransaction());
      return receiptOutcome(receipt, { contract: "JurySC_04" });
    },
  },
  "register-iteration": {
    description: "Register the imported iteration in PoBRegistry",
    async run({ signer, payload, registry, chainId }) {
      if (!registry) throw new Error("registryAddress is required");
      const info = await registry.iterations(payload.iteration);
      if (info.exists) return { skipped: true, reason: "iteration already exists" };
      const receipt = await sendTransaction(signer, await registry.registerImportedIteration.populateTransaction(payload.iteration, chainId, payload.proofCid));
      return receiptOutcome(receipt, { contract: "PoBRegistry" });
    },
  },
  "register-round": {
    description: "Register the imported round in PoBRegistry",
    async run({ signer, payload, registry }) {
      if (!registry) throw new Error("registryAddress is required");
      const info = await registry.rounds(payload.iteration, payload.roundId);
      if (info.exists) return { skipped: true, reason: "round already exists" };
      const receipt = await sendTransaction(signer, await registry.registerImportedRound.populateTransaction(
        payload.iteration,
        payload.roundId,
        payload.juryAddress,
        Number(payload.deployBlockHint || 0),
        4,
        payload.proofCid
      ));
      return receiptOutcome(receipt, { contract: "PoBRegistry" });
    },
  },
  "import-iteration-metadata": {
    description: "Import iteration metadata CID on the anchor round",
    async run({ signer, payload, registry, chainId }) {
      if (!registry) throw new Error("registryAddress is required");
      if (!payload.iterationMetadataCid) return { skipped: true, reason: "payload has no iterationMetadataCid" };
      const receipt = await sendTransaction(signer, await registry.importIterationMetadata.populateTransaction(chainId, payload.juryAddress, payload.iterationMetadataCid, payload.proofCid));
      return receiptOutcome(receipt, { contract: "PoBRegistry", cid: payload.iterationMetadataCid });
    },
  },
  "import-projects": {
    description: "Import one project-address batch into JurySC_04",
    async run({ signer, payload, jury }) {
      const selected = selectBatch(payload.projects, 100);
      const receipt = await sendTransaction(signer, await jury.importProjectBatch.populateTransaction(selected.batch, payload.proofCid));
      return receiptOutcome(receipt, { contract: "JurySC_04", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "import-project-metadata": {
    description: "Import one project metadata batch into PoBRegistry",
    async run({ signer, payload, registry, chainId }) {
      if (!registry) throw new Error("registryAddress is required");
      const selected = selectBatch(payload.projectMetadata, 50);
      const receipt = await sendTransaction(signer, await registry.importProjectMetadataBatch.populateTransaction(
        chainId,
        payload.juryAddress,
        selected.batch.map((entry) => entry.project),
        selected.batch.map((entry) => entry.cid),
        payload.proofCid
      ));
      return receiptOutcome(receipt, { contract: "PoBRegistry", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "import-smt-voters": {
    description: "Import entity-0 SMT voters",
    async run({ signer, payload, jury }) {
      const selected = selectBatch(payload.smtVoters, 100);
      const receipt = await sendTransaction(signer, await jury.importEntityVoterBatch.populateTransaction(0, selected.batch, payload.proofCid));
      return receiptOutcome(receipt, { contract: "JurySC_04", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "import-dao-hic-voters": {
    description: "Import entity-1 DAO-HIC voters",
    async run({ signer, payload, jury }) {
      const selected = selectBatch(payload.daoHicVoters, 100);
      const receipt = await sendTransaction(signer, await jury.importEntityVoterBatch.populateTransaction(1, selected.batch, payload.proofCid));
      return receiptOutcome(receipt, { contract: "JurySC_04", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "import-smt-votes": {
    description: "Import entity-0 SMT votes",
    async run({ signer, payload, jury }) {
      const selected = selectBatch(payload.smtVotes, 100);
      const receipt = await sendTransaction(signer, await jury.importEntityVoteBatch.populateTransaction(
        0,
        selected.batch.map((entry) => entry.voter),
        selected.batch.map((entry) => entry.project),
        payload.proofCid
      ));
      return receiptOutcome(receipt, { contract: "JurySC_04", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "import-dao-hic-votes": {
    description: "Import entity-1 DAO-HIC votes",
    async run({ signer, payload, jury }) {
      const selected = selectBatch(payload.daoHicVotes, 100);
      const receipt = await sendTransaction(signer, await jury.importEntityVoteBatch.populateTransaction(
        1,
        selected.batch.map((entry) => entry.voter),
        selected.batch.map((entry) => entry.project),
        payload.proofCid
      ));
      return receiptOutcome(receipt, { contract: "JurySC_04", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "import-community-votes": {
    description: "Import community token votes",
    async run({ signer, payload, jury }) {
      const selected = selectBatch(payload.communityVotes, 100);
      const receipt = await sendTransaction(signer, await jury.importCommunityVoteBatch.populateTransaction(
        selected.batch.map((entry) => entry.tokenId),
        selected.batch.map((entry) => entry.project),
        payload.proofCid
      ));
      return receiptOutcome(receipt, { contract: "JurySC_04", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "import-round-state": {
    description: "Import canonical historical round state",
    async run({ signer, payload, jury }) {
      if (await jury.importedRoundStateSet()) return { skipped: true, reason: "round state already imported" };
      const state = payload.roundState;
      if (!state) throw new Error("payload.roundState is required");
      const receipt = await sendTransaction(signer, await jury.importRoundState.populateTransaction(
        Number(state.startTime),
        Number(state.endTime),
        Boolean(state.manuallyClosed),
        Number(state.manualEndTime || 0),
        Boolean(state.projectsLocked),
        Boolean(state.locked),
        Number(state.votingMode),
        payload.proofCid
      ));
      return receiptOutcome(receipt, { contract: "JurySC_04", votingMode: state.votingMode });
    },
  },
  "import-badges": {
    description: "Import one badge batch into JurySC_04 / PoB_04",
    async run({ signer, payload, jury }) {
      const selected = selectBatch(payload.badges, 100);
      const receipt = await sendTransaction(signer, await jury.importBadgeBatch.populateTransaction(
        selected.batch.map((entry) => entry.tokenId),
        selected.batch.map((entry) => entry.owner),
        selected.batch.map((entry) => normalizeMigratedRole(entry.role)),
        selected.batch.map((entry) => Boolean(entry.claimed)),
        payload.proofCid
      ));
      return receiptOutcome(receipt, { contract: "JurySC_04", count: selected.batch.length, batchIndex: selected.batchIndex, batchCount: selected.batchCount });
    },
  },
  "seal-jury": {
    description: "Seal imported history on JurySC_04 and its PoB_04",
    async run({ signer, payload, jury }) {
      if (await jury.importedHistorySealed()) return { skipped: true, reason: "jury imported history already sealed" };
      const receipt = await sendTransaction(signer, await jury.sealImportedHistory.populateTransaction(payload.proofCid));
      return receiptOutcome(receipt, { contract: "JurySC_04" });
    },
  },
  "seal-registry-round": {
    description: "Seal imported round in PoBRegistry",
    async run({ signer, payload, registry }) {
      if (!registry) throw new Error("registryAddress is required");
      if (await registry.importedRoundSealed(payload.iteration, payload.roundId)) return { skipped: true, reason: "registry round already sealed" };
      const receipt = await sendTransaction(signer, await registry.sealImportedRound.populateTransaction(payload.iteration, payload.roundId, payload.proofCid));
      return receiptOutcome(receipt, { contract: "PoBRegistry" });
    },
  },
  "verify-round": {
    description: "Read current registry and jury import state without sending a transaction",
    async run({ payload, jury, registry }) {
      const roundInfo = registry ? await registry.rounds(payload.iteration, payload.roundId) : { exists: false };
      return {
        registryRoundExists: Boolean(roundInfo.exists),
        registryImported: registry ? await registry.importedRounds(payload.iteration, payload.roundId) : null,
        registrySealed: registry ? await registry.importedRoundSealed(payload.iteration, payload.roundId) : null,
        juryMigrationMode: await jury.migrationMode(),
        juryRoundStateSet: await jury.importedRoundStateSet(),
        jurySealed: await jury.importedHistorySealed(),
        juryImportBatchCount: (await jury.importBatchCount()).toString(),
        projectCount: (await jury.projectCount()).toString(),
      };
    },
  },
};

function printHelp() {
  console.log("Granular v4 import actions");
  for (const [name, config] of Object.entries(actions)) {
    console.log(`- ${name}: ${config.description}`);
  }
  console.log("\nCommon environment variables:");
  console.log("- IMPORT_ACTION or ACTION");
  console.log("- IMPORT_FILE");
  console.log("- TRACE_ID optional");
  console.log("- BATCH_INDEX optional for batch imports");
  console.log("- TX_NONCE optional");
  console.log("- TX_GAS_PRICE optional raw wei for type-0 txs");
}

async function main() {
  const actionName = getActionName();
  if (actionName === "help") {
    printHelp();
    return;
  }
  const action = actions[actionName];
  if (!action) throw new Error(`Unsupported IMPORT_ACTION: ${actionName}`);

  const { importFile, payload } = loadPayload();
  const signer = await resolveSigner();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (payload.targetChainId && Number(payload.targetChainId) !== chainId) {
    throw new Error(`Chain mismatch: payload=${payload.targetChainId}, provider=${chainId}`);
  }
  const traceId = inferTraceId(payload);
  const operationId = buildOperationId(traceId, actionName);
  const statusFile = path.resolve(process.cwd(), readOptionalEnv("STATUS_FILE") || DEFAULT_STATUS_FILE);
  const startedAt = new Date().toISOString();
  const { jury, registry, registryAddress } = await getContracts(payload, signer);

  const safeInputs = {
    importFile: relativeFromRepoRoot(path.resolve(importFile)),
    traceId,
    deployer: signer.address,
    network: network.name,
    chainId,
    iteration: payload.iteration,
    roundId: payload.roundId,
    juryAddress: payload.juryAddress,
    registryAddress,
    proofCid: payload.proofCid,
    action: actionName,
    batchIndex: readOptionalEnv("BATCH_INDEX"),
    txNonce: readOptionalEnv("TX_NONCE"),
    txGasPrice: readOptionalEnv("TX_GAS_PRICE"),
    submitOnly: isSubmitOnly() ? "1" : null,
  };

  console.log("Granular v4 import action");
  console.log("Operation ID:", operationId);
  console.log("Trace ID:    ", traceId);
  console.log("Network:     ", network.name);
  console.log("Chain ID:    ", chainId);
  console.log("Action:      ", actionName);
  console.log("Signer:      ", signer.address);

  let artifactFile = null;
  try {
    const result = await action.run({ signer, payload, jury, registry, chainId, traceId, operationId });
    const artifactPayload = { operationId, traceId, timestamp: startedAt, network: network.name, chainId, action: actionName, inputs: safeInputs, result };
    artifactFile = writeArtifact(operationId, artifactPayload);
    appendStatusEntry(statusFile, {
      operationId,
      traceId,
      timestamp: startedAt,
      network: network.name,
      chainId,
      iteration: payload.iteration,
      roundId: payload.roundId,
      action: actionName,
      status: "SUCCESS",
      artifactFile: relativeFromRepoRoot(artifactFile),
      inputs: safeInputs,
      outcome: result,
    });
    console.log("Result:", JSON.stringify(result, null, 2));
    console.log("Artifact:", relativeFromRepoRoot(artifactFile));
    console.log("Status:  ", relativeFromRepoRoot(statusFile));
  } catch (error) {
    const failurePayload = { operationId, traceId, timestamp: startedAt, network: network.name, chainId, action: actionName, inputs: safeInputs, error: error?.message || String(error) };
    artifactFile = writeArtifact(operationId, failurePayload);
    appendStatusEntry(statusFile, {
      operationId,
      traceId,
      timestamp: startedAt,
      network: network.name,
      chainId,
      iteration: payload.iteration,
      roundId: payload.roundId,
      action: actionName,
      status: "FAILED",
      artifactFile: relativeFromRepoRoot(artifactFile),
      inputs: safeInputs,
      outcome: { error: error?.message || String(error) },
    });
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
