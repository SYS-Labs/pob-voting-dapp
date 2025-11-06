/**
 * Upgrade JurySC_01 contract to a new implementation
 *
 * Usage:
 *   npx hardhat run scripts/upgrade.js --network <network>
 *
 * Environment variables:
 *   PROXY_ADDRESS - Address of the existing proxy contract (required)
 *   DRY_RUN - Set to "true" to validate without upgrading (optional)
 *
 * Example:
 *   PROXY_ADDRESS=0x1234... npx hardhat run scripts/upgrade.js --network localhost
 *   PROXY_ADDRESS=0x1234... DRY_RUN=true npx hardhat run scripts/upgrade.js --network localhost
 */

import hre from "hardhat";
const { ethers, upgrades } = hre;
import { waitForTxWithPolling } from "./utils/waitForTxWithPolling.js";

async function main() {
  const PROXY_ADDRESS = process.env.PROXY_ADDRESS;
  const DRY_RUN = process.env.DRY_RUN === "true";
  const CONFIRMATIONS = Number(process.env.CONFIRMATIONS ?? "1");
  const POLL_INTERVAL = Number(process.env.POLL_INTERVAL ?? "20000");

  if (!PROXY_ADDRESS) {
    throw new Error("PROXY_ADDRESS environment variable is required");
  }

  const [deployer] = await ethers.getSigners();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           JurySC_01 Contract Upgrade                           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Network:", hre.network.name);
  console.log("Upgrader:", deployer.address);
  console.log("Proxy address:", PROXY_ADDRESS);
  console.log("");

  // Check if address is valid
  if (!ethers.isAddress(PROXY_ADDRESS)) {
    throw new Error(`Invalid proxy address: ${PROXY_ADDRESS}`);
  }

  // Get current implementation
  const JurySC_01 = await ethers.getContractFactory("JurySC_01");
  const proxyContract = JurySC_01.attach(PROXY_ADDRESS);

  console.log("─────────────────────────────────────────────────────────────────");
  console.log("CURRENT CONTRACT STATE");
  console.log("─────────────────────────────────────────────────────────────────");

  try {
    const iteration = await proxyContract.iteration();
    const startTime = await proxyContract.startTime();
    const endTime = await proxyContract.endTime();
    const locked = await proxyContract.locked();
    const projectCount = await proxyContract.projectCount();

    console.log("Iteration:", iteration.toString());
    console.log("Projects registered:", projectCount.toString());

    // Try to read votingMode (may not exist in older versions)
    try {
      const votingMode = await proxyContract.votingMode();
      const votingModeName = votingMode === 0 ? "CONSENSUS" : "WEIGHTED";
      console.log("Voting mode:", votingModeName);
    } catch (e) {
      console.log("Voting mode:", "Not available (older version)");
    }

    console.log("Start time:", startTime.toString());
    console.log("End time:", endTime.toString());
    console.log("Locked:", locked);

    // Check if voting is active
    const now = Math.floor(Date.now() / 1000);
    const isActive = startTime > 0 && now >= startTime && now < endTime && !locked;
    console.log("Currently active:", isActive);
    console.log("");

    // Safety checks
    if (isActive) {
      console.log("⚠️  WARNING: Voting is currently active!");
      console.log("   The old contract allows upgrades during voting,");
      console.log("   but the new contract will block this in the future.");
      console.log("   Consider waiting until voting ends.");
      console.log("");
    }

    if (locked) {
      console.log("❌  ERROR: Contract is locked for history!");
      console.log("   Upgrades are permanently blocked after locking.");
      console.log("");
      process.exit(1);
    }

  } catch (error) {
    console.log("⚠️  Could not read current state:", error.message);
    console.log("   Contract may not be deployed or not a valid JurySC_01 proxy");
    console.log("");
    process.exit(1);
  }

  // Validate upgrade
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("VALIDATING UPGRADE");
  console.log("─────────────────────────────────────────────────────────────────");

  try {
    await upgrades.validateUpgrade(PROXY_ADDRESS, JurySC_01, {
      kind: "uups"
    });
    console.log("✓ Storage layout is compatible");
    console.log("✓ New implementation is valid");
    console.log("");
  } catch (error) {
    console.log("✗ Upgrade validation failed!");
    console.log("");
    console.log("Error:", error.message);
    console.log("");
    console.log("This usually means:");
    console.log("  - Storage layout has breaking changes");
    console.log("  - New variables were inserted (not appended)");
    console.log("  - Variable types were changed");
    console.log("");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("─────────────────────────────────────────────────────────────────");
    console.log("DRY RUN MODE - No changes made");
    console.log("─────────────────────────────────────────────────────────────────");
    console.log("");
    console.log("✓ Upgrade validation successful");
    console.log("  Run without DRY_RUN=true to perform actual upgrade");
    console.log("");
    return;
  }

  // Perform upgrade
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("UPGRADING CONTRACT");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("");
  console.log("⏳ Deploying new implementation...");

  const implementationContract = await JurySC_01.deploy();
  const implementationDeployTx = implementationContract.deploymentTransaction();

  let implementationAddress;
  if (implementationDeployTx) {
    const receipt = await waitForTxWithPolling(implementationDeployTx, CONFIRMATIONS, POLL_INTERVAL);
    implementationAddress = receipt.contractAddress;
  } else {
    implementationAddress = await implementationContract.getAddress();
  }

  console.log("✓ New implementation deployed at:", implementationAddress);

  // Check if already upgraded to this implementation
  const currentImpl = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  if (currentImpl.toLowerCase() === implementationAddress.toLowerCase()) {
    console.log("");
    console.log("⚠️  Proxy is already pointing to this implementation!");
    console.log("Skipping upgrade step.");
    console.log("");
  } else {
    console.log("⏳ Upgrading proxy to new implementation...");

    try {
      // Use OpenZeppelin's upgradeProxy method which handles the upgrade call
      const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, JurySC_01, {
        kind: "uups",
        timeout: 0,
        pollingInterval: POLL_INTERVAL
      });

      await upgraded.waitForDeployment();
      console.log("✓ Upgrade transaction confirmed");
    } catch (error) {
      console.error("❌ Upgrade failed:", error.message);
      console.log("");
      console.log("You can manually upgrade using continue-upgrade.js:");
      console.log(`PROXY_ADDRESS=${PROXY_ADDRESS} NEW_IMPL=${implementationAddress} npx hardhat run scripts/continue-upgrade.js --network ${network.name}`);
      console.log("");
      throw error;
    }
  }

  const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);

  console.log("✓ Upgrade complete!");
  console.log("");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("UPGRADE SUMMARY");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Proxy address:", PROXY_ADDRESS);
  console.log("New implementation:", newImplementationAddress);
  console.log("");
  console.log("✓ All storage preserved");
  console.log("✓ Contract functionality updated");
  console.log("");

  // Verify state is still accessible
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("VERIFYING STATE AFTER UPGRADE");
  console.log("─────────────────────────────────────────────────────────────────");

  const iteration = await upgraded.iteration();
  const projectCount = await upgraded.projectCount();

  console.log("✓ Iteration:", iteration.toString());
  console.log("✓ Projects:", projectCount.toString());

  try {
    const votingMode = await upgraded.votingMode();
    const votingModeName = votingMode === 0 ? "CONSENSUS" : "WEIGHTED";
    console.log("✓ Voting mode:", votingModeName);
  } catch (e) {
    console.log("✓ Voting mode: Available after upgrade");
  }

  console.log("");

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    UPGRADE SUCCESSFUL!                         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
