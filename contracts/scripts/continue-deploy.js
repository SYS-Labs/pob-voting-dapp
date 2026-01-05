/**
 * MANUAL RECOVERY DEPLOYMENT SCRIPT
 *
 * This script is used to recover from partial deployments when the main deploy.js
 * script fails mid-way or when you need to manually redeploy only the JurySC_02 contract.
 *
 * Use cases:
 * - PoB_02 deployed successfully but JurySC_02 deployment failed
 * - Need to deploy a new JurySC_02 proxy pointing to existing PoB_02
 * - JurySC_02 already deployed but ownership transfer/registration not done
 * - Automatic resumption from deploy.js didn't work or state file was lost
 * - Recovery from deployment done by different process/tool
 *
 * Usage:
 *   # Deploy JurySC_02 and link to PoB_02:
 *   POB_ADDRESS=0x... POB_ITERATION=1 POB_REGISTRY=0x... npx hardhat run scripts/continue-deploy.js --network <network>
 *
 *   # Link existing JurySC_02 to PoB_02 (skip deployment):
 *   POB_ADDRESS=0x... JURY_SC=0x... POB_ITERATION=1 POB_REGISTRY=0x... npx hardhat run scripts/continue-deploy.js --network <network>
 *
 * Required environment variables:
 * - POB_ADDRESS: Address of existing PoB_02 contract
 * - POB_REGISTRY: Address of PoBRegistry contract
 *
 * Optional environment variables:
 * - JURY_SC: Address of existing JurySC_02 (if already deployed, skips deployment)
 * - POB_ITERATION: Iteration number (default: 1)
 * - JURY_OWNER: Admin address for JurySC_02 (default: deployer address)
 */

import pkg from "hardhat";
const { ethers, network, upgrades } = pkg;
import fs from "fs";
import path from "path";
import { waitForTxWithPolling } from "./utils/waitForTxWithPolling.js";

/**
 * Deploy proxy with manual async polling
 * Push tx and poll manually every 25 seconds
 */
async function deployProxyWithPolling(factory, args, label) {
  console.log(`\nDeploying ${label} proxy...`);

  // Deploy with manual polling interval
  const contract = await upgrades.deployProxy(
    factory,
    args,
    {
      kind: "uups",
      timeout: 0, // Disable built-in timeout
      pollingInterval: 25000 // Poll every 25 seconds
    }
  );

  const address = await contract.getAddress();
  console.log(`✓ ${label} proxy deployed to: ${address}`);

  return contract;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(network.config.chainId);

  // Get parameters from environment or use defaults
  const iteration = Number(process.env.POB_ITERATION ?? "1");
  const juryOwner = process.env.JURY_OWNER ?? deployer.address;

  // Required: PoB_02 address from your partial deployment
  const pobAddress = process.env.POB_ADDRESS;
  if (!pobAddress) {
    throw new Error("POB_ADDRESS environment variable is required");
  }

  // Required: PoBRegistry address
  const registryAddress = process.env.POB_REGISTRY;
  if (!registryAddress) {
    throw new Error("POB_REGISTRY environment variable is required");
  }

  // Optional: Existing JurySC_02 address (skips deployment if provided)
  const existingJuryAddress = process.env.JURY_SC;

  console.log("===========================================");
  console.log("🔧 MANUAL RECOVERY DEPLOYMENT");
  console.log("===========================================");
  console.log("This script links PoB_02 and JurySC_02, and registers in PoBRegistry.");
  console.log("Use this when deploy.js failed mid-way or for manual recovery.\n");
  console.log("Network:", network.name);
  console.log("Chain ID:", chainId);
  console.log("Deployer:", deployer.address);
  console.log("Iteration:", iteration);
  console.log("PoB_02 Address:", pobAddress);
  console.log("PoBRegistry:", registryAddress);
  console.log("Jury Owner:", juryOwner);
  if (existingJuryAddress) {
    console.log("Existing JurySC_02:", existingJuryAddress, "(will skip deployment)");
  }
  console.log(
    "Deployer balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "SYS"
  );
  console.log("===========================================");

  // Verify PoBRegistry exists
  console.log("\nVerifying PoBRegistry...");
  const registryCode = await ethers.provider.getCode(registryAddress);
  if (registryCode === "0x") {
    throw new Error(`No contract found at PoBRegistry address: ${registryAddress}`);
  }
  console.log("✓ PoBRegistry verified");

  // Verify PoB_02 exists and is accessible
  console.log("\nVerifying PoB_02 contract...");
  const pobCode = await ethers.provider.getCode(pobAddress);
  if (pobCode === "0x") {
    throw new Error(`No contract found at PoB_02 address: ${pobAddress}`);
  }
  console.log("✓ PoB_02 contract verified");

  // Connect to existing PoB_02
  const PoB_02 = await ethers.getContractFactory("PoB_02");
  const pob = PoB_02.attach(pobAddress);

  // Check current owner
  const currentOwner = await pob.owner();
  console.log(`  Current PoB_02 owner: ${currentOwner}`);

  // Step 1: Deploy or attach to existing JurySC_02 Proxy
  let juryAddress;
  const JurySC_02 = await ethers.getContractFactory("JurySC_02");

  if (existingJuryAddress) {
    console.log("\n--- Step 1: Using Existing JurySC_02 ---");
    console.log("Verifying existing JurySC_02...");
    const juryCode = await ethers.provider.getCode(existingJuryAddress);
    if (juryCode === "0x") {
      throw new Error(`No contract found at JurySC_02 address: ${existingJuryAddress}`);
    }
    juryAddress = existingJuryAddress;
    console.log("✓ JurySC_02 verified at:", juryAddress);
  } else {
    console.log("\n--- Step 1: Deploy JurySC_02 ---");
    const jurySC = await deployProxyWithPolling(
      JurySC_02,
      [pobAddress, iteration, juryOwner],
      "JurySC_02"
    );
    juryAddress = await jurySC.getAddress();
  }

  // Step 2: Transfer PoB_02 ownership to JurySC_02
  console.log("\n--- Step 2: Transfer PoB_02 Ownership ---");

  if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.warn(
      `⚠️  PoB_02 current owner (${currentOwner}) is not the deployer (${deployer.address}). ` +
        "Cannot transfer ownership automatically."
    );
    console.log("\nManual steps required:");
    console.log(`1. From owner account ${currentOwner}, call:`);
    console.log(`   PoB_02(${pobAddress}).transferOwnership(${juryAddress})`);
  } else {
    console.log(`Transferring ownership to JurySC_02 proxy: ${juryAddress}`);
    const transferTx = await pob.transferOwnership(juryAddress);
    console.log(`  Transaction hash: ${transferTx.hash}`);
    console.log(`  Waiting for confirmation (polling every 25s)...`);

    // Manual polling every 25 seconds
    const provider = ethers.provider;
    let receipt = null;
    let attempts = 0;
    const maxAttempts = 60;
    const pollInterval = 25000;

    while (!receipt && attempts < maxAttempts) {
      attempts++;

      try {
        receipt = await provider.getTransactionReceipt(transferTx.hash);
        if (receipt) {
          console.log(`  ✓ Transaction mined in block ${receipt.blockNumber}`);
          break;
        }
      } catch (error) {
        // Ignore errors, keep polling
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    if (!receipt) {
      throw new Error(`Transfer tx ${transferTx.hash} not mined after ${maxAttempts} attempts`);
    }

    console.log("✓ Transferred PoB_02 ownership to JurySC_02 proxy");

    // Verify ownership transfer
    const newOwner = await pob.owner();
    if (newOwner.toLowerCase() === juryAddress.toLowerCase()) {
      console.log("✓ Ownership transfer verified");
    } else {
      console.warn(`⚠️  Warning: Owner is ${newOwner}, expected ${juryAddress}`);
    }
  }

  // Step 3: Register in PoBRegistry
  console.log("\n--- Step 3: Register in PoBRegistry ---");
  const registry = await ethers.getContractAt("PoBRegistry", registryAddress);
  const provider = ethers.provider;

  // Check if iteration already exists
  const existingIteration = await registry.iterations(iteration);
  if (!existingIteration.exists) {
    console.log(`Registering iteration ${iteration}...`);
    const registerIterTx = await registry.registerIteration(iteration, chainId);
    await waitForTxWithPolling(registerIterTx, 1, 25000, provider);
    console.log(`✓ Iteration ${iteration} registered`);
  } else {
    console.log(`✓ Iteration ${iteration} already registered`);
  }

  // Check if round already exists
  const roundId = 1; // First round of this iteration
  const existingRound = await registry.rounds(iteration, roundId);
  if (!existingRound.exists) {
    console.log(`Registering round ${roundId} for iteration ${iteration}...`);
    const deployBlockHint = await provider.getBlockNumber();

    const registerRoundTx = await registry.addRound(
      iteration,
      roundId,
      juryAddress,
      deployBlockHint
    );
    await waitForTxWithPolling(registerRoundTx, 1, 25000, provider);
    console.log(`✓ Round ${roundId} registered`);
  } else {
    console.log(`✓ Round ${roundId} already registered for iteration ${iteration}`);
  }

  console.log("\n===========================================");
  console.log("Deployment Complete!");
  console.log("===========================================");
  console.log("PoB_02:", pobAddress);
  console.log("JurySC_02 proxy:", juryAddress);
  console.log("PoBRegistry:", registryAddress);
  console.log("Admin account:", juryOwner);
  console.log("===========================================\n");

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: chainId,
    iteration,
    version: "v02",
    pobAddress,
    juryAddress,
    registryAddress,
    juryOwner,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    resumed: true
  };

  const infoFile = path.join(
    process.cwd(),
    `deployment-v02-${network.name}-iteration-${iteration}.json`
  );
  fs.writeFileSync(infoFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`✓ Deployment info saved to: ${infoFile}\n`);

  // Display next steps
  if (network.name === "testnet" || network.name === "mainnet") {
    console.log("===========================================");
    console.log("NEXT STEPS");
    console.log("===========================================");
    console.log("1. Register iteration & round in PoBRegistry");
    console.log("2. Add to frontend/public/iterations.json:");
    console.log(JSON.stringify({
      iteration,
      round: 1,
      name: `Proof of Builders #${iteration}`,
      jurySC: juryAddress,
      pob: pobAddress,
      chainId: chainId,
      version: "002",
      deployBlockHint: 1,
      link: "https://example.com/iteration"
    }, null, 2));
    console.log("===========================================\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Continuation failed:");
    console.error(error);
    process.exit(1);
  });
