/**
 * CLEAN FULL DEPLOYMENT - Registry + PoB + JurySC
 *
 * Deploys everything fresh for a new iteration
 * Does NOT register in PoBRegistry (that's done separately later)
 *
 * Usage:
 *   POB_ITERATION=2 npx hardhat run scripts/deploy-clean-iteration.js --network testnet
 */

import pkg from "hardhat";
const { ethers, network, upgrades } = pkg;
import fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(network.config.chainId);

  if (!process.env.POB_ITERATION || !process.env.POB_NAME || !process.env.POB_SYMBOL) {
    throw new Error("Missing required env vars. Usage: POB_ITERATION=2 POB_NAME=\"Proof of Builders #2\" POB_SYMBOL=\"POB2\" npx hardhat run scripts/deploy.js --network testnet");
  }
  const iteration = Number(process.env.POB_ITERATION);
  const pobName = process.env.POB_NAME;
  const pobSymbol = process.env.POB_SYMBOL;
  const juryOwner = process.env.JURY_OWNER || deployer.address;
  const deployRegistry = process.env.DEPLOY_REGISTRY === "true";

  console.log("╔════════════════════════════════════════════╗");
  console.log("║   CLEAN ITERATION DEPLOYMENT               ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  console.log("Network:       ", network.name);
  console.log("Chain ID:      ", chainId);
  console.log("Deployer:      ", deployer.address);
  console.log("Iteration:     ", iteration);
  console.log("NFT Name:      ", pobName);
  console.log("NFT Symbol:    ", pobSymbol);
  console.log("Admin Owner:   ", juryOwner);
  console.log("");
  console.log("This will deploy:");
  if (deployRegistry) {
    console.log("  1. PoBRegistry (proxy + implementation)");
  } else {
    console.log("  1. PoBRegistry - SKIPPED (set DEPLOY_REGISTRY=true to deploy)");
  }
  console.log("  2. PoB_02 (NFT contract)");
  console.log("  3. JurySC_02 (proxy + implementation)");
  console.log("  4. Link PoB → JurySC");
  console.log("");
  console.log("Press Ctrl+C within 5 seconds to cancel...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log("");

  let registryAddress, registryImpl, pobAddress, juryAddress;

  // ═══════════════════════════════════════════════════════════
  // STEP 1: Deploy PoBRegistry (optional)
  // ═══════════════════════════════════════════════════════════
  if (deployRegistry) {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│ STEP 1: Deploying PoBRegistry           │");
    console.log("└─────────────────────────────────────────┘");

    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    console.log("Deploying proxy...");
    const registry = await upgrades.deployProxy(
      PoBRegistry,
      [deployer.address],
      { kind: "uups", initializer: "initialize" }
    );
    await registry.waitForDeployment();
    registryAddress = await registry.getAddress();

    registryImpl = await upgrades.erc1967.getImplementationAddress(registryAddress);
    console.log("✓ Registry Proxy:", registryAddress);
    console.log("  Implementation:", registryImpl);
    console.log("");
  } else {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│ STEP 1: PoBRegistry - SKIPPED           │");
    console.log("└─────────────────────────────────────────┘");
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 2: Deploy PoB_02
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 2: Deploying PoB_02                │");
  console.log("└─────────────────────────────────────────┘");

  const PoB_02 = await ethers.getContractFactory("PoB_02");
  console.log("Deploying PoB_02...");
  const pob = await PoB_02.deploy(pobName, pobSymbol, iteration, deployer.address);
  await pob.waitForDeployment();
  pobAddress = await pob.getAddress();

  console.log("✓ PoB_02:", pobAddress);
  console.log("  Owner:", await pob.owner());
  console.log("  Iteration:", (await pob.iteration()).toString());
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 3: Deploy JurySC_02
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 3: Deploying JurySC_02             │");
  console.log("└─────────────────────────────────────────┘");

  const JurySC_02 = await ethers.getContractFactory("JurySC_02");
  console.log("Deploying proxy...");
  const jurySC = await upgrades.deployProxy(
    JurySC_02,
    [pobAddress, iteration, juryOwner],
    { kind: "uups", initializer: "initialize" }
  );
  await jurySC.waitForDeployment();
  juryAddress = await jurySC.getAddress();

  const juryImpl = await upgrades.erc1967.getImplementationAddress(juryAddress);
  console.log("✓ JurySC_02 Proxy:", juryAddress);
  console.log("  Implementation:", juryImpl);
  console.log("  pob():", await jurySC.pob());
  console.log("  iteration():", (await jurySC.iteration()).toString());
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // STEP 4: Transfer PoB ownership to JurySC
  // ═══════════════════════════════════════════════════════════
  console.log("┌─────────────────────────────────────────┐");
  console.log("│ STEP 4: Linking PoB → JurySC            │");
  console.log("└─────────────────────────────────────────┘");

  console.log("Transferring ownership...");
  const transferTx = await pob.transferOwnership(juryAddress);
  await transferTx.wait();

  const newOwner = await pob.owner();
  if (newOwner.toLowerCase() !== juryAddress.toLowerCase()) {
    throw new Error(`FAILED! Owner is ${newOwner}, expected ${juryAddress}`);
  }
  console.log("✓ PoB_02 owner is now JurySC_02");
  console.log("");

  // ═══════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════
  console.log("╔════════════════════════════════════════════╗");
  console.log("║          DEPLOYMENT COMPLETE ✓             ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  if (deployRegistry) {
    console.log("PoBRegistry:  ", registryAddress);
  }
  console.log("PoB_02:       ", pobAddress);
  console.log("JurySC_02:    ", juryAddress);
  console.log("Admin:        ", juryOwner);
  console.log("");

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId,
    iteration,
    timestamp: new Date().toISOString(),
    contracts: {
      PoB_02: pobAddress,
      JurySC_02: {
        proxy: juryAddress,
        implementation: juryImpl
      }
    },
    owner: juryOwner,
    deployer: deployer.address
  };

  if (deployRegistry) {
    deploymentInfo.contracts.PoBRegistry = {
      proxy: registryAddress,
      implementation: registryImpl
    };
  }

  const filename = `deployment-iteration-${iteration}-${network.name}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("Saved to:", filename);
  console.log("");

  // For localhost, update iterations.local.json so frontend can find the contracts
  if (network.name === "localhost" || network.name === "hardhat") {
    const iterationsLocalPath = "../frontend/public/iterations.local.json";
    const iterationsLocal = [{
      iteration: iteration,
      name: `PoB Iteration #${iteration}`,
      jurySC: juryAddress,
      pob: pobAddress,
      chainId: chainId,
      deployBlockHint: 1,
      link: "https://example.com/iteration"
    }];
    fs.writeFileSync(iterationsLocalPath, JSON.stringify(iterationsLocal, null, 2));
    console.log("Updated:", iterationsLocalPath);
    console.log("");
  }

  if (deployRegistry) {
    console.log("UPDATE THESE FILES WITH REGISTRY ADDRESS:");
    console.log("  Registry Proxy:", registryAddress);
    console.log("");
    console.log("Files to update:");
    console.log("  - frontend/src/utils/registry.ts");
    console.log("  - api/src/services/tx-verifier.ts");
    console.log("");
  }
  console.log("NEXT STEPS:");
  console.log("  1. Register iteration/round in registry separately");
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
