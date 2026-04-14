/**
 * Granular v4 deployment workflow for migration work.
 *
 * Run one explicit deployment or wiring action per invocation and record the
 * result in the markdown deployment ledger.
 *
 * Usage examples:
 *   DEPLOY_ACTION=deploy-renderer \
 *   TRACE_ID=mainnet-i2-r2 \
 *   npx hardhat run scripts/deploy-v4-granular.js --network mainnet
 *
 *   DEPLOY_ACTION=deploy-pob-proxy \
 *   TRACE_ID=mainnet-i2-r2 \
 *   POB_IMPL=0x... \
 *   RENDERER_ADDRESS=0x... \
 *   POB_ITERATION=2 \
 *   POB_NAME="Proof of Builders #2" \
 *   POB_SYMBOL="POB2" \
 *   POB_DONATION_RECIPIENT=0x... \
 *   npx hardhat run scripts/deploy-v4-granular.js --network mainnet
 *
 *   DEPLOY_ACTION=deploy-jury-proxy \
 *   TRACE_ID=mainnet-i2-r2 \
 *   JURY_IMPL=0x... \
 *   POB_ADDRESS=0x... \
 *   POB_ITERATION=2 \
 *   JURY_OWNER=0x... \
 *   TX_NONCE=123 \
 *   npx hardhat run scripts/deploy-v4-granular.js --network mainnet
 */

import pkg from "hardhat";
const { ethers, network } = pkg;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const erc1967 = require(
  "@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json"
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATUS_FILE = path.resolve(__dirname, "../../deployment-partial-status.md");

const RECEIPT_POLL_MS = 10_000;
const RECEIPT_TIMEOUT_MS = 1_800_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function readOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function requireEnv(name) {
  const value = readOptionalEnv(name);
  if (!value) {
    throw new Error(`${name} is required for action ${getActionName()}`);
  }
  return value;
}

function readOptionalIntegerEnv(name) {
  const value = readOptionalEnv(name);
  if (value === null) return null;
  const parsed = Number(value);
  if (!isPositiveInteger(parsed)) {
    throw new Error(`${name} must be a positive integer (received: ${value})`);
  }
  return parsed;
}

function requireIntegerEnv(name) {
  const value = Number(requireEnv(name));
  if (!isPositiveInteger(value)) {
    throw new Error(`${name} must be a positive integer (received: ${process.env[name]})`);
  }
  return value;
}

function optionalAddress(name) {
  const value = readOptionalEnv(name);
  if (value !== null && !ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
  return value;
}

function requireAddress(name) {
  const value = requireEnv(name);
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
  return value;
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
  return readOptionalEnv("DEPLOY_ACTION") || readOptionalEnv("ACTION") || "help";
}

function inferTraceId() {
  const explicitTraceId = readOptionalEnv("TRACE_ID");
  if (explicitTraceId) return explicitTraceId;
  const chainPart = slugify(network.name || "unknown");
  const iteration = readOptionalEnv("POB_ITERATION") || "x";
  const roundId = readOptionalEnv("ROUND_ID") || "x";
  return `${chainPart}-i${iteration}-r${roundId}`;
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

async function resolveDeployer() {
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  if (isLocal) {
    const [deployer] = await ethers.getSigners();
    return deployer;
  }

  const privateKey = readOptionalEnv("OWNER_PRIVATE_KEY");
  if (!privateKey) {
    throw new Error("OWNER_PRIVATE_KEY must be provided in the environment for non-local networks");
  }
  return new ethers.Wallet(privateKey, ethers.provider);
}

async function sendTransaction(signer, txData) {
  const txRequest = { ...txData };
  const txNonce = readOptionalIntegerEnv("TX_NONCE");
  if (txNonce !== null) {
    txRequest.nonce = txNonce;
  }

  const explicitGasPrice = readOptionalEnv("TX_GAS_PRICE");
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  if (!isLocal) {
    const feeData = await ethers.provider.getFeeData();
    const resolvedGasPrice = explicitGasPrice ? BigInt(explicitGasPrice) : feeData.gasPrice ?? feeData.maxFeePerGas ?? null;
    if (resolvedGasPrice === null) {
      throw new Error("Unable to resolve gas price; provide TX_GAS_PRICE explicitly for this action");
    }
    txRequest.type = 0;
    txRequest.maxFeePerGas = null;
    txRequest.maxPriorityFeePerGas = null;
    txRequest.gasPrice = resolvedGasPrice;
  }

  const tx = await signer.sendTransaction(txRequest);
  return await waitForConfirmation(tx.hash);
}

async function deployContract(signer, factory, args = []) {
  const txData = await factory.getDeployTransaction(...args);
  return await sendTransaction(signer, txData);
}

async function deployUUPSProxy(signer, implFactory, implAddress, initArgs) {
  const proxyFactory = new ethers.ContractFactory(erc1967.abi, erc1967.bytecode, signer);
  const initData = implFactory.interface.encodeFunctionData("initialize", initArgs);
  const receipt = await deployContract(signer, proxyFactory, [implAddress, initData]);
  return {
    proxyAddress: receipt.contractAddress,
    receipt,
  };
}

function ensureStatusFile(filePath) {
  if (fs.existsSync(filePath)) return;
  const template = `# Deployment Status Ledger

This file tracks granular migration deployment actions.

Traceability rules:
- \`Trace ID\` groups related operations for one target deployment flow.
- \`Operation ID\` is unique per action execution.
- Each run of \`contracts/scripts/deploy-v4-granular.js\` appends one entry.

`;
  fs.writeFileSync(filePath, template);
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
    entry.iteration ? `- Iteration: \`${entry.iteration}\`` : null,
    entry.roundId ? `- Round: \`${entry.roundId}\`` : null,
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
  const filePath = path.resolve(process.cwd(), `deployment-action-${operationId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

const actions = {
  "deploy-registry-impl": {
    description: "Deploy the PoBRegistry implementation contract",
    inputShape: [],
    async run({ deployer }) {
      const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
      const receipt = await deployContract(deployer, PoBRegistry);
      return {
        contract: "PoBRegistry",
        deploymentKind: "implementation",
        address: receipt.contractAddress,
        txHash: txHashFromReceipt(receipt),
        blockNumber: receipt.blockNumber,
        reusableParams: `REGISTRY_IMPL=${receipt.contractAddress}`,
      };
    },
  },
  "deploy-registry-proxy": {
    description: "Deploy the PoBRegistry proxy pointing at an existing implementation",
    inputShape: ["REGISTRY_IMPL", "REGISTRY_OWNER(optional)"],
    async run({ deployer }) {
      const registryImpl = requireAddress("REGISTRY_IMPL");
      const registryOwner = optionalAddress("REGISTRY_OWNER") || deployer.address;
      const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
      const deployment = await deployUUPSProxy(deployer, PoBRegistry, registryImpl, [registryOwner]);
      return {
        contract: "PoBRegistry",
        deploymentKind: "proxy",
        address: deployment.proxyAddress,
        implementation: registryImpl,
        admin: registryOwner,
        txHash: txHashFromReceipt(deployment.receipt),
        blockNumber: deployment.receipt.blockNumber,
        reusableParams: `POB_REGISTRY=${deployment.proxyAddress}`,
      };
    },
  },
  "deploy-renderer": {
    description: "Deploy the PoBRenderer_01 contract",
    inputShape: [],
    async run({ deployer }) {
      const PoBRenderer_01 = await ethers.getContractFactory("PoBRenderer_01");
      const receipt = await deployContract(deployer, PoBRenderer_01);
      return {
        contract: "PoBRenderer_01",
        deploymentKind: "implementation",
        address: receipt.contractAddress,
        txHash: txHashFromReceipt(receipt),
        blockNumber: receipt.blockNumber,
        reusableParams: `RENDERER_ADDRESS=${receipt.contractAddress}`,
      };
    },
  },
  "deploy-pob-impl": {
    description: "Deploy the PoB_04 implementation contract",
    inputShape: [],
    async run({ deployer }) {
      const PoB_04 = await ethers.getContractFactory("PoB_04");
      const receipt = await deployContract(deployer, PoB_04);
      return {
        contract: "PoB_04",
        deploymentKind: "implementation",
        address: receipt.contractAddress,
        txHash: txHashFromReceipt(receipt),
        blockNumber: receipt.blockNumber,
        reusableParams: `POB_IMPL=${receipt.contractAddress}`,
      };
    },
  },
  "deploy-pob-proxy": {
    description: "Deploy the PoB_04 proxy using an existing implementation and renderer",
    inputShape: [
      "POB_IMPL",
      "RENDERER_ADDRESS",
      "POB_ITERATION",
      "POB_NAME",
      "POB_SYMBOL",
      "POB_DONATION_RECIPIENT",
      "POB_OWNER(optional)",
    ],
    async run({ deployer }) {
      const pobImpl = requireAddress("POB_IMPL");
      const rendererAddress = requireAddress("RENDERER_ADDRESS");
      const iteration = requireIntegerEnv("POB_ITERATION");
      const pobName = requireEnv("POB_NAME");
      const pobSymbol = requireEnv("POB_SYMBOL");
      const donationRecipient = requireAddress("POB_DONATION_RECIPIENT");
      const pobOwner = optionalAddress("POB_OWNER") || deployer.address;
      const PoB_04 = await ethers.getContractFactory("PoB_04");
      const deployment = await deployUUPSProxy(
        deployer,
        PoB_04,
        pobImpl,
        [pobName, pobSymbol, iteration, pobOwner, rendererAddress, donationRecipient]
      );
      return {
        contract: "PoB_04",
        deploymentKind: "proxy",
        address: deployment.proxyAddress,
        implementation: pobImpl,
        renderer: rendererAddress,
        admin: pobOwner,
        donationRecipient,
        txHash: txHashFromReceipt(deployment.receipt),
        blockNumber: deployment.receipt.blockNumber,
        reusableParams: `POB_ADDRESS=${deployment.proxyAddress}`,
      };
    },
  },
  "deploy-jury-impl": {
    description: "Deploy the JurySC_04 implementation contract",
    inputShape: [],
    async run({ deployer }) {
      const JurySC_04 = await ethers.getContractFactory("JurySC_04");
      const receipt = await deployContract(deployer, JurySC_04);
      return {
        contract: "JurySC_04",
        deploymentKind: "implementation",
        address: receipt.contractAddress,
        txHash: txHashFromReceipt(receipt),
        blockNumber: receipt.blockNumber,
        reusableParams: `JURY_IMPL=${receipt.contractAddress}`,
      };
    },
  },
  "deploy-jury-proxy": {
    description: "Deploy the JurySC_04 proxy using an existing implementation and PoB proxy",
    inputShape: ["JURY_IMPL", "POB_ADDRESS", "POB_ITERATION", "JURY_OWNER(optional)"],
    async run({ deployer }) {
      const juryImpl = requireAddress("JURY_IMPL");
      const pobAddress = requireAddress("POB_ADDRESS");
      const iteration = requireIntegerEnv("POB_ITERATION");
      const juryOwner = optionalAddress("JURY_OWNER") || deployer.address;
      const JurySC_04 = await ethers.getContractFactory("JurySC_04");
      const deployment = await deployUUPSProxy(deployer, JurySC_04, juryImpl, [pobAddress, iteration, juryOwner]);
      return {
        contract: "JurySC_04",
        deploymentKind: "proxy",
        address: deployment.proxyAddress,
        implementation: juryImpl,
        pobAddress,
        admin: juryOwner,
        txHash: txHashFromReceipt(deployment.receipt),
        blockNumber: deployment.receipt.blockNumber,
        reusableParams: [
          `JURY_ADDRESS=${deployment.proxyAddress}`,
          `JURY_DEPLOY_BLOCK_HINT=${deployment.receipt.blockNumber}`,
        ].join(" "),
      };
    },
  },
  "transfer-pob-ownership": {
    description: "Transfer PoB_04 proxy ownership to the target owner, typically the JurySC proxy",
    inputShape: ["POB_ADDRESS", "JURY_ADDRESS or NEW_OWNER_ADDRESS"],
    async run({ deployer }) {
      const pobAddress = requireAddress("POB_ADDRESS");
      const nextOwner = optionalAddress("NEW_OWNER_ADDRESS") || requireAddress("JURY_ADDRESS");
      const pob = await ethers.getContractAt("PoB_04", pobAddress, deployer);
      const currentOwner = await pob.owner();

      if (currentOwner.toLowerCase() === nextOwner.toLowerCase()) {
        return {
          contract: "PoB_04",
          deploymentKind: "ownership-transfer",
          address: pobAddress,
          previousOwner: currentOwner,
          newOwner: nextOwner,
          note: "Skipped transaction because ownership was already correct",
        };
      }

      const txData = await pob.transferOwnership.populateTransaction(nextOwner);
      const receipt = await sendTransaction(deployer, txData);
      return {
        contract: "PoB_04",
        deploymentKind: "ownership-transfer",
        address: pobAddress,
        previousOwner: currentOwner,
        newOwner: nextOwner,
        txHash: txHashFromReceipt(receipt),
        blockNumber: receipt.blockNumber,
      };
    },
  },
};

function printHelp() {
  console.log("Granular v4 deployment actions");
  console.log("");
  for (const [actionName, config] of Object.entries(actions)) {
    console.log(`- ${actionName}`);
    console.log(`  ${config.description}`);
    if (config.inputShape.length > 0) {
      console.log(`  Inputs: ${config.inputShape.join(", ")}`);
    }
  }
  console.log("");
  console.log("Common environment variables:");
  console.log("- DEPLOY_ACTION or ACTION");
  console.log("- TRACE_ID (optional group identifier, e.g. mainnet-i2-r2)");
  console.log("- ROUND_ID (optional but recommended for ledger context)");
  console.log("- STATUS_FILE (optional, defaults to /sandbox/deployment-partial-status.md)");
  console.log("- TX_NONCE (optional, recommended when sending parallel txs from the same deployer)");
  console.log("- TX_GAS_PRICE (optional raw wei value for type-0 deployment txs)");
}

async function main() {
  const actionName = getActionName();
  if (actionName === "help") {
    printHelp();
    return;
  }

  const action = actions[actionName];
  if (!action) {
    throw new Error(`Unsupported DEPLOY_ACTION: ${actionName}`);
  }

  const deployer = await resolveDeployer();
  const chainId = Number(network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);
  const traceId = inferTraceId();
  const operationId = buildOperationId(traceId, actionName);
  const statusFile = path.resolve(process.cwd(), readOptionalEnv("STATUS_FILE") || DEFAULT_STATUS_FILE);
  const startedAt = new Date().toISOString();

  const safeInputs = {
    traceId,
    deployer: deployer.address,
    network: network.name,
    chainId,
    iteration: readOptionalEnv("POB_ITERATION"),
    roundId: readOptionalEnv("ROUND_ID"),
    txNonce: readOptionalEnv("TX_NONCE"),
    txGasPrice: readOptionalEnv("TX_GAS_PRICE"),
    registryImpl: optionalAddress("REGISTRY_IMPL"),
    registryOwner: optionalAddress("REGISTRY_OWNER"),
    rendererAddress: optionalAddress("RENDERER_ADDRESS"),
    pobImpl: optionalAddress("POB_IMPL"),
    pobAddress: optionalAddress("POB_ADDRESS"),
    pobOwner: optionalAddress("POB_OWNER"),
    pobName: readOptionalEnv("POB_NAME"),
    pobSymbol: readOptionalEnv("POB_SYMBOL"),
    donationRecipient: optionalAddress("POB_DONATION_RECIPIENT"),
    juryImpl: optionalAddress("JURY_IMPL"),
    juryAddress: optionalAddress("JURY_ADDRESS"),
    juryOwner: optionalAddress("JURY_OWNER"),
    newOwnerAddress: optionalAddress("NEW_OWNER_ADDRESS"),
  };

  console.log("╔════════════════════════════════════════════╗");
  console.log("║     GRANULAR V4 DEPLOYMENT ACTION         ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  console.log("Operation ID:", operationId);
  console.log("Trace ID:    ", traceId);
  console.log("Network:     ", network.name);
  console.log("Chain ID:    ", chainId);
  console.log("Action:      ", actionName);
  console.log("Deployer:    ", deployer.address);
  console.log("");

  let artifactFile = null;
  try {
    const result = await action.run({ deployer, chainId, traceId, operationId });
    const artifactPayload = {
      operationId,
      traceId,
      timestamp: startedAt,
      network: network.name,
      chainId,
      action: actionName,
      inputs: safeInputs,
      result,
    };
    artifactFile = writeArtifact(operationId, artifactPayload);
    appendStatusEntry(statusFile, {
      operationId,
      traceId,
      timestamp: startedAt,
      network: network.name,
      chainId,
      iteration: readOptionalEnv("POB_ITERATION"),
      roundId: readOptionalEnv("ROUND_ID"),
      action: actionName,
      status: "SUCCESS",
      artifactFile: relativeFromRepoRoot(artifactFile),
      inputs: safeInputs,
      outcome: result,
    });

    console.log("Result:");
    for (const [key, value] of Object.entries(result)) {
      if (value !== null && value !== undefined && value !== "") {
        console.log(`  ${key}: ${value}`);
      }
    }
    console.log("");
    console.log("Artifact:", relativeFromRepoRoot(artifactFile));
    console.log("Status:  ", relativeFromRepoRoot(statusFile));
  } catch (error) {
    const failurePayload = {
      operationId,
      traceId,
      timestamp: startedAt,
      network: network.name,
      chainId,
      action: actionName,
      inputs: safeInputs,
      error: error?.message || String(error),
    };
    artifactFile = writeArtifact(operationId, failurePayload);
    appendStatusEntry(statusFile, {
      operationId,
      traceId,
      timestamp: startedAt,
      network: network.name,
      chainId,
      iteration: readOptionalEnv("POB_ITERATION"),
      roundId: readOptionalEnv("ROUND_ID"),
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
