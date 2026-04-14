/**
 * CLEAN FULL V4 DEPLOYMENT - Registry + PoB_04 + JurySC_04
 *
 * Usage:
 *   POB_ITERATION=3 POB_NAME="Proof of Builders #3" POB_SYMBOL="POB3" \
 *     npx hardhat run scripts/deploy-v4.js --network hardhat
 */

import pkg from "hardhat";
const { ethers, network, upgrades } = pkg;
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const erc1967 = require(
  "@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json"
);

const RECEIPT_POLL_MS = 10_000;
const RECEIPT_TIMEOUT_MS = 1_800_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

async function waitForConfirmation(txHash, pollMs = RECEIPT_POLL_MS, timeoutMs = RECEIPT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  polling ${txHash} every ${pollMs / 1000}s...`);
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (receipt !== null) {
      process.stdout.write(` confirmed (block ${receipt.blockNumber})\n`);
      if (receipt.status === 0) throw new Error(`Transaction reverted: ${txHash}`);
      return receipt;
    }
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  throw new Error(`Timed out (${timeoutMs / 1000}s) waiting for ${txHash}`);
}

let _nonce = null;
let _gasPrice = null;

async function sendRaw(signer, txData) {
  if (network.name === "localhost" || network.name === "hardhat") {
    const tx = await signer.sendTransaction(txData);
    return await waitForConfirmation(tx.hash);
  }

  if (_nonce === null) {
    _nonce = await ethers.provider.getTransactionCount(signer.address, "latest");
  }
  if (_gasPrice === null) {
    const feeData = await ethers.provider.getFeeData();
    _gasPrice = feeData.gasPrice;
  }

  const populated = await signer.populateTransaction({
    ...txData,
    nonce: _nonce,
    type: 0,
    gasPrice: _gasPrice,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  });
  const signed = await signer.signTransaction(populated);
  const txHash = ethers.keccak256(signed);
  _nonce++;
  await ethers.provider.send("eth_sendRawTransaction", [signed]);
  return await waitForConfirmation(txHash);
}

async function deployContract(signer, factory, args = []) {
  const txData = await factory.getDeployTransaction(...args);
  return await sendRaw(signer, txData);
}

async function deployUUPSProxy(signer, implFactory, implAddress, initArgs) {
  const proxyFactory = new ethers.ContractFactory(erc1967.abi, erc1967.bytecode, signer);
  const initData = implFactory.interface.encodeFunctionData("initialize", initArgs);
  const receipt = await deployContract(signer, proxyFactory, [implAddress, initData]);
  return {
    proxyAddress: receipt.contractAddress,
    receipt,
  };
}

async function main() {
  const chainId = Number(network.config.chainId);
  const isLocal = network.name === "localhost" || network.name === "hardhat";

  let deployer;
  if (isLocal) {
    [deployer] = await ethers.getSigners();
  } else {
    if (!process.env.OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set in .env");
    deployer = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY.trim(), ethers.provider);
  }

  const existingPobAddress = process.env.POB_ADDRESS?.trim();
  const existingJuryProxy = process.env.JURY_ADDRESS?.trim();
  const existingJuryImpl = process.env.JURY_IMPL?.trim();
  const configuredRegistryProxy = process.env.POB_REGISTRY?.trim();
  const initialDonationRecipient = process.env.POB_DONATION_RECIPIENT?.trim();
  const roundId = Number(process.env.ROUND_ID || "1");
  const expectedRoundVersion = 4;
  const reuseJuryDeployBlockHint = process.env.JURY_DEPLOY_BLOCK_HINT
    ? Number(process.env.JURY_DEPLOY_BLOCK_HINT)
    : null;

  if (!process.env.POB_ITERATION || (!existingPobAddress && (!process.env.POB_NAME || !process.env.POB_SYMBOL))) {
    throw new Error(
      "Missing required env vars.\n" +
      "  Full:      POB_ITERATION=3 POB_NAME=\"...\" POB_SYMBOL=\"POB3\" npx hardhat run scripts/deploy-v4.js --network hardhat\n" +
      "  Skip PoB:  add POB_ADDRESS=0x...\n" +
      "  Skip Jury: add JURY_ADDRESS=0x..."
    );
  }

  if (!isPositiveInteger(roundId)) {
    throw new Error(`ROUND_ID must be a positive integer (received: ${process.env.ROUND_ID || "1"})`);
  }

  if (reuseJuryDeployBlockHint !== null && !isPositiveInteger(reuseJuryDeployBlockHint)) {
    throw new Error(`JURY_DEPLOY_BLOCK_HINT must be a positive integer if provided (received: ${process.env.JURY_DEPLOY_BLOCK_HINT})`);
  }

  for (const [label, address] of [
    ["POB_ADDRESS", existingPobAddress],
    ["JURY_ADDRESS", existingJuryProxy],
    ["JURY_IMPL", existingJuryImpl],
    ["POB_REGISTRY", configuredRegistryProxy],
    ["POB_DONATION_RECIPIENT", initialDonationRecipient],
  ]) {
    if (address && !ethers.isAddress(address)) {
      throw new Error(`${label} is not a valid address: ${address}`);
    }
  }

  const iteration = Number(process.env.POB_ITERATION);
  const pobName = process.env.POB_NAME;
  const pobSymbol = process.env.POB_SYMBOL;
  const juryOwner = process.env.JURY_OWNER || deployer.address;
  if (!existingPobAddress && !initialDonationRecipient) {
    throw new Error("POB_DONATION_RECIPIENT is required when deploying a new PoB_04");
  }
  const deployRegistry = process.env.DEPLOY_REGISTRY === "true";

  console.log("╔════════════════════════════════════════════╗");
  console.log("║   CLEAN V4 ITERATION DEPLOYMENT            ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  console.log("Network:    ", network.name);
  console.log("Chain ID:   ", chainId);
  console.log("Deployer:   ", deployer.address);
  console.log("Iteration:  ", iteration);
  if (!existingPobAddress) {
    console.log("NFT Name:   ", pobName);
    console.log("NFT Symbol: ", pobSymbol);
  }
  console.log("Admin:      ", juryOwner);
  console.log("Round ID:   ", roundId);
  console.log("");

  let registryProxy;
  let rendererAddress;
  let registryImpl;
  let pobAddress;
  let pobImpl;
  let juryProxy;
  let juryImpl;
  let juryProxyDeployBlockHint = reuseJuryDeployBlockHint;

  if (deployRegistry) {
    const PoBRegistry = await ethers.getContractFactory("PoBRegistry");
    const implReceipt = await deployContract(deployer, PoBRegistry);
    registryImpl = implReceipt.contractAddress;
    const registryProxyDeployment = await deployUUPSProxy(deployer, PoBRegistry, registryImpl, [deployer.address]);
    registryProxy = registryProxyDeployment.proxyAddress;
  }
  let pob;
  if (existingPobAddress) {
    pobAddress = existingPobAddress;
    pob = await ethers.getContractAt("PoB_04", pobAddress);
    pobImpl = await upgrades.erc1967.getImplementationAddress(pobAddress);
    rendererAddress = await pob.renderer();
  } else {
    const PoBRenderer_01 = await ethers.getContractFactory("PoBRenderer_01");
    const rendererReceipt = await deployContract(deployer, PoBRenderer_01);
    rendererAddress = rendererReceipt.contractAddress;

    const PoB_04 = await ethers.getContractFactory("PoB_04");
    const implReceipt = await deployContract(deployer, PoB_04);
    pobImpl = implReceipt.contractAddress;
    const pobProxyDeployment = await deployUUPSProxy(deployer, PoB_04, pobImpl, [pobName, pobSymbol, iteration, deployer.address, rendererAddress, initialDonationRecipient]);
    pobAddress = pobProxyDeployment.proxyAddress;
    pob = await ethers.getContractAt("PoB_04", pobAddress);
  }

  const JurySC_04 = await ethers.getContractFactory("JurySC_04");
  let jurySC;
  if (existingJuryProxy) {
    juryProxy = existingJuryProxy;
    jurySC = await ethers.getContractAt("JurySC_04", juryProxy);
    juryImpl = await upgrades.erc1967.getImplementationAddress(juryProxy);
  } else {
    if (existingJuryImpl) {
      juryImpl = existingJuryImpl;
    } else {
      const implReceipt = await deployContract(deployer, JurySC_04);
      juryImpl = implReceipt.contractAddress;
    }

    const juryProxyDeployment = await deployUUPSProxy(deployer, JurySC_04, juryImpl, [pobAddress, iteration, juryOwner]);
    juryProxy = juryProxyDeployment.proxyAddress;
    juryProxyDeployBlockHint = juryProxyDeployment.receipt?.blockNumber ?? null;
    jurySC = await ethers.getContractAt("JurySC_04", juryProxy);
  }

  const currentOwner = await pob.owner();
  if (currentOwner.toLowerCase() !== juryProxy.toLowerCase()) {
    const txData = await pob.transferOwnership.populateTransaction(juryProxy);
    await sendRaw(deployer, txData);
  }

  const registryForChecks = registryProxy || configuredRegistryProxy || null;
  let registryChecks = null;
  const wiringPayload = {
    chainId,
    iterationId: iteration,
    roundId,
    jurySC: juryProxy,
    pob: pobAddress,
    deployBlockHint: juryProxyDeployBlockHint ?? 0,
    expectedRoundVersion,
  };

  if (registryForChecks) {
    const registry = await ethers.getContractAt("PoBRegistry", registryForChecks);
    let iterationExists = false;
    let roundExists = false;
    let registeredRoundJury = null;
    let registeredRoundBlockHint = null;
    let roundVersion = 0;
    let adapterConfig = null;
    let adapterConfigError = null;

    try {
      const iterInfo = await registry.iterations(iteration);
      iterationExists = Boolean(iterInfo?.exists);
    } catch {}

    try {
      const roundInfo = await registry.rounds(iteration, roundId);
      roundExists = Boolean(roundInfo?.exists);
      if (roundExists) {
        registeredRoundJury = roundInfo?.jurySC || null;
        registeredRoundBlockHint = Number(roundInfo?.deployBlockHint ?? 0);
      }
    } catch {}

    try {
      roundVersion = Number(await registry.roundVersion(iteration, roundId));
    } catch {}

    try {
      const [resolvedJury, adapterAddress] = await registry.getAdapterConfig(iteration, roundId);
      adapterConfig = { jurySC: resolvedJury, adapter: adapterAddress };
    } catch (error) {
      adapterConfigError = error?.message || String(error);
    }

    registryChecks = {
      registryProxy: registryForChecks,
      iterationExists,
      roundExists,
      registeredRoundJury,
      registeredRoundBlockHint,
      roundVersion,
      adapterConfig,
      adapterConfigError,
    };
  }

  console.log("╔════════════════════════════════════════════╗");
  console.log("║        V4 DEPLOYMENT COMPLETE ✓           ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");
  if (deployRegistry) {
    console.log("PoBRegistry impl: ", registryImpl);
    console.log("PoBRegistry proxy:", registryProxy);
  }
  console.log("PoBRenderer_01:  ", rendererAddress);
  console.log("Donation treasury:", existingPobAddress ? await pob.communityDonationRecipient() : initialDonationRecipient);
  console.log("PoB_04 impl:     ", pobImpl);
  console.log("PoB_04 proxy:    ", pobAddress);
  console.log("JurySC_04 impl:   ", juryImpl);
  console.log("JurySC_04 proxy:  ", juryProxy);
  console.log("Admin:            ", juryOwner);
  console.log("");

  const deploymentInfo = {
    network: network.name,
    chainId,
    iteration,
    roundId,
    timestamp: new Date().toISOString(),
    contracts: {
      PoBRenderer_01: rendererAddress,
      communityDonationRecipient: existingPobAddress ? await pob.communityDonationRecipient() : initialDonationRecipient,
      PoB_04: {
        proxy: pobAddress,
        implementation: pobImpl,
      },
      JurySC_04: {
        proxy: juryProxy,
        implementation: juryImpl,
      },
    },
    wiringPayload,
    registryChecks,
    owner: juryOwner,
    deployer: deployer.address,
  };

  if (deployRegistry) {
    deploymentInfo.contracts.PoBRegistry = {
      proxy: registryProxy,
      implementation: registryImpl,
    };
  }

  const filename = `deployment-v4-iteration-${iteration}-round-${roundId}-${network.name}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("Saved to:", filename);
  console.log("");

  if (network.name === "localhost" || network.name === "hardhat") {
    const iterationsLocalPath = "../frontend/public/iterations.local.json";
    const iterationsLocal = [{
      iteration,
      name: `PoB Iteration #${iteration}`,
      jurySC: juryProxy,
      pob: pobAddress,
      chainId,
      round: roundId,
      deployBlockHint: juryProxyDeployBlockHint || 1,
      link: "https://example.com/iteration",
    }];
    fs.writeFileSync(iterationsLocalPath, JSON.stringify(iterationsLocal, null, 2));
    console.log("Updated:", iterationsLocalPath);
  }

  console.log("NEXT STEPS:");
  console.log(`  1. Wire registry round version: setRoundVersion(${iteration}, ${roundId}, 4)`);
  console.log(`  2. Run imported-history flow with scripts/import-v4-round.js if this is a migrated round`);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
