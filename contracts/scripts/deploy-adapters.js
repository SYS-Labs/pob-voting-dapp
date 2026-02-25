/**
 * Deploy V1Adapter, V2Adapter, V3Adapter and optionally upgrade PoBRegistry.
 *
 * Uses the same raw-tx + custom polling approach as deploy.js to work around
 * the Syscoin NEVM testnet RPC bug (truncated txHash from eth_sendRawTransaction).
 *
 * Environment variables:
 *   POB_REGISTRY       - PoBRegistry proxy address (required for wiring and optional upgrade)
 *   UPGRADE_REGISTRY   - Set to "true" to upgrade the PoBRegistry proxy to current implementation
 *   DRY_RUN            - Set to "true" to deploy adapters only, skip setAdapter calls
 *   REGISTRY_IMPL      - Reuse existing PoBRegistry implementation (skips upgrade deploy)
 *   V1_ADDRESS         - Reuse existing V1Adapter (skips V1 deploy)
 *   V2_ADDRESS         - Reuse existing V2Adapter (skips V2 deploy)
 *   V3_ADDRESS         - Reuse existing V3Adapter (skips V3 deploy)
 *
 * Usage:
 *   POB_REGISTRY=0x... npx hardhat run scripts/deploy-adapters.js --network testnet
 *   POB_REGISTRY=0x... UPGRADE_REGISTRY=true npx hardhat run scripts/deploy-adapters.js --network testnet
 *   DRY_RUN=true npx hardhat run scripts/deploy-adapters.js --network testnet
 *   # Resume after partial failure:
 *   POB_REGISTRY=0x... REGISTRY_IMPL=0x... V1_ADDRESS=0x... npx hardhat run scripts/deploy-adapters.js --network testnet
 */

import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════
// POLLING HELPERS (same as deploy.js)
// ═══════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

// Nonce tracked manually to avoid relying on the network's pending count,
// which Syscoin NEVM does not reflect reliably between sequential sends.
let _nonce = null;
let _gasPrice = null;

async function sendRaw(signer, txData) {
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

async function deployContract(signer, factory, args = []) {
  const txData = await factory.getDeployTransaction(...args);
  return await sendRaw(signer, txData);
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  if (!process.env.OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set in .env");
  const signer = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY.trim(), ethers.provider);

  const network = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const registryAddress  = process.env.POB_REGISTRY?.trim();
  const upgradeRegistry  = process.env.UPGRADE_REGISTRY === "true";
  const dryRun           = process.env.DRY_RUN === "true";
  const existingRegImpl  = process.env.REGISTRY_IMPL?.trim();
  const existingV1       = process.env.V1_ADDRESS?.trim();
  const existingV2       = process.env.V2_ADDRESS?.trim();
  const existingV3       = process.env.V3_ADDRESS?.trim();

  console.log("╔════════════════════════════════════════════╗");
  console.log("║   ADAPTER DEPLOYMENT                       ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  console.log("Network:    ", network);
  console.log("Chain ID:   ", chainId.toString());
  console.log("Deployer:   ", signer.address);
  console.log("Registry:   ", registryAddress || "(not set — dry run only)");
  console.log("Plan:");
  console.log(!upgradeRegistry || !registryAddress
    ? "  0. PoBRegistry   → SKIP upgrade"
    : existingRegImpl
      ? `  0. PoBRegistry   → REUSE impl ${existingRegImpl}`
      : "  0. PoBRegistry   → upgrade implementation");
  console.log(existingV1 ? `  1. V1Adapter    → REUSE ${existingV1}` : "  1. V1Adapter    → deploy");
  console.log(existingV2 ? `  2. V2Adapter    → REUSE ${existingV2}` : "  2. V2Adapter    → deploy");
  console.log(existingV3 ? `  3. V3Adapter    → REUSE ${existingV3}` : "  3. V3Adapter    → deploy");
  console.log(dryRun
    ? "  4. setAdapter    → SKIP (DRY_RUN)  "
    : "  4. setAdapter(1/2/3) → wire to registry");
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 0: Upgrade PoBRegistry (optional)
  // ═══════════════════════════════════════════════════════════
  let registryImpl;
  if (upgradeRegistry && registryAddress) {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│ STEP 0: Upgrading PoBRegistry           │");
    console.log("└─────────────────────────────────────────┘");

    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    const proxy = await ethers.getContractAt("PoBRegistry", registryAddress);

    if (existingRegImpl) {
      registryImpl = existingRegImpl;
      console.log("Reusing existing implementation:", registryImpl);
      console.log("Calling upgradeToAndCall on proxy...");
      const upgradeTxData = await proxy.upgradeToAndCall.populateTransaction(registryImpl, "0x");
      await sendRaw(signer, upgradeTxData);
    } else {
      console.log("Deploying new implementation...");
      const implReceipt = await deployContract(signer, PoBRegistry);
      registryImpl = implReceipt.contractAddress;
      console.log("  impl:  ", registryImpl);

      console.log("Calling upgradeToAndCall on proxy...");
      const upgradeTxData = await proxy.upgradeToAndCall.populateTransaction(registryImpl, "0x");
      await sendRaw(signer, upgradeTxData);
    }

    const ver = await proxy.version();
    console.log(`✓ PoBRegistry upgraded — version: ${ver}`);
    console.log("");
  } else {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│ STEP 0: PoBRegistry upgrade - SKIPPED   │");
    console.log("└─────────────────────────────────────────┘");
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 1: V1Adapter
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 1: V1Adapter                       │");
  console.log("└─────────────────────────────────────────┘");

  const v1RegistryAddress = registryAddress || ethers.ZeroAddress;
  let v1Address;
  if (existingV1) {
    v1Address = existingV1;
    console.log("Reusing existing V1Adapter:", v1Address);
  } else {
    const V1Adapter = await ethers.getContractFactory("V1Adapter");
    console.log("Deploying V1Adapter...");
    const v1Receipt = await deployContract(signer, V1Adapter, [v1RegistryAddress]);
    v1Address = v1Receipt.contractAddress;
    console.log("✓ impl:  ", v1Address);
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 2: V2Adapter
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 2: V2Adapter                       │");
  console.log("└─────────────────────────────────────────┘");

  let v2Address;
  if (existingV2) {
    v2Address = existingV2;
    console.log("Reusing existing V2Adapter:", v2Address);
  } else {
    const V2Adapter = await ethers.getContractFactory("V2Adapter");
    console.log("Deploying V2Adapter...");
    const v2Receipt = await deployContract(signer, V2Adapter);
    v2Address = v2Receipt.contractAddress;
    console.log("✓ impl:  ", v2Address);
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 3: V3Adapter
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 3: V3Adapter                       │");
  console.log("└─────────────────────────────────────────┘");

  let v3Address;
  if (existingV3) {
    v3Address = existingV3;
    console.log("Reusing existing V3Adapter:", v3Address);
  } else {
    const V3Adapter = await ethers.getContractFactory("V3Adapter");
    console.log("Deploying V3Adapter...");
    const v3Receipt = await deployContract(signer, V3Adapter);
    v3Address = v3Receipt.contractAddress;
    console.log("✓ impl:  ", v3Address);
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 4: Wire adapters to registry
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 4: Wiring adapters to registry     │");
  console.log("└─────────────────────────────────────────┘");

  if (!registryAddress) {
    console.log("No POB_REGISTRY set — skipping.");
  } else if (dryRun) {
    console.log("DRY_RUN — skipping setAdapter calls.");
  } else {
    const registry = await ethers.getContractAt("PoBRegistry", registryAddress);

    console.log("setAdapter(1, V1Adapter)...");
    await sendRaw(signer, await registry.setAdapter.populateTransaction(1, v1Address));
    console.log("  ✓ version 1 →", v1Address);

    console.log("setAdapter(2, V2Adapter)...");
    await sendRaw(signer, await registry.setAdapter.populateTransaction(2, v2Address));
    console.log("  ✓ version 2 →", v2Address);

    console.log("setAdapter(3, V3Adapter)...");
    await sendRaw(signer, await registry.setAdapter.populateTransaction(3, v3Address));
    console.log("  ✓ version 3 →", v3Address);
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════
  console.log("╔════════════════════════════════════════════╗");
  console.log("║          DEPLOYMENT COMPLETE ✓             ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  if (upgradeRegistry && registryAddress) {
    console.log("PoBRegistry impl: ", registryImpl);
    console.log("PoBRegistry proxy:", registryAddress);
  }
  console.log("V1Adapter:        ", v1Address);
  console.log("V2Adapter:        ", v2Address);
  console.log("V3Adapter:        ", v3Address);
  console.log("");

  // Save deployment info
  const outDir = path.join("deployments", network);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "adapters.json");
  const deployment = {
    network,
    chainId: chainId.toString(),
    deployer: signer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      V1Adapter: v1Address,
      V2Adapter: v2Address,
      V3Adapter: v3Address,
      ...(upgradeRegistry && registryAddress ? {
        PoBRegistry: { proxy: registryAddress, implementation: registryImpl }
      } : {})
    },
    registry: registryAddress || null,
    registryUpgraded: upgradeRegistry && !!registryAddress,
  };
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("Saved to:", outPath);
  console.log("");

  if (!dryRun && registryAddress) {
    console.log("NEXT STEPS:");
    console.log("  For each round, call registry.setRoundVersion(iterationId, roundId, versionId)");
    console.log("  e.g. iter 3 round 1 uses V3: setRoundVersion(3, 1, 3)");
    console.log("");
  }
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
