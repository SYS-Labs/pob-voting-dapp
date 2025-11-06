import pkg from "hardhat";
const { ethers, network, upgrades } = pkg;
import fs from "fs";
import path from "path";
import { waitForTxWithPolling } from "./utils/waitForTxWithPolling.js";

/**
 * Deploy contract with custom polling
 */
async function deployContractWithPolling(factory, args, label) {
  console.log(`\nDeploying ${label}...`);
  const contract = await factory.deploy(...args);

  // Get deployment transaction
  const deployTx = contract.deploymentTransaction();
  if (deployTx) {
    await waitForTxWithPolling(deployTx, 1, 20000);
  }

  const address = await contract.getAddress();
  console.log(`✓ ${label} deployed to: ${address}`);

  // Save deployment info
  saveDeploymentState({ [label]: address });

  return contract;
}

/**
 * Deploy proxy with custom polling
 */
async function deployProxyWithPolling(factory, args, label) {
  console.log(`\nDeploying ${label} proxy...`);

  // Deploy implementation
  const contract = await upgrades.deployProxy(
    factory,
    args,
    {
      kind: "uups",
      timeout: 0, // Disable built-in timeout, we'll handle it
      pollingInterval: 20000
    }
  );

  const address = await contract.getAddress();
  console.log(`✓ ${label} proxy deployed to: ${address}`);

  // Save deployment info
  saveDeploymentState({ [label]: address });

  return contract;
}

/**
 * Save deployment state to file for resumption
 */
function saveDeploymentState(data) {
  const stateFile = path.join(process.cwd(), '.deployment-state.json');
  let state = {};

  if (fs.existsSync(stateFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }

  Object.assign(state, data);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log(`  (State saved to .deployment-state.json)`);
}

/**
 * Load deployment state
 */
function loadDeploymentState() {
  const stateFile = path.join(process.cwd(), '.deployment-state.json');
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }
  return {};
}

/**
 * Clear deployment state
 */
function clearDeploymentState() {
  const stateFile = path.join(process.cwd(), '.deployment-state.json');
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    console.log('✓ Cleared deployment state');
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const iteration = Number(process.env.POB_ITERATION ?? "1");
  const pobName = process.env.POB_NAME ?? "Proof of Builders v1";
  const pobSymbol = process.env.POB_SYMBOL ?? "POB1";
  const juryOwner = process.env.JURY_OWNER ?? deployer.address;

  if (!Number.isInteger(iteration) || iteration <= 0) {
    throw new Error(`Invalid POB_ITERATION value: ${process.env.POB_ITERATION}`);
  }

  console.log("===========================================");
  console.log("Deploying Proof-of-Builders v1 contracts");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Iteration:", iteration);
  console.log("Desired owner (Jury admin):", juryOwner);
  console.log(
    "Deployer balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "SYS"
  );
  console.log("===========================================");

  // Check for existing deployment state
  const existingState = loadDeploymentState();
  if (Object.keys(existingState).length > 0) {
    console.log("\n⚠️  Found existing deployment state:");
    console.log(JSON.stringify(existingState, null, 2));
    console.log("\nTo resume from this state, use: node scripts/continue-deploy.js");
    console.log("To start fresh, delete .deployment-state.json\n");
    throw new Error("Deployment state exists. Please resume or clear it.");
  }

  let pobAddress, juryAddress;

  // Step 1: Deploy PoB_01
  const PoB_01 = await ethers.getContractFactory("PoB_01");
  const pob = await deployContractWithPolling(
    PoB_01,
    [pobName, pobSymbol, iteration, juryOwner],
    "PoB_01"
  );
  pobAddress = await pob.getAddress();

  // Step 2: Deploy JurySC_01 Proxy
  const JurySC_01 = await ethers.getContractFactory("JurySC_01");
  const jurySC = await deployProxyWithPolling(
    JurySC_01,
    [pobAddress, iteration, juryOwner],
    "JurySC_01"
  );
  juryAddress = await jurySC.getAddress();

  // Step 3: Transfer PoB_01 ownership to JurySC_01
  console.log("\nTransferring PoB_01 ownership to JurySC_01...");
  const pobOwner = await pob.owner();

  if (pobOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.warn(
      `⚠️  PoB_01 current owner (${pobOwner}) is not the deployer. ` +
        "Skipping ownership transfer. Please transfer manually."
    );
  } else {
    const transferTx = await pob.transferOwnership(juryAddress);
    await waitForTxWithPolling(transferTx, 1, 20000);
    console.log("✓ Transferred PoB_01 ownership to JurySC_01 proxy");
  }

  console.log("\n===========================================");
  console.log("Deployment Complete!");
  console.log("===========================================");
  console.log("PoB_01:", pobAddress);
  console.log("JurySC_01 proxy:", juryAddress);
  console.log("Admin account:", juryOwner);
  console.log("===========================================\n");

  // Save final deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    iteration,
    pobAddress,
    juryAddress,
    juryOwner,
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };

  const infoFile = path.join(
    process.cwd(),
    `deployment-${network.name}-iteration-${iteration}.json`
  );
  fs.writeFileSync(infoFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`✓ Deployment info saved to: ${infoFile}\n`);

  // Clear deployment state
  clearDeploymentState();

  // Update frontend config
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("\nUpdating frontend config for local development...");
    const iterationsPath = path.join(
      process.cwd(),
      "../frontend/public/iterations.local.json"
    );
    const iterations = [
      {
        iteration,
        name: `PoB Iteration #${iteration}`,
        jurySC: juryAddress,
        pob: pobAddress,
        chainId: 31337,
        deployBlockHint: 1,
        link: "https://example.com/iteration",
      },
    ];

    fs.writeFileSync(iterationsPath, JSON.stringify(iterations, null, 2));
    console.log("✓ Updated frontend/public/iterations.local.json");

    // Update frontend ABIs
    console.log("\nUpdating frontend ABIs...");
    const { execSync } = await import("child_process");
    try {
      execSync("node scripts/update-abis.js", {
        cwd: process.cwd(),
        stdio: "inherit"
      });
    } catch (error) {
      console.error("Failed to update ABIs:", error.message);
      console.warn("You may need to run 'node scripts/update-abis.js' manually");
    }
  } else if (network.name === "testnet" || network.name === "mainnet") {
    console.log("\nRemember to update frontend/public/iterations.json with:");
    console.log(JSON.stringify({
      iteration,
      name: `PoB Iteration #${iteration}`,
      jurySC: juryAddress,
      pob: pobAddress,
      chainId: network.config.chainId,
      deployBlockHint: 1,
      link: "https://example.com/iteration"
    }, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    console.log("\nTo resume from saved state, run: node scripts/continue-deploy.js");
    process.exit(1);
  });
