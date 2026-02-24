/**
 * Deploy CertNFT + CertGate for local development.
 *
 * Reads the latest deployment-iteration-*-localhost-*.json, deploys CertNFT
 * as a UUPS proxy, upgrades PoBRegistry (adds template storage), deploys
 * CertGate for the iteration, links it to CertNFT, and links PoBRegistry
 * to CertNFT. Template must be published via POST /api/templates/publish
 * and then set on PoBRegistry via setIterationTemplate().
 *
 * Usage:
 *   npx hardhat run scripts/deploy-certs-local.js --network localhost
 */

import fs from "fs";
import path from "path";
import pkg from "hardhat";
const { ethers, upgrades } = pkg;

/**
 * Find the latest localhost deployment file (same pattern as seed-local.js)
 */
function getLatestLocalDeployment() {
  const contractsDir = process.cwd();
  const files = fs
    .readdirSync(contractsDir)
    .filter(
      (f) =>
        f.startsWith("deployment-iteration-") &&
        f.includes("localhost") &&
        f.endsWith(".json")
    )
    .sort()
    .reverse();

  if (files.length === 0) {
    return { data: null, filePath: null };
  }

  const filePath = path.join(contractsDir, files[0]);
  return { data: JSON.parse(fs.readFileSync(filePath, "utf8")), filePath };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(
    `\nDeploying CertNFT + middleware on chain ${chainId} with account ${deployer.address}`
  );

  // 1. Read latest deployment file
  const { data: deployment, filePath: deploymentFilePath } =
    getLatestLocalDeployment();
  if (!deployment || !deploymentFilePath) {
    throw new Error(
      "No deployment file found. Run deploy.js + seed-local.js first."
    );
  }

  console.log(`Using deployment: ${deploymentFilePath}`);

  // Extract addresses
  const registryProxy =
    deployment.contracts?.PoBRegistry?.proxy ||
    deployment.contracts?.PoBRegistry;
  const pobAddress = deployment.contracts?.PoB_02;
  const juryAddress =
    deployment.contracts?.JurySC_02?.proxy ||
    deployment.contracts?.JurySC_02;
  const iteration = deployment.iteration || 1;

  if (!registryProxy || !pobAddress || !juryAddress) {
    throw new Error(
      "Deployment file missing PoBRegistry, PoB_02, or JurySC_02 addresses."
    );
  }

  console.log(`  Registry: ${registryProxy}`);
  console.log(`  PoB_02:   ${pobAddress}`);
  console.log(`  JurySC_02: ${juryAddress}`);
  console.log(`  Iteration: ${iteration}`);

  // 2. Deploy CertNFT as UUPS proxy
  console.log("\n--- Deploying CertNFT ---");
  const CertNFT = await ethers.getContractFactory("CertNFT");
  const certNFT = await upgrades.deployProxy(CertNFT, [deployer.address], {
    kind: "uups",
  });
  await certNFT.waitForDeployment();
  const certNFTAddress = await certNFT.getAddress();
  console.log(`CertNFT proxy deployed at: ${certNFTAddress}`);

  // 3. Upgrade PoBRegistry (adds profile storage)
  console.log("\n--- Upgrading PoBRegistry ---");
  const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
  const upgraded = await upgrades.upgradeProxy(registryProxy, PoBRegistry);
  await upgraded.waitForDeployment();
  console.log(`PoBRegistry upgraded at: ${registryProxy}`);

  // 4. Deploy CertGate
  console.log("\n--- Deploying CertGate ---");
  const CertGate = await ethers.getContractFactory("CertGate");
  const gate = await CertGate.deploy(
    [pobAddress],
    [juryAddress],
    deployer.address
  );
  await gate.waitForDeployment();
  const gateAddress = await gate.getAddress();
  console.log(`CertGate deployed at: ${gateAddress}`);

  // 5. Link CertGate to CertNFT
  const tx1 = await certNFT.setMiddleware(iteration, gateAddress);
  await tx1.wait();
  console.log(`CertGate linked to CertNFT for iteration ${iteration}`);

  // 5b. Link PoBRegistry to CertNFT (so renderSVG can look up template hash)
  const tx2 = await certNFT.setPoBRegistry(registryProxy);
  await tx2.wait();
  console.log(`PoBRegistry linked to CertNFT: ${registryProxy}`);

  // Note: certificate template is set on PoBRegistry via:
  //   registry.setIterationTemplate(iteration, keccak256(svgBytes), cid)
  // Only call this after the API's /api/templates/publish endpoint has
  // produced a sanitized CID for the iteration template.

  // 7. Update deployment JSON file
  deployment.contracts.CertNFT = {
    proxy: certNFTAddress,
  };
  deployment.contracts.CertGate = gateAddress;

  fs.writeFileSync(deploymentFilePath, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment file updated: ${deploymentFilePath}`);

  // 7b. Update iterations.local.json with CertNFT address
  const iterationsLocalPath = path.join(
    process.cwd(),
    "../frontend/public/iterations.local.json"
  );
  if (fs.existsSync(iterationsLocalPath)) {
    const iterationsLocal = JSON.parse(
      fs.readFileSync(iterationsLocalPath, "utf8")
    );
    if (Array.isArray(iterationsLocal)) {
      for (const entry of iterationsLocal) {
        if (entry.iteration === iteration) {
          entry.certNFT = certNFTAddress;
        }
      }
      fs.writeFileSync(
        iterationsLocalPath,
        JSON.stringify(iterationsLocal, null, 2)
      );
      console.log(`Updated: ${iterationsLocalPath} (certNFT: ${certNFTAddress})`);
    }
  }

  // 8. Summary
  console.log("\n========== Cert Deployment Summary ==========");
  console.log(`Iteration:          ${iteration}`);
  console.log(`CertNFT:            ${certNFTAddress}`);
  console.log(`CertGate:           ${gateAddress}`);
  console.log(`PoBRegistry:        ${registryProxy} (upgraded)`);
  console.log(`Template:           set via POST /api/templates/publish → registry.setIterationTemplate()`);
  console.log("=============================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
