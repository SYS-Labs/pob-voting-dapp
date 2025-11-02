import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import fs from "fs";
import path from "path";
import pkg from "hardhat";
const { ethers, network } = pkg;

const ACCOUNT_FUNDING = ethers.parseEther("50"); // 50 ETH per account (30 for community mint + 20 for gas)

// Load mnemonic from .env (same as hardhat.config.js)
const HARDHAT_MNEMONIC =
  process.env.HARDHAT_MNEMONIC ||
  "test test test test test test test test test test test junk";

// Derive accounts from mnemonic (matches Hardhat's account derivation)
function deriveAccountsFromMnemonic(mnemonic, count = 10) {
  const accounts = [];
  for (let i = 0; i < count; i++) {
    const wallet = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(mnemonic),
      `m/44'/60'/0'/0/${i}`
    );
    accounts.push(wallet.address);
  }
  return accounts;
}

const mnemonicAccounts = deriveAccountsFromMnemonic(HARDHAT_MNEMONIC, 10);

// Default assignments using mnemonic-derived accounts
// Account indices based on typical Hardhat usage:
// [0] = deployer (owner)
// [1-2] = projects
// [3-4] = DAO_HIC voters
// [5] = DevRel
// [6-7] = Community wallets
const DEFAULT_PROJECTS = [mnemonicAccounts[1], mnemonicAccounts[2]];
const DEFAULT_DAO_HIC_VOTERS = [mnemonicAccounts[3], mnemonicAccounts[4]];
const DEFAULT_DEVREL = mnemonicAccounts[5];
const DEFAULT_COMMUNITY = [mnemonicAccounts[6], mnemonicAccounts[7]];

const manifestByNetwork = {
  hardhat: "iterations.local.json",
  localhost: "iterations.local.json",
};

function parseAddressList(raw, fallback) {
  const source =
    raw && raw.trim().length > 0 ? raw.split(",") : fallback;

  if (!source || source.length === 0) {
    return [];
  }

  const results = [];
  for (const entry of source) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      results.push(ethers.getAddress(trimmed));
    } catch {
      console.warn(`[warn] Ignoring invalid address: ${trimmed}`);
    }
  }
  return results;
}

async function ensureDevRel(jurySC, devRelAccount) {
  if (!devRelAccount) return;

  const current = await jurySC.devRelAccount().catch(() => ethers.ZeroAddress);
  if (current.toLowerCase() === devRelAccount.toLowerCase()) {
    console.log(`- DevRel already configured: ${devRelAccount}`);
    return;
  }

  const tx = await jurySC.setDevRelAccount(devRelAccount);
  await tx.wait();
  console.log(`- DevRel account set to ${devRelAccount}`);
}

async function ensureDaoHicVoters(jurySC, voters) {
  for (const voter of voters) {
    const already = await jurySC.isDaoHicVoter(voter).catch(() => false);
    if (already) {
      console.log(`- DAO_HIC voter already registered: ${voter}`);
      continue;
    }
    const tx = await jurySC.addDaoHicVoter(voter);
    await tx.wait();
    console.log(`- DAO_HIC voter added: ${voter}`);
  }
}

async function ensureProjects(jurySC, projects) {
  const locked = await jurySC.projectsLocked().catch(() => false);
  if (locked && projects.length > 0) {
    console.warn(
      "[warn] Projects are locked; skipping project registration."
    );
    return;
  }

  for (const project of projects) {
    const already = await jurySC.isRegisteredProject(project).catch(() => false);
    if (already) {
      console.log(`- Project already registered: ${project}`);
      continue;
    }
    const tx = await jurySC.registerProject(project);
    await tx.wait();
    console.log(`- Project registered: ${project}`);
  }
}

async function fundAccounts(deployer, addresses, targetBalance) {
  const seen = new Set();

  for (const addr of addresses) {
    const checksum = ethers.getAddress(addr);
    if (checksum === ethers.ZeroAddress) continue;
    if (seen.has(checksum)) continue;
    seen.add(checksum);

    const currentBalance = await ethers.provider.getBalance(checksum);
    if (currentBalance >= targetBalance) {
      console.log(
        `- ${checksum} already funded (${ethers.formatEther(currentBalance)} ETH)`
      );
      continue;
    }

    const delta = targetBalance - currentBalance;
    console.log(
      `- Funding ${checksum} with ${ethers.formatEther(delta)} ETH (target ${ethers.formatEther(targetBalance)} ETH)`
    );
    const tx = await deployer.sendTransaction({ to: checksum, value: delta });
    await tx.wait();
  }
}

function resolveIterationAddresses() {
  const manualJury = process.env.JURY_ADDRESS;
  const manualPob = process.env.POB_ADDRESS;

  if (manualJury && manualPob) {
    return {
      juryAddress: ethers.getAddress(manualJury),
      pobAddress: ethers.getAddress(manualPob),
    };
  }

  const manifestName =
    manifestByNetwork[network.name] ?? "iterations.local.json";
  const manifestPath = path.join(
    process.cwd(),
    "../frontend/public",
    manifestName
  );

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Unable to locate iteration manifest at ${manifestPath}. Set JURY_ADDRESS and POB_ADDRESS env vars instead.`
    );
  }

  const content = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`Manifest ${manifestPath} is empty; cannot determine addresses.`);
  }

  const entry = content[0];
  if (!entry?.jurySC || !entry?.pob) {
    throw new Error(`Manifest ${manifestPath} is missing jurySC/pob fields.`);
  }

  return {
    juryAddress: ethers.getAddress(entry.jurySC),
    pobAddress: ethers.getAddress(entry.pob),
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();

  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.warn(
      `[warn] Running on network "${network.name}". This script is intended for local testing environments.`
    );
  }

  console.log("\n=== Mnemonic-Derived Accounts ===");
  console.log(`Using mnemonic: ${HARDHAT_MNEMONIC.substring(0, 30)}...`);
  console.log("Derived accounts:");
  mnemonicAccounts.forEach((addr, i) => {
    console.log(`  [${i}] ${addr}`);
  });

  const projectAddresses = parseAddressList(
    process.env.POB_PROJECTS ?? "",
    DEFAULT_PROJECTS
  );
  const daoHicVoters = parseAddressList(
    process.env.POB_DAO_HIC_VOTERS ?? "",
    DEFAULT_DAO_HIC_VOTERS
  );
  const communityAccounts = parseAddressList(
    process.env.POB_COMMUNITY_ACCOUNTS ?? "",
    DEFAULT_COMMUNITY
  );

  const devRelAccountRaw =
    process.env.POB_DEVREL_ACCOUNT?.trim() ?? DEFAULT_DEVREL;
  const devRelAccount = devRelAccountRaw
    ? ethers.getAddress(devRelAccountRaw)
    : null;

  const { juryAddress, pobAddress } = resolveIterationAddresses();
  console.log("Seeding iteration using:");
  console.log("- JurySC_01:", juryAddress);
  console.log("- PoB_01:", pobAddress);
  console.log("- Network:", network.name);
  console.log("- Deployer:", deployer.address);

  const jurySC = await ethers.getContractAt("JurySC_01", juryAddress);

  await ensureDevRel(jurySC, devRelAccount);
  await ensureDaoHicVoters(jurySC, daoHicVoters);
  await ensureProjects(jurySC, projectAddresses);

  const stipendAccounts = [
    ...projectAddresses,
    ...daoHicVoters,
    ...(devRelAccount ? [devRelAccount] : []),
    ...communityAccounts,
  ];

  if (stipendAccounts.length > 0) {
    console.log("\nFunding ecosystem accounts...");
    await fundAccounts(deployer, stipendAccounts, ACCOUNT_FUNDING);
  }

  console.log("\n=== Seed Summary ===");
  if (devRelAccount) {
    console.log("- DevRel account:", devRelAccount);
  }
  if (projectAddresses.length) {
    console.log("- Projects:", projectAddresses.join(", "));
  }
  if (daoHicVoters.length) {
    console.log("- DAO_HIC voters:", daoHicVoters.join(", "));
  }
  if (communityAccounts.length) {
    console.log("- Community wallets:", communityAccounts.join(", "));
  }

  console.log("\n=== Final Account Balances ===");
  for (const addr of stipendAccounts) {
    const balance = await ethers.provider.getBalance(addr);
    console.log(`${addr}: ${ethers.formatEther(balance)} ETH`);
  }

  console.log("\n✅ Seed complete! All accounts should have 50 ETH.");
  console.log("💡 If MetaMask shows insufficient funds:");
  console.log("   1. Verify you're using one of the addresses listed above");
  console.log("   2. Check you're connected to the correct network (Hardhat Local)");
  console.log("   3. Community mint requires 30 ETH deposit + gas fees");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
