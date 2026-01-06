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

  const iteration = Number(process.env.POB_ITERATION || "1");
  const pobName = process.env.POB_NAME || `Proof of Builders #${iteration}`;
  const pobSymbol = process.env.POB_SYMBOL || `POB${iteration}`;
  const juryOwner = process.env.JURY_OWNER || deployer.address;

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
  console.log("  1. PoBRegistry (proxy + implementation)");
  console.log("  2. PoB_02 (NFT contract)");
  console.log("  3. JurySC_02 (proxy + implementation)");
  console.log("  4. Link PoB → JurySC");
  console.log("");
  console.log("Press Ctrl+C within 5 seconds to cancel...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log("");

  let registryAddress, pobAddress, juryAddress;

  // ═══════════════════════════════════════════════════════════
  // STEP 1: Deploy PoBRegistry
  // ═══════════════════════════════════════════════════════════
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

  const registryImpl = await upgrades.erc1967.getImplementationAddress(registryAddress);
  console.log("✓ Registry Proxy:", registryAddress);
  console.log("  Implementation:", registryImpl);
  console.log("");

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
  console.log("PoBRegistry:  ", registryAddress);
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
      PoBRegistry: {
        proxy: registryAddress,
        implementation: registryImpl
      },
      PoB_02: pobAddress,
      JurySC_02: {
        proxy: juryAddress,
        implementation: juryImpl
      }
    },
    owner: juryOwner,
    deployer: deployer.address
  };

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

  console.log("UPDATE THESE FILES WITH REGISTRY ADDRESS:");
  console.log("  Registry Proxy:", registryAddress);
  console.log("");
  console.log("Files to update:");
  console.log("  - contracts/scripts/deploy.js (line 179)");
  console.log("  - frontend/src/utils/registry.ts (line 14)");
  console.log("  - api/src/services/tx-verifier.ts (line 22)");
  console.log("  - contracts/scripts/migrate-to-registry.js (line 34)");
  console.log("");
  console.log("NEXT STEPS:");
  console.log("  1. Update config files with registry address above");
  console.log("  2. Register iteration/round in registry separately");
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
