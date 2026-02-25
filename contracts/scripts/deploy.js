/**
 * CLEAN FULL DEPLOYMENT - Registry + PoB + JurySC
 *
 * Deploys everything fresh for a new iteration.
 * Does NOT register in PoBRegistry (done separately).
 *
 * Usage:
 *   POB_ITERATION=3 POB_NAME="Proof of Builders #3" POB_SYMBOL="POB3" \
 *     npx hardhat run scripts/deploy.js --network testnet
 *
 * Skip already-deployed contracts:
 *   POB_ADDRESS=0x...   reuse existing PoB_03  (skips PoB deploy)
 *   JURY_ADDRESS=0x...  reuse existing JurySC_03 proxy (skips JurySC deploy)
 *
 * Optional read-only registry checks (no writes):
 *   POB_REGISTRY=0x...   registry proxy to inspect wiring status
 *   ROUND_ID=1          round number to prepare/check (default: 1)
 *   JURY_DEPLOY_BLOCK_HINT=123456 optional block hint when reusing an existing proxy
 */

import pkg from "hardhat";
const { ethers, network, upgrades } = pkg;
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const erc1967 = require(
  "@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json"
);

// ═══════════════════════════════════════════════════════════
// POLLING HELPERS
// ═══════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Poll for a transaction receipt using a computed txHash.
 * Needed because Syscoin NEVM testnet returns a truncated/malformed hash
 * from eth_sendRawTransaction, so we compute the real hash locally.
 */
async function pollForReceipt(txHash, pollMs = 5000, timeoutMs = 1_800_000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  polling ${txHash}...`);
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

/**
 * Send a transaction and return its receipt.
 *
 * On local Hardhat networks: use standard sendTransaction — no Syscoin NEVM quirks apply.
 * On testnet/mainnet: bypass hardhat-ethers' checkTx (Syscoin NEVM returns a truncated
 * txHash from eth_sendRawTransaction). Signs manually, computes real hash as keccak256(signedTx),
 * and polls for receipt. Also forces legacy type-0 txs since Syscoin NEVM silently drops
 * EIP-1559 type-2 txs.
 */
// Nonce tracked manually to avoid relying on the network's pending count,
// which Syscoin NEVM does not reflect reliably between sequential sends.
let _nonce = null;
let _gasPrice = null;

async function sendRaw(signer, txData) {
  if (network.name === "localhost" || network.name === "hardhat") {
    const tx = await signer.sendTransaction(txData);
    return await tx.wait();
  }

  if (_nonce === null) {
    _nonce = await ethers.provider.getTransactionCount(signer.address, "latest");
  }
  if (_gasPrice === null) {
    const feeData = await ethers.provider.getFeeData();
    _gasPrice = feeData.gasPrice;
  }
  // Force legacy (type 0) tx — Syscoin NEVM silently drops EIP-1559 type-2 txs.
  const populated = await signer.populateTransaction({
    ...txData,
    nonce: _nonce,
    type: 0,
    gasPrice: _gasPrice,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  });
  const signed = await signer.signTransaction(populated);
  const txHash = ethers.keccak256(signed);
  _nonce++;
  await ethers.provider.send("eth_sendRawTransaction", [signed]);
  return await pollForReceipt(txHash);
}

/**
 * Deploy a contract via sendRaw. Returns the receipt (contractAddress inside).
 */
async function deployContract(signer, factory, args = []) {
  const txData = await factory.getDeployTransaction(...args);
  return await sendRaw(signer, txData);
}

/**
 * Deploy a UUPS proxy pointing at implAddress, calling initialize(initArgs).
 * Returns the proxy address.
 */
async function deployUUPSProxy(signer, implFactory, implAddress, initArgs) {
  const proxyFactory = new ethers.ContractFactory(erc1967.abi, erc1967.bytecode, signer);
  const initData = implFactory.interface.encodeFunctionData("initialize", initArgs);
  const receipt = await deployContract(signer, proxyFactory, [implAddress, initData]);
  return {
    proxyAddress: receipt.contractAddress,
    receipt,
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const chainId = Number(network.config.chainId);

  // On local networks use the first Hardhat signer (pre-funded, no OWNER_PRIVATE_KEY needed).
  // On testnet/mainnet use an ethers.Wallet because HardhatEthersSigner does not implement
  // signTransaction, which is required by the Syscoin NEVM raw-tx workaround.
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  let deployer;
  if (isLocal) {
    [deployer] = await ethers.getSigners();
  } else {
    if (!process.env.OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set in .env");
    deployer = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY.trim(), ethers.provider);
  }

  const existingPobAddress = process.env.POB_ADDRESS?.trim();
  const existingJuryProxy  = process.env.JURY_ADDRESS?.trim();
  const existingJuryImpl   = process.env.JURY_IMPL?.trim();
  const configuredRegistryProxy = process.env.POB_REGISTRY?.trim();
  const roundId = Number(process.env.ROUND_ID || "1");
  const expectedRoundVersion = 3; // This script deploys/handles JurySC_03
  const reuseJuryDeployBlockHint = process.env.JURY_DEPLOY_BLOCK_HINT
    ? Number(process.env.JURY_DEPLOY_BLOCK_HINT)
    : null;

  if (!process.env.POB_ITERATION ||
      (!existingPobAddress && (!process.env.POB_NAME || !process.env.POB_SYMBOL))) {
    throw new Error(
      "Missing required env vars.\n" +
      "  Full:      POB_ITERATION=3 POB_NAME=\"...\" POB_SYMBOL=\"POB3\" npx hardhat run scripts/deploy.js --network testnet\n" +
      "  Skip PoB:  add POB_ADDRESS=0x...\n" +
      "  Skip Jury: add JURY_ADDRESS=0x..."
    );
  }

  if (!isPositiveInteger(roundId)) {
    throw new Error(`ROUND_ID must be a positive integer (received: ${process.env.ROUND_ID || "1"})`);
  }

  if (reuseJuryDeployBlockHint !== null && !isPositiveInteger(reuseJuryDeployBlockHint)) {
    throw new Error(`JURY_DEPLOY_BLOCK_HINT must be a positive integer if provided (received: ${process.env.JURY_DEPLOY_BLOCK_HINT})`);
  }

  for (const [label, address] of [
    ["POB_ADDRESS", existingPobAddress],
    ["JURY_ADDRESS", existingJuryProxy],
    ["JURY_IMPL", existingJuryImpl],
    ["POB_REGISTRY", configuredRegistryProxy],
  ]) {
    if (address && !ethers.isAddress(address)) {
      throw new Error(`${label} is not a valid address: ${address}`);
    }
  }

  const iteration  = Number(process.env.POB_ITERATION);
  const pobName    = process.env.POB_NAME;
  const pobSymbol  = process.env.POB_SYMBOL;
  const juryOwner  = process.env.JURY_OWNER || deployer.address;
  const deployRegistry = process.env.DEPLOY_REGISTRY === "true";

  console.log("╔════════════════════════════════════════════╗");
  console.log("║   CLEAN ITERATION DEPLOYMENT               ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  console.log("Network:    ", network.name);
  console.log("Chain ID:   ", chainId);
  console.log("Deployer:   ", deployer.address);
  console.log("Iteration:  ", iteration);
  if (!existingPobAddress) {
    console.log("NFT Name:   ", pobName);
    console.log("NFT Symbol: ", pobSymbol);
  }
  console.log("Admin:      ", juryOwner);
  console.log("Round ID:    ", roundId);
  console.log("");
  console.log("Plan:");
  console.log(deployRegistry
    ? "  1. PoBRegistry  → deploy (impl + proxy)"
    : "  1. PoBRegistry  → SKIP (set DEPLOY_REGISTRY=true to deploy)");
  console.log(existingPobAddress
    ? `  2. PoB_03       → REUSE ${existingPobAddress}`
    : "  2. PoB_03       → deploy");
  console.log(existingJuryProxy
    ? `  3. JurySC_03    → REUSE proxy ${existingJuryProxy}`
    : existingJuryImpl
      ? `  3. JurySC_03    → REUSE impl ${existingJuryImpl}, deploy proxy`
      : "  3. JurySC_03    → deploy (impl + proxy)");
  console.log("  4. PoB → JurySC  link (transferOwnership)");
  console.log(configuredRegistryProxy || deployRegistry
    ? "  5. Registry     → read-only wiring check + payload"
    : "  5. Registry     → SKIP (set POB_REGISTRY=0x... to inspect wiring)");
  console.log("");

  if (network.name !== "localhost" && network.name !== "hardhat") {
    console.log("Press Ctrl+C within 5 seconds to cancel...");
    await sleep(5000);
  }
  console.log("");

  let registryProxy, registryImpl, pobAddress, juryProxy, juryImpl;
  let juryProxyDeployBlockHint = reuseJuryDeployBlockHint;

  // ═══════════════════════════════════════════════════════════
  // STEP 1: PoBRegistry (optional)
  // ═══════════════════════════════════════════════════════════
  if (deployRegistry) {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│ STEP 1: Deploying PoBRegistry           │");
    console.log("└─────────────────────────────────────────┘");

    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");

    console.log("Deploying implementation...");
    const implReceipt = await deployContract(deployer, PoBRegistry);
    registryImpl = implReceipt.contractAddress;
    console.log("  impl:  ", registryImpl);

    console.log("Deploying proxy...");
    const registryProxyDeployment = await deployUUPSProxy(deployer, PoBRegistry, registryImpl, [deployer.address]);
    registryProxy = registryProxyDeployment.proxyAddress;
    console.log("  proxy: ", registryProxy);
    console.log("");
  } else {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│ STEP 1: PoBRegistry - SKIPPED           │");
    console.log("└─────────────────────────────────────────┘");
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 2: PoB_03
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 2: PoB_03                          │");
  console.log("└─────────────────────────────────────────┘");

  let pob;
  if (existingPobAddress) {
    pobAddress = existingPobAddress;
    pob = await ethers.getContractAt("PoB_03", pobAddress);
    const pobIteration = Number(await pob.iteration());
    console.log("Reusing existing PoB_03");
    console.log("  address:", pobAddress);
    console.log("  owner:  ", await pob.owner());
    console.log("  iter:   ", pobIteration.toString());
    if (pobIteration !== iteration) {
      throw new Error(`POB_ADDRESS iteration mismatch: contract reports ${pobIteration}, expected ${iteration}`);
    }
  } else {
    const PoB_03 = await ethers.getContractFactory("PoB_03");
    console.log("Deploying PoB_03...");
    const receipt = await deployContract(deployer, PoB_03, [pobName, pobSymbol, iteration, deployer.address]);
    pobAddress = receipt.contractAddress;
    pob = await ethers.getContractAt("PoB_03", pobAddress);
    console.log("✓ PoB_03 deployed");
    console.log("  address:", pobAddress);
    console.log("  owner:  ", await pob.owner());
    const pobIteration = Number(await pob.iteration());
    console.log("  iter:   ", pobIteration.toString());
    if (pobIteration !== iteration) {
      throw new Error(`Deployed PoB_03 iteration mismatch: contract reports ${pobIteration}, expected ${iteration}`);
    }
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 3: JurySC_03
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 3: JurySC_03                       │");
  console.log("└─────────────────────────────────────────┘");

  const JurySC_03 = await ethers.getContractFactory("JurySC_03");
  let jurySC;

  if (existingJuryProxy) {
    juryProxy = existingJuryProxy;
    jurySC = await ethers.getContractAt("JurySC_03", juryProxy);
    juryImpl = await upgrades.erc1967.getImplementationAddress(juryProxy);
    const juryPob = await jurySC.pob();
    const juryIteration = Number(await jurySC.iteration());
    console.log("Reusing existing JurySC_03");
    console.log("  proxy: ", juryProxy);
    console.log("  impl:  ", juryImpl);
    console.log("  pob(): ", juryPob);
    console.log("  iter:  ", juryIteration.toString());
    if (juryIteration !== iteration) {
      throw new Error(`JURY_ADDRESS iteration mismatch: contract reports ${juryIteration}, expected ${iteration}`);
    }
    if (juryPob.toLowerCase() !== pobAddress.toLowerCase()) {
      throw new Error(`JURY_ADDRESS pob() mismatch: contract reports ${juryPob}, expected ${pobAddress}`);
    }
  } else {
    if (existingJuryImpl) {
      juryImpl = existingJuryImpl;
      console.log("Reusing existing implementation");
      console.log("  impl:  ", juryImpl);
    } else {
      console.log("Deploying implementation...");
      const implReceipt = await deployContract(deployer, JurySC_03);
      juryImpl = implReceipt.contractAddress;
      console.log("✓ impl:  ", juryImpl);
    }

    console.log("Deploying proxy...");
    const juryProxyDeployment = await deployUUPSProxy(deployer, JurySC_03, juryImpl, [pobAddress, iteration, juryOwner]);
    juryProxy = juryProxyDeployment.proxyAddress;
    juryProxyDeployBlockHint = juryProxyDeployment.receipt?.blockNumber ?? null;
    jurySC = await ethers.getContractAt("JurySC_03", juryProxy);
    console.log("✓ proxy: ", juryProxy);
    const juryPob = await jurySC.pob();
    const juryIteration = Number(await jurySC.iteration());
    console.log("  pob(): ", juryPob);
    console.log("  iter:  ", juryIteration.toString());
    if (juryIteration !== iteration) {
      throw new Error(`Deployed JurySC_03 iteration mismatch: contract reports ${juryIteration}, expected ${iteration}`);
    }
    if (juryPob.toLowerCase() !== pobAddress.toLowerCase()) {
      throw new Error(`Deployed JurySC_03 pob() mismatch: contract reports ${juryPob}, expected ${pobAddress}`);
    }
    if (juryProxyDeployBlockHint !== null) {
      console.log("  deployBlockHint:", juryProxyDeployBlockHint);
    }
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 4: Link PoB → JurySC (transferOwnership)
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 4: Linking PoB → JurySC            │");
  console.log("└─────────────────────────────────────────┘");

  const currentOwner = await pob.owner();
  if (currentOwner.toLowerCase() === juryProxy.toLowerCase()) {
    console.log("Already linked (PoB owner is JurySC). Skipping.");
  } else {
    console.log("Transferring PoB ownership to JurySC proxy...");
    const txData = await pob.transferOwnership.populateTransaction(juryProxy);
    await sendRaw(deployer, txData);
    const newOwner = await pob.owner();
    if (newOwner.toLowerCase() !== juryProxy.toLowerCase()) {
      throw new Error(`FAILED! PoB owner is ${newOwner}, expected ${juryProxy}`);
    }
    console.log("✓ PoB_03 owner is now JurySC_03 proxy");
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 5: Registry wiring check (read-only)
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 5: Registry wiring check (RO)      │");
  console.log("└─────────────────────────────────────────┘");

  const registryForChecks = registryProxy || configuredRegistryProxy || null;
  let registryChecks = null;
  const wiringPayload = {
    chainId,
    iterationId: iteration,
    roundId,
    jurySC: juryProxy,
    pob: pobAddress,
    deployBlockHint: juryProxyDeployBlockHint ?? 0,
    expectedRoundVersion,
  };

  if (!registryForChecks) {
    console.log("No registry configured for checks (set POB_REGISTRY=0x... or DEPLOY_REGISTRY=true).");
  } else {
    console.log("Registry proxy:", registryForChecks);
    const registry = await ethers.getContractAt("PoBRegistry", registryForChecks);

    let iterationExists = false;
    let roundExists = false;
    let registeredRoundJury = null;
    let registeredRoundBlockHint = null;
    let roundVersion = 0;
    let adapterConfig = null;
    let adapterConfigError = null;

    try {
      const iterInfo = await registry.iterations(iteration);
      iterationExists = Boolean(iterInfo?.exists);
    } catch (error) {
      console.log("  iterations(iteration) check failed:", error.message || error);
    }

    try {
      const roundInfo = await registry.rounds(iteration, roundId);
      roundExists = Boolean(roundInfo?.exists);
      if (roundExists) {
        registeredRoundJury = roundInfo?.jurySC || null;
        registeredRoundBlockHint = Number(roundInfo?.deployBlockHint ?? 0);
      }
    } catch (error) {
      console.log("  rounds(iteration, roundId) check failed:", error.message || error);
    }

    try {
      roundVersion = Number(await registry.roundVersion(iteration, roundId));
    } catch (error) {
      console.log("  roundVersion(iteration, roundId) check failed:", error.message || error);
    }

    try {
      const [resolvedJury, adapterAddress] = await registry.getAdapterConfig(iteration, roundId);
      adapterConfig = { jurySC: resolvedJury, adapter: adapterAddress };
    } catch (error) {
      adapterConfigError = error?.message || String(error);
    }

    registryChecks = {
      registryProxy: registryForChecks,
      iterationExists,
      roundExists,
      registeredRoundJury,
      registeredRoundBlockHint,
      roundVersion,
      adapterConfig,
      adapterConfigError,
    };

    console.log("  iteration registered:", iterationExists ? "yes" : "no");
    console.log("  round registered:    ", roundExists ? "yes" : "no");
    if (roundExists && registeredRoundJury) {
      console.log("  round.jurySC:        ", registeredRoundJury);
      console.log("  round.deployBlockHint:", registeredRoundBlockHint);
      if (registeredRoundJury.toLowerCase() !== juryProxy.toLowerCase()) {
        console.log("  WARNING: registered round JurySC does not match current JurySC proxy");
      }
    }
    console.log("  roundVersion:        ", roundVersion);
    if (adapterConfig) {
      console.log("  adapter config:      ", `${adapterConfig.jurySC} -> ${adapterConfig.adapter}`);
    } else if (adapterConfigError) {
      console.log("  adapter config:      ", `NOT READY (${adapterConfigError})`);
    }
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════
  console.log("╔════════════════════════════════════════════╗");
  console.log("║          DEPLOYMENT COMPLETE ✓             ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  if (deployRegistry) {
    console.log("PoBRegistry impl: ", registryImpl);
    console.log("PoBRegistry proxy:", registryProxy);
  }
  console.log("PoB_03:           ", pobAddress);
  console.log("JurySC_03 impl:   ", juryImpl);
  console.log("JurySC_03 proxy:  ", juryProxy);
  console.log("Admin:            ", juryOwner);
  console.log("");

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId,
    iteration,
    timestamp: new Date().toISOString(),
    contracts: {
      PoB_03: pobAddress,
      JurySC_03: {
        proxy: juryProxy,
        implementation: juryImpl
      }
    },
    wiringPayload,
    registryChecks,
    owner: juryOwner,
    deployer: deployer.address
  };

  if (deployRegistry) {
    deploymentInfo.contracts.PoBRegistry = {
      proxy: registryProxy,
      implementation: registryImpl
    };
  }

  const filename = `deployment-iteration-${iteration}-${network.name}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("Saved to:", filename);
  console.log("");

  if (network.name === "localhost" || network.name === "hardhat") {
    const iterationsLocalPath = "../frontend/public/iterations.local.json";
    const iterationsLocal = [{
      iteration,
      name: `PoB Iteration #${iteration}`,
      jurySC: juryProxy,
      pob: pobAddress,
      chainId,
      deployBlockHint: juryProxyDeployBlockHint || 1,
      link: "https://example.com/iteration"
    }];
    fs.writeFileSync(iterationsLocalPath, JSON.stringify(iterationsLocal, null, 2));
    console.log("Updated:", iterationsLocalPath);
    console.log("");
  }

  if (deployRegistry) {
    console.log("UPDATE THESE FILES WITH NEW REGISTRY PROXY:");
    console.log("  proxy:", registryProxy);
    console.log("  - frontend/src/utils/registry.ts");
    console.log("  - api/src/constants/networks.ts");
    console.log("");
  }
  console.log("NEXT STEPS:");
  if (!registryChecks) {
    console.log("  1. Set POB_REGISTRY=0x... and rerun to inspect wiring status");
    console.log("  2. Register iteration/round in registry separately (manual / separate script)");
    console.log(`  3. setRoundVersion(${iteration}, ${roundId}, ${expectedRoundVersion}) after round registration`);
  } else {
    let nextStepNo = 1;
    if (!registryChecks.iterationExists) {
      console.log(`  ${nextStepNo++}. Register iteration ${iteration} in registry (manual / separate script)`);
    }
    if (!registryChecks.roundExists) {
      if (!wiringPayload.deployBlockHint) {
        console.log(`  ${nextStepNo++}. addRound(${iteration}, ${roundId}, "${juryProxy}", <deployBlockHint>)  # deploy block hint missing; set JURY_DEPLOY_BLOCK_HINT and rerun`);
      } else {
        console.log(`  ${nextStepNo++}. addRound(${iteration}, ${roundId}, "${juryProxy}", ${wiringPayload.deployBlockHint})`);
      }
    }
    if (registryChecks.roundVersion === 0) {
      console.log(`  ${nextStepNo++}. setRoundVersion(${iteration}, ${roundId}, ${expectedRoundVersion})`);
    }
    if (registryChecks.roundVersion > 0 && !registryChecks.adapterConfig) {
      console.log(`  ${nextStepNo++}. Verify adapter registration for version ${registryChecks.roundVersion} (setAdapter may be missing)`);
    }
    if (registryChecks.adapterConfig) {
      console.log(`  ${nextStepNo++}. Registry adapter wiring is ready (no further registry action required for this round)`);
    } else {
      console.log(`  ${nextStepNo++}. Verify getAdapterConfig(${iteration}, ${roundId}) resolves`);
    }
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("");
    console.error("╔════════════════════════════════════════════╗");
    console.error("║           DEPLOYMENT FAILED ✗              ║");
    console.error("╚════════════════════════════════════════════╝");
    console.error("");
    console.error(error);
    console.error("");
    process.exit(1);
  });
