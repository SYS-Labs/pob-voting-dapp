/**
 * Deploy PoBRegistry contract
 *
 * Usage:
 *   npx hardhat run scripts/deploy-pob-registry.js --network localhost
 *   npx hardhat run scripts/deploy-pob-registry.js --network testnet
 *   npx hardhat run scripts/deploy-pob-registry.js --network mainnet
 */

import pkg from 'hardhat';
const { ethers, upgrades } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log('='.repeat(60));
  console.log('Deploying PoBRegistry');
  console.log('='.repeat(60));
  console.log('Network:', network.name);
  console.log('Chain ID:', chainId);
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'SYS');
  console.log('');

  // Deploy PoBRegistry proxy
  console.log('Deploying PoBRegistry proxy...');
  const PoBRegistry = await ethers.getContractFactory('PoBRegistry');

  const registry = await upgrades.deployProxy(
    PoBRegistry,
    [deployer.address], // initialOwner
    {
      initializer: 'initialize',
      kind: 'uups'
    }
  );

  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  console.log('✓ PoBRegistry proxy deployed to:', registryAddress);
  console.log('✓ Owner:', await registry.owner());
  console.log('');

  // Get implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(registryAddress);
  console.log('Implementation address:', implementationAddress);
  console.log('');

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      PoBRegistry: {
        proxy: registryAddress,
        implementation: implementationAddress
      }
    }
  };

  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `pob-registry-${network.name}-${Date.now()}.json`;
  const filepath = path.join(deploymentsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));

  console.log('Deployment info saved to:', filepath);
  console.log('');

  // Print summary
  console.log('='.repeat(60));
  console.log('DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  console.log('PoBRegistry Proxy:', registryAddress);
  console.log('Implementation:', implementationAddress);
  console.log('Owner:', deployer.address);
  console.log('');
  console.log('Next steps:');
  console.log('1. Verify contracts on block explorer');
  console.log('2. Update frontend/API with registry address');
  console.log('3. Migrate existing metadata to IPFS');
  console.log('4. Populate registry with CIDs');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
