#!/usr/bin/env node
/**
 * Update Frontend ABIs
 *
 * Extracts ABIs from compiled contract artifacts and copies them to the frontend.
 * Run after compilation: npx hardhat compile && node scripts/update-abis.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths configuration
const ARTIFACTS_DIR = path.join(__dirname, "../artifacts");
const FRONTEND_ABIS_DIR = path.join(__dirname, "../../frontend/src/abis");

const CONTRACTS = [
  { name: "JurySC_01", path: "contracts/JurySC_01.sol" },
  { name: "PoB_01", path: "contracts/PoB_01.sol" },
  { name: "JurySC_02", path: "contracts/JurySC_02.sol", outputName: "JurySC_02_v001" },
  { name: "PoB_02", path: "contracts/PoB_02.sol", outputName: "PoB_02_v001" },
  { name: "PoBRegistry", path: "contracts/PoBRegistry.sol" },
  { name: "CertNFT", path: "contracts/CertNFT.sol" },
  { name: "CertMiddleware_001", path: "contracts/CertMiddleware_001.sol" }
];

function extractABI(contractName, contractPath) {
  const artifactPath = path.join(
    ARTIFACTS_DIR,
    contractPath,
    `${contractName}.json`
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found: ${artifactPath}\nDid you run 'npx hardhat compile' first?`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));

  if (!artifact.abi) {
    throw new Error(`No ABI found in artifact for ${contractName}`);
  }

  return artifact.abi;
}

function extractErrors(abi) {
  return abi
    .filter(item => item.type === "error")
    .map(error => ({
      name: error.name,
      signature: `${error.name}(${error.inputs?.map(i => i.type).join(",") || ""})`,
      inputs: error.inputs || []
    }));
}

function main() {
  console.log("Updating frontend ABIs...");
  console.log(`Artifacts source: ${ARTIFACTS_DIR}`);
  console.log(`Frontend destination: ${FRONTEND_ABIS_DIR}\n`);

  // Ensure frontend ABIs directory exists
  if (!fs.existsSync(FRONTEND_ABIS_DIR)) {
    fs.mkdirSync(FRONTEND_ABIS_DIR, { recursive: true });
  }

  const errorMappings = {};

  for (const contract of CONTRACTS) {
    console.log(`Processing ${contract.name}...`);

    try {
      const abi = extractABI(contract.name, contract.path);
      const errors = extractErrors(abi);

      // Save ABI
      const outputName = contract.outputName || contract.name;
      const abiOutputPath = path.join(FRONTEND_ABIS_DIR, `${outputName}.json`);
      fs.writeFileSync(abiOutputPath, JSON.stringify(abi, null, 2));
      console.log(`  ✓ ABI saved: ${abiOutputPath}`);
      console.log(`    - ${abi.length} entries`);

      // Collect errors
      errorMappings[contract.name] = errors;
      console.log(`    - ${errors.length} custom errors\n`);

    } catch (error) {
      console.error(`  ✗ Failed to process ${contract.name}:`, error.message);
      process.exit(1);
    }
  }

  // Save error mappings
  const errorMappingsPath = path.join(FRONTEND_ABIS_DIR, "errors.json");
  fs.writeFileSync(errorMappingsPath, JSON.stringify(errorMappings, null, 2));
  console.log(`✓ Error mappings saved: ${errorMappingsPath}`);

  console.log("\n✓ All ABIs and error mappings updated successfully!");
}

main();
