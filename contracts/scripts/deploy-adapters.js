/**
 * Deploy V1Adapter and V2Adapter, optionally upgrade PoBRegistry and wire everything together.
 *
 * Environment variables:
 *   POB_REGISTRY     - PoBRegistry proxy address (required if UPGRADE_REGISTRY=true)
 *   UPGRADE_REGISTRY - Set to "true" to upgrade the PoBRegistry proxy to new implementation
 *   DRY_RUN          - Set to "true" to only deploy adapters without calling setAdapter/setRoundVersion
 *
 * Usage:
 *   POB_REGISTRY=0x... UPGRADE_REGISTRY=true npx hardhat run scripts/deploy-adapters.js --network testnet
 *   DRY_RUN=true npx hardhat run scripts/deploy-adapters.js --network localhost
 */

import hre from "hardhat";
const { ethers, upgrades } = hre;
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const registryAddress = process.env.POB_REGISTRY;
  const upgradeRegistry = process.env.UPGRADE_REGISTRY === "true";
  const dryRun = process.env.DRY_RUN === "true";

  console.log(`Deploying adapters on ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log();

  // 1. Deploy V1Adapter (needs registry address for voting mode overrides)
  const v1RegistryAddress = registryAddress || ethers.ZeroAddress;
  console.log(`Deploying V1Adapter (registry: ${v1RegistryAddress})...`);
  const V1Adapter = await ethers.getContractFactory("V1Adapter");
  const v1Adapter = await V1Adapter.deploy(v1RegistryAddress);
  await v1Adapter.waitForDeployment();
  const v1Address = await v1Adapter.getAddress();
  console.log(`  V1Adapter deployed at: ${v1Address}`);

  // 2. Deploy V2Adapter
  console.log("Deploying V2Adapter...");
  const V2Adapter = await ethers.getContractFactory("V2Adapter");
  const v2Adapter = await V2Adapter.deploy();
  await v2Adapter.waitForDeployment();
  const v2Address = await v2Adapter.getAddress();
  console.log(`  V2Adapter deployed at: ${v2Address}`);

  let registry;

  // 3. Optionally upgrade PoBRegistry
  if (upgradeRegistry && registryAddress) {
    console.log(`\nUpgrading PoBRegistry at ${registryAddress}...`);
    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    registry = await upgrades.upgradeProxy(registryAddress, PoBRegistry);
    await registry.waitForDeployment();
    console.log(`  PoBRegistry upgraded. Version: ${await registry.version()}`);
  } else if (registryAddress) {
    console.log(`\nUsing existing PoBRegistry at ${registryAddress}`);
    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    registry = PoBRegistry.attach(registryAddress);
  }

  // 4. Wire adapters to registry
  if (registry && !dryRun) {
    console.log("\nSetting adapters on registry...");

    const tx1 = await registry.setAdapter(1, v1Address);
    await tx1.wait();
    console.log(`  setAdapter(1, ${v1Address}) - tx: ${tx1.hash}`);

    const tx2 = await registry.setAdapter(2, v2Address);
    await tx2.wait();
    console.log(`  setAdapter(2, ${v2Address}) - tx: ${tx2.hash}`);
  } else if (dryRun) {
    console.log("\nDRY_RUN mode - skipping setAdapter/setRoundVersion calls");
  }

  // 5. Save deployment info
  const deployment = {
    network,
    chainId: chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      V1Adapter: v1Address,
      V2Adapter: v2Address,
    },
    registry: registryAddress || null,
    registryUpgraded: upgradeRegistry,
  };

  const outDir = path.join("deployments", network);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "adapters.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to ${outPath}`);
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
