import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import fs from "fs";
import path from "path";
import pkg from "hardhat";
import { create } from "ipfs-http-client";
const { ethers, network, upgrades } = pkg;

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

const DEFAULT_IPFS_ENDPOINT = "http://localhost:5001";

function canonicalJSON(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJSON).join(",") + "]";
  }

  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => `"${key}":${canonicalJSON(obj[key])}`);
  return "{" + pairs.join(",") + "}";
}

async function uploadToIPFS(ipfsClient, data, name) {
  const content = canonicalJSON(data);
  const result = await ipfsClient.add(content, {
    pin: true,
    cidVersion: 1,
    wrapWithDirectory: false,
  });
  console.log(`   📦 IPFS: ${result.cid.toString()} (${name})`);
  return result.cid.toString();
}

/**
 * Find the latest deployment file for localhost
 */
function getLatestLocalDeployment() {
  const contractsDir = process.cwd();
  const files = fs.readdirSync(contractsDir)
    .filter(f => f.startsWith('deployment-iteration-') && f.includes('localhost') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  const latestFile = path.join(contractsDir, files[0]);
  return JSON.parse(fs.readFileSync(latestFile, 'utf8'));
}

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

function resolveRegistryAddress(deployment) {
  const manualRegistry = process.env.POB_REGISTRY;
  if (manualRegistry) {
    return ethers.getAddress(manualRegistry);
  }

  if (deployment?.contracts?.PoBRegistry?.proxy) {
    return ethers.getAddress(deployment.contracts.PoBRegistry.proxy);
  }

  if (deployment?.contracts?.PoBRegistry) {
    return ethers.getAddress(deployment.contracts.PoBRegistry);
  }

  return null;
}

function resolveIpfsEndpoint(chainId) {
  if (Number(chainId) === 31337) {
    return (
      process.env.LOCAL_IPFS_API_URL ||
      process.env.IPFS_API_URL ||
      DEFAULT_IPFS_ENDPOINT
    );
  }

  return (
    process.env.TESTNET_IPFS_API_URL ||
    process.env.MAINNET_IPFS_API_URL ||
    process.env.IPFS_API_URL
  );
}

function createIpfsClient(ipfsEndpoint) {
  const ipfsUrl = new URL(ipfsEndpoint);
  return create({
    host: ipfsUrl.hostname,
    port: parseInt(
      ipfsUrl.port || (ipfsUrl.protocol === "https:" ? "443" : "5001"),
      10
    ),
    protocol: ipfsUrl.protocol.replace(":", ""),
  });
}

function loadIterationManifestEntry(iteration, juryAddress) {
  const manifestName =
    manifestByNetwork[network.name] ?? "iterations.local.json";
  const manifestPath = path.join(
    process.cwd(),
    "../frontend/public",
    manifestName
  );

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const content = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!Array.isArray(content)) {
    return null;
  }

  const juryLower = juryAddress?.toLowerCase();
  return (
    content.find((entry) => entry.iteration === iteration) ||
    content.find((entry) => entry.jurySC?.toLowerCase() === juryLower) ||
    null
  );
}

function loadProjectsFile(chainId) {
  const candidates = [
    process.env.POB_PROJECTS_FILE,
    path.join(process.cwd(), "../frontend/public/projects.local.json"),
    path.join(process.cwd(), "../frontend/public/projects-i1-r1.json"),
    path.join(process.cwd(), "../frontend/public/projects.json"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const content = JSON.parse(fs.readFileSync(candidate, "utf-8"));
    const entries = Array.isArray(content) ? content : content?.projects;

    if (!Array.isArray(entries)) {
      continue;
    }

    const filtered = entries.filter((entry) => {
      if (entry?.chainId === undefined) {
        return true;
      }
      return Number(entry.chainId) === Number(chainId);
    });

    return { entries: filtered, source: candidate };
  }

  return { entries: [], source: null };
}

function resolveProjects(chainId, fallbackAddresses) {
  const { entries: projectEntries, source: projectsSource } =
    loadProjectsFile(chainId);
  const projectMap = new Map();

  for (const entry of projectEntries) {
    const account = entry?.account ?? entry?.address;
    if (!account) {
      continue;
    }

    try {
      projectMap.set(ethers.getAddress(account), entry);
    } catch {
      console.warn(`[warn] Ignoring invalid project address: ${account}`);
    }
  }

  let resolvedAddresses = parseAddressList(process.env.POB_PROJECTS ?? "", []);
  if (resolvedAddresses.length === 0 && projectMap.size > 0) {
    resolvedAddresses = Array.from(projectMap.keys());
  }
  if (resolvedAddresses.length === 0) {
    resolvedAddresses = fallbackAddresses;
  }

  const metadata = resolvedAddresses.map((address, index) => {
    const entry = projectMap.get(address);
    return {
      account: address,
      name: entry?.name || `Local Project #${index + 1}`,
      yt_vid: entry?.yt_vid || "",
      proposal: entry?.proposal || "",
    };
  });

  return { addresses: resolvedAddresses, metadata, source: projectsSource };
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

async function ensureSmtVoters(jurySC, voters) {
  for (const voter of voters) {
    const already = await jurySC.isSmtVoter(voter).catch(() => false);
    if (already) {
      console.log(`- SMT voter already registered: ${voter}`);
      continue;
    }
    const tx = await jurySC.addSmtVoter(voter);
    await tx.wait();
    console.log(`- SMT voter added: ${voter}`);
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

  return null;
}

function resolveIterationAddressesFromDeployment(deployment) {
  if (deployment) {
    const jurySCAddress =
      deployment.contracts.JurySC_03?.proxy || deployment.contracts.JurySC_03 ||
      deployment.contracts.JurySC_02?.proxy || deployment.contracts.JurySC_02;
    const pobAddress = deployment.contracts.PoB_03 || deployment.contracts.PoB_02;
    console.log("Using addresses from deployment file");
    return {
      juryAddress: ethers.getAddress(jurySCAddress),
      pobAddress: ethers.getAddress(pobAddress),
    };
  }

  // Fallback to manifest file
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
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = network.name === "hardhat" || network.name === "localhost";
  const deployment = isLocal ? getLatestLocalDeployment() : null;

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

  const { addresses: projectAddresses, metadata: projectMetadata, source: projectsSource } =
    resolveProjects(chainId, DEFAULT_PROJECTS);
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

  let addresses = resolveIterationAddresses();
  if (!addresses) {
    addresses = resolveIterationAddressesFromDeployment(deployment);
  }
  if (!addresses) {
    throw new Error("Unable to determine JurySC/PoB addresses.");
  }

  const { juryAddress, pobAddress } = addresses;
  const iteration = Number(
    process.env.POB_ITERATION ?? process.env.ITERATION ?? deployment?.iteration ?? 1
  );
  const registryAddress = resolveRegistryAddress(deployment);
  const manifestEntry = loadIterationManifestEntry(iteration, juryAddress);
  const roundId = Number(manifestEntry?.round ?? 1);

  console.log("Seeding iteration using:");
  console.log("- JurySC_03:", juryAddress);
  console.log("- PoB_03:", pobAddress);
  console.log("- Network:", network.name);
  console.log("- Chain ID:", chainId);
  console.log("- Iteration:", iteration);
  if (registryAddress) {
    console.log("- PoBRegistry:", registryAddress);
  }
  if (projectsSource) {
    console.log("- Projects source:", projectsSource);
  }
  console.log("- Deployer:", deployer.address);

  const jurySC = await ethers.getContractAt("JurySC_03", juryAddress);

  const smtVoters = devRelAccount ? [devRelAccount] : [];
  await ensureSmtVoters(jurySC, smtVoters);
  await ensureDaoHicVoters(jurySC, daoHicVoters);
  await ensureProjects(jurySC, projectAddresses);

  const SKIP_IPFS = process.env.SKIP_IPFS === "true";
  if (!registryAddress) {
    console.warn("[warn] PoBRegistry address not available; skipping registry seeding.");
  } else {
    const registry = await ethers.getContractAt("PoBRegistry", registryAddress);

    const existingIteration = await registry
      .iterations(iteration)
      .catch(() => ({ exists: false }));
    if (!existingIteration.exists) {
      console.log(`Registering iteration ${iteration} in registry...`);
      const registerIterTx = await registry.registerIteration(iteration, chainId);
      await registerIterTx.wait();
      console.log(`- Iteration ${iteration} registered`);
    } else {
      console.log(`- Iteration ${iteration} already registered`);
    }

    const existingRound = await registry
      .rounds(iteration, roundId)
      .catch(() => ({ exists: false }));
    if (!existingRound.exists) {
      const deployBlockHint =
        Number(manifestEntry?.deployBlockHint ?? 0) ||
        (await ethers.provider.getBlockNumber());
      console.log(`Registering round ${roundId} in registry...`);
      const registerRoundTx = await registry.addRound(
        iteration,
        roundId,
        juryAddress,
        deployBlockHint
      );
      await registerRoundTx.wait();
      console.log(`- Round ${roundId} registered`);
    } else {
      console.log(`- Round ${roundId} already registered`);
    }

    // Deploy and wire version adapters
    console.log("\nDeploying version adapters...");

    const V1Adapter = await ethers.getContractFactory("V1Adapter");
    const v1Adapter = await V1Adapter.deploy(registryAddress);
    await v1Adapter.waitForDeployment();
    const v1Address = await v1Adapter.getAddress();
    console.log(`- V1Adapter deployed at: ${v1Address}`);

    const V2Adapter = await ethers.getContractFactory("V2Adapter");
    const v2Adapter = await V2Adapter.deploy();
    await v2Adapter.waitForDeployment();
    const v2Address = await v2Adapter.getAddress();
    console.log(`- V2Adapter deployed at: ${v2Address}`);

    const txA1 = await registry.setAdapter(1, v1Address);
    await txA1.wait();
    console.log(`- setAdapter(1, ${v1Address})`);

    const txA2 = await registry.setAdapter(2, v2Address);
    await txA2.wait();
    console.log(`- setAdapter(2, ${v2Address})`);

    // Local dev uses _02 contracts → version 2
    const txRV = await registry.setRoundVersion(iteration, roundId, 2);
    await txRV.wait();
    console.log(`- setRoundVersion(${iteration}, ${roundId}, 2)`);

    if (SKIP_IPFS) {
      console.log("Skipping IPFS metadata seeding (SKIP_IPFS=true).");
    } else {
      const ipfsEndpoint = resolveIpfsEndpoint(chainId);
      if (!ipfsEndpoint) {
        throw new Error(
          "No IPFS endpoint configured. Set IPFS_API_URL or LOCAL_IPFS_API_URL."
        );
      }

      console.log("Seeding metadata via IPFS:", ipfsEndpoint);
      const ipfsClient = createIpfsClient(ipfsEndpoint);

      const existingIterationCid = await registry
        .iterationMetadata(chainId, juryAddress)
        .catch(() => "");

      if (existingIterationCid) {
        console.log("- Iteration metadata already set");
      } else {
        const iterationMetadata = {
          iteration,
          round: roundId,
          name: manifestEntry?.name || `PoB Iteration #${iteration}`,
          chainId,
          votingMode: manifestEntry?.votingMode ?? 0,
          link: manifestEntry?.link || "",
          prev_rounds: manifestEntry?.prev_rounds || [],
        };

        const iterCid = await uploadToIPFS(
          ipfsClient,
          iterationMetadata,
          `Iteration ${iteration}`
        );
        const iterTx = await registry.setIterationMetadata(
          chainId,
          juryAddress,
          iterCid
        );
        await iterTx.wait();
        console.log(`- Iteration metadata set (${iterCid})`);
      }

      if (projectMetadata.length === 0) {
        console.log("- No projects found for metadata upload");
      } else {
        console.log(`Seeding metadata for ${projectMetadata.length} project(s)...`);
        for (const project of projectMetadata) {
          const existingProjectCid = await registry
            .projectMetadata(chainId, juryAddress, project.account)
            .catch(() => "");
          if (existingProjectCid) {
            console.log(`- Project metadata already set: ${project.account}`);
            continue;
          }

          const projectCid = await uploadToIPFS(
            ipfsClient,
            project,
            project.name
          );
          const projectTx = await registry.setProjectMetadata(
            chainId,
            juryAddress,
            project.account,
            projectCid
          );
          await projectTx.wait();
          console.log(`- Project metadata set: ${project.account}`);
        }
      }
    }
  }

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

  // ── Iteration 1: activate → vote → close → lock ─────────────────────────
  if (isLocal && projectAddresses.length >= 1) {
    console.log("\n=== Completing Iteration 1 (activate → vote → close → lock) ===");

    const allSigners = await ethers.getSigners();
    const devRelSigner   = allSigners[5];
    const daoHic1Signer  = allSigners[3];
    const daoHic2Signer  = allSigners[4];
    const comm1Signer    = allSigners[6];
    const comm2Signer    = allSigners[7];
    const project1       = projectAddresses[0];

    // Connect pob contract
    const pob = await ethers.getContractAt("PoB_03", pobAddress);

    // Activate (sets projectsLocked = true, opens 48h window)
    const txActivate = await jurySC.activate();
    await txActivate.wait();
    console.log("- Iteration 1 activated");

    // Community mints (during active voting; returns deposit on re-mint so safe)
    const mintVal = ethers.parseEther("30");
    const txMint1 = await pob.connect(comm1Signer).mint({ value: mintVal });
    await txMint1.wait();
    console.log("- Community 1 minted token 0");
    const txMint2 = await pob.connect(comm2Signer).mint({ value: mintVal });
    await txMint2.wait();
    console.log("- Community 2 minted token 1");

    // Votes — all for project 1 (consensus winner)
    await (await jurySC.connect(devRelSigner).voteSmt(project1)).wait();
    console.log("- SMT voted for project 1");
    await (await jurySC.connect(daoHic1Signer).voteDaoHic(project1)).wait();
    console.log("- DAO_HIC 1 voted for project 1");
    await (await jurySC.connect(daoHic2Signer).voteDaoHic(project1)).wait();
    console.log("- DAO_HIC 2 voted for project 1");
    await (await jurySC.connect(comm1Signer).voteCommunity(0, project1)).wait();
    console.log("- Community 1 voted (token 0) for project 1");
    await (await jurySC.connect(comm2Signer).voteCommunity(1, project1)).wait();
    console.log("- Community 2 voted (token 1) for project 1");

    // Close + lock
    await (await jurySC.closeManually()).wait();
    console.log("- Voting closed manually");
    await (await jurySC.lockContractForHistory()).wait();
    console.log("- Contract locked for history");

    // ── Deploy iteration 2 (uninitialized) ──────────────────────────────────
    console.log("\n=== Deploying Iteration 2 (uninitialized) ===");

    const iter2 = 2;
    const PoB_02_Factory   = await ethers.getContractFactory("PoB_02");
    const pob2 = await PoB_02_Factory.deploy(
      "PoB Iteration #2", "POB2", iter2, deployer.address
    );
    await pob2.waitForDeployment();
    const pob2Address = await pob2.getAddress();
    console.log("- PoB_02 (iter 2):", pob2Address);

    const JurySC_02_Factory = await ethers.getContractFactory("JurySC_02");
    const jury2 = await upgrades.deployProxy(
      JurySC_02_Factory,
      [pob2Address, iter2, deployer.address],
      { kind: "uups", initializer: "initialize" }
    );
    await jury2.waitForDeployment();
    const jury2Address = await jury2.getAddress();
    console.log("- JurySC_02 (iter 2):", jury2Address);

    await (await pob2.transferOwnership(jury2Address)).wait();
    console.log("- PoB_02 ownership transferred to JurySC_02");

    // ── Register iteration 2 in PoBRegistry ──────────────────────────────────
    if (registryAddress) {
      const registry2 = await ethers.getContractAt("PoBRegistry", registryAddress);
      const iter2Block = await ethers.provider.getBlockNumber();

      const existingIter2 = await registry2.iterations(iter2).catch(() => ({ exists: false }));
      if (!existingIter2.exists) {
        await (await registry2.registerIteration(iter2, chainId)).wait();
        console.log(`- Iteration ${iter2} registered in PoBRegistry`);
      } else {
        console.log(`- Iteration ${iter2} already registered`);
      }

      const existingRound2 = await registry2.rounds(iter2, 1).catch(() => ({ exists: false }));
      if (!existingRound2.exists) {
        await (await registry2.addRound(iter2, 1, jury2Address, iter2Block)).wait();
        console.log(`- Round 1 registered for iteration ${iter2}`);
      } else {
        console.log(`- Round 1 for iteration ${iter2} already registered`);
      }

      await (await registry2.setRoundVersion(iter2, 1, 2)).wait();
      console.log(`- setRoundVersion(${iter2}, 1, 2)`);
    }

    // ── Update iterations.local.json ─────────────────────────────────────────
    const iterationsLocalPath = path.join(
      process.cwd(), "../frontend/public/iterations.local.json"
    );
    const iterationsLocal = JSON.parse(fs.readFileSync(iterationsLocalPath, "utf8"));
    const iter2Block = await ethers.provider.getBlockNumber();
    iterationsLocal.push({
      iteration: iter2,
      name: "PoB Iteration #2",
      jurySC: jury2Address,
      pob: pob2Address,
      chainId,
      deployBlockHint: iter2Block,
      link: "https://example.com/iteration",
    });
    fs.writeFileSync(iterationsLocalPath, JSON.stringify(iterationsLocal, null, 2));
    console.log("- iterations.local.json updated with iteration 2");

    // ── Deploy iteration 3 (V3 contracts, round WITHOUT setRoundVersion) ─────
    console.log("\n=== Deploying Iteration 3 (V3, round without setRoundVersion) ===");

    const iter3 = 3;
    const PoB_03_Factory   = await ethers.getContractFactory("PoB_03");
    const pob3 = await PoB_03_Factory.deploy(
      "PoB Iteration #3", "POB3", iter3, deployer.address
    );
    await pob3.waitForDeployment();
    const pob3Address = await pob3.getAddress();
    console.log("- PoB_03 (iter 3):", pob3Address);

    const JurySC_03_Factory = await ethers.getContractFactory("JurySC_03");
    const jury3 = await upgrades.deployProxy(
      JurySC_03_Factory,
      [pob3Address, iter3, deployer.address],
      { kind: "uups", initializer: "initialize" }
    );
    await jury3.waitForDeployment();
    const jury3Address = await jury3.getAddress();
    console.log("- JurySC_03 (iter 3):", jury3Address);

    await (await pob3.transferOwnership(jury3Address)).wait();
    console.log("- PoB_03 ownership transferred to JurySC_03");

    if (registryAddress) {
      const registry3 = await ethers.getContractAt("PoBRegistry", registryAddress);

      // Deploy V3Adapter and wire it
      const V3Adapter = await ethers.getContractFactory("V3Adapter");
      const v3Adapter = await V3Adapter.deploy();
      await v3Adapter.waitForDeployment();
      const v3AdapterAddress = await v3Adapter.getAddress();
      console.log("- V3Adapter deployed:", v3AdapterAddress);
      await (await registry3.setAdapter(3, v3AdapterAddress)).wait();
      console.log("- setAdapter(3, V3Adapter)");

      const iter3Block = await ethers.provider.getBlockNumber();

      const existingIter3 = await registry3.iterations(iter3).catch(() => ({ exists: false }));
      if (!existingIter3.exists) {
        await (await registry3.registerIteration(iter3, chainId)).wait();
        console.log(`- Iteration ${iter3} registered in PoBRegistry`);
      } else {
        console.log(`- Iteration ${iter3} already registered`);
      }

      const existingRound3 = await registry3.rounds(iter3, 1).catch(() => ({ exists: false }));
      if (!existingRound3.exists) {
        await (await registry3.addRound(iter3, 1, jury3Address, iter3Block)).wait();
        console.log(`- Round 1 registered for iteration ${iter3}`);
      } else {
        console.log(`- Round 1 for iteration ${iter3} already registered`);
      }

      // Intentionally skip setRoundVersion(3, 1, 3) — simulates pending state
      console.log("- setRoundVersion(3, 1, 3) intentionally skipped");
    }

    // Update iterations.local.json with iteration 3
    const iterationsLocal3 = JSON.parse(fs.readFileSync(iterationsLocalPath, "utf8"));
    const iter3Block = await ethers.provider.getBlockNumber();
    iterationsLocal3.push({
      iteration: iter3,
      name: "PoB Iteration #3",
      jurySC: jury3Address,
      pob: pob3Address,
      chainId,
      deployBlockHint: iter3Block,
      link: "https://example.com/iteration",
    });
    fs.writeFileSync(iterationsLocalPath, JSON.stringify(iterationsLocal3, null, 2));
    console.log("- iterations.local.json updated with iteration 3");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
