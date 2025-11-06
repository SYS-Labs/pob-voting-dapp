/**
 * MANUAL RECOVERY DEPLOYMENT SCRIPT
 *
 * This script is used to recover from partial deployments when the main deploy.js
 * script fails mid-way or when you need to manually redeploy only the JurySC_01 contract.
 *
 * Use cases:
 * - PoB_01 deployed successfully but JurySC_01 deployment failed
 * - Need to deploy a new JurySC_01 proxy pointing to existing PoB_01
 * - Automatic resumption from deploy.js didn't work or state file was lost
 * - Recovery from deployment done by different process/tool
 *
 * Usage:
 *   POB_ADDRESS=0x... POB_ITERATION=1 JURY_OWNER=0x... npx hardhat run scripts/continue-deploy.js --network <network>
 *
 * Required environment variables:
 * - POB_ADDRESS: Address of existing PoB_01 contract
 *
 * Optional environment variables:
 * - POB_ITERATION: Iteration number (default: 1)
 * - JURY_OWNER: Admin address for JurySC_01 (default: deployer address)
 */

import pkg from "hardhat";
const { ethers, network, upgrades } = pkg;
import fs from "fs";
import path from "path";
import { waitForTxWithPolling } from "./utils/waitForTxWithPolling.js";

/**
 * Deploy proxy with custom polling
 */
async function deployProxyWithPolling(factory, args, label) {
  console.log(`\nDeploying ${label} proxy...`);

  const contract = await upgrades.deployProxy(
    factory,
    args,
    {
      kind: "uups",
      timeout: 0, // Disable built-in timeout
      pollingInterval: 20000
    }
  );

  const address = await contract.getAddress();
  console.log(`✓ ${label} proxy deployed to: ${address}`);

  return contract;
}

async function main() {
  const [deployer] = await ethers.getSigners();

  // Get parameters from environment or use defaults
  const iteration = Number(process.env.POB_ITERATION ?? "1");
  const juryOwner = process.env.JURY_OWNER ?? deployer.address;

  // Required: PoB_01 address from your partial deployment
  const pobAddress = process.env.POB_ADDRESS || "0xbE0BB73f2b9038cf97DCC8e00baE5628dfde6712";

  console.log("===========================================");
  console.log("🔧 MANUAL RECOVERY DEPLOYMENT");
  console.log("===========================================");
  console.log("This script deploys only JurySC_01 to an existing PoB_01.");
  console.log("Use this when deploy.js failed mid-way or for manual recovery.\n");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Iteration:", iteration);
  console.log("PoB_01 Address:", pobAddress);
  console.log("Jury Owner:", juryOwner);
  console.log(
    "Deployer balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "SYS"
  );
  console.log("===========================================");

  // Verify PoB_01 exists and is accessible
  console.log("\nVerifying PoB_01 contract...");
  const pobCode = await ethers.provider.getCode(pobAddress);
  if (pobCode === "0x") {
    throw new Error(`No contract found at PoB_01 address: ${pobAddress}`);
  }
  console.log("✓ PoB_01 contract verified");

  // Connect to existing PoB_01
  const PoB_01 = await ethers.getContractFactory("PoB_01");
  const pob = PoB_01.attach(pobAddress);

  // Check current owner
  const currentOwner = await pob.owner();
  console.log(`  Current PoB_01 owner: ${currentOwner}`);

  // Step 1: Deploy JurySC_01 Proxy
  console.log("\n--- Step 1: Deploy JurySC_01 ---");
  const JurySC_01 = await ethers.getContractFactory("JurySC_01");
  const jurySC = await deployProxyWithPolling(
    JurySC_01,
    [pobAddress, iteration, juryOwner],
    "JurySC_01"
  );
  const juryAddress = await jurySC.getAddress();

  // Step 2: Transfer PoB_01 ownership to JurySC_01
  console.log("\n--- Step 2: Transfer PoB_01 Ownership ---");

  if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.warn(
      `⚠️  PoB_01 current owner (${currentOwner}) is not the deployer (${deployer.address}). ` +
        "Cannot transfer ownership automatically."
    );
    console.log("\nManual steps required:");
    console.log(`1. From owner account ${currentOwner}, call:`);
    console.log(`   PoB_01(${pobAddress}).transferOwnership(${juryAddress})`);
  } else {
    console.log(`Transferring ownership to JurySC_01 proxy: ${juryAddress}`);
    const transferTx = await pob.transferOwnership(juryAddress);
    await waitForTxWithPolling(transferTx, 1, 20000);
    console.log("✓ Transferred PoB_01 ownership to JurySC_01 proxy");

    // Verify ownership transfer
    const newOwner = await pob.owner();
    if (newOwner.toLowerCase() === juryAddress.toLowerCase()) {
      console.log("✓ Ownership transfer verified");
    } else {
      console.warn(`⚠️  Warning: Owner is ${newOwner}, expected ${juryAddress}`);
    }
  }

  console.log("\n===========================================");
  console.log("Deployment Complete!");
  console.log("===========================================");
  console.log("PoB_01:", pobAddress);
  console.log("JurySC_01 proxy:", juryAddress);
  console.log("Admin account:", juryOwner);
  console.log("===========================================\n");

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    iteration,
    pobAddress,
    juryAddress,
    juryOwner,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    resumed: true
  };

  const infoFile = path.join(
    process.cwd(),
    `deployment-${network.name}-iteration-${iteration}.json`
  );
  fs.writeFileSync(infoFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`✓ Deployment info saved to: ${infoFile}\n`);

  // Display frontend config
  if (network.name === "testnet" || network.name === "mainnet") {
    console.log("Add this to frontend/public/iterations.json:");
    console.log("===========================================");
    console.log(JSON.stringify({
      iteration,
      name: `PoB Iteration #${iteration}`,
      jurySC: juryAddress,
      pob: pobAddress,
      chainId: network.config.chainId,
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
