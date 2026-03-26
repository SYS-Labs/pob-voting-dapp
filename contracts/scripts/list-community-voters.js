import pkg from "hardhat";

const { ethers } = pkg;

/**
 * Lists unique community voter addresses for an iteration/round, ordered by
 * the first community vote transaction seen on-chain (oldest first).
 *
 * Usage:
 *   CHAIN_ID=5700 ITERATION=1 node scripts/list-community-voters.js
 *   CHAIN_ID=5700 ITERATION=1 ROUND=2 node scripts/list-community-voters.js
 *   CHAIN_ID=5700 ITERATION=1 ROUND=2 PICK_RANDOM=1 node scripts/list-community-voters.js
 */

const CHAIN_ID = Number(process.env.CHAIN_ID || 5700);
const ITERATION_NUMBER = Number(process.env.ITERATION || 1);
const ROUND_NUMBER = process.env.ROUND ? Number(process.env.ROUND) : undefined;
const PICK_RANDOM = process.env.PICK_RANDOM === "1" || process.env.PICK_RANDOM === "true";

const REGISTRY_ADDRESSES = {
  57: "", // Mainnet - TODO: deploy
  5700: "0xA985cE400afea8eEf107c24d879c8c777ece1a8a",
  31337: "0xab180957A96821e90C0114292DDAfa9E9B050d65",
};

const REGISTRY_ABI = [
  "function getRounds(uint256 iterationId) external view returns (tuple(uint256 iterationId, uint256 roundId, address jurySC, uint256 deployBlockHint, bool exists)[])",
  "function roundVersion(uint256 iterationId, uint256 roundId) external view returns (uint32)",
];

const JURY_ABI = [
  "event VotedCommunity(uint256 indexed tokenId, address indexed voter, uint256 indexed projectId)",
];

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function isSameAddress(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function getRpcUrl(chainId) {
  if (chainId === 5700) return "https://rpc.tanenbaum.io";
  if (chainId === 57) return "https://rpc.syscoin.org";
  if (chainId === 31337) return "http://127.0.0.1:8547";
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

function ensurePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

async function selectRound(registry) {
  const rounds = await registry.getRounds(ITERATION_NUMBER);

  if (!rounds || rounds.length === 0) {
    throw new Error(`No rounds found for iteration ${ITERATION_NUMBER}`);
  }

  if (ROUND_NUMBER !== undefined) {
    const selectedRound = rounds.find(
      (round) => Number(round.roundId) === ROUND_NUMBER,
    );

    if (!selectedRound) {
      const availableRounds = rounds.map((round) => Number(round.roundId)).join(", ");
      throw new Error(
        `Round ${ROUND_NUMBER} not found. Available rounds: ${availableRounds}`,
      );
    }

    return selectedRound;
  }

  return rounds.reduce((latest, round) =>
    Number(round.roundId) > Number(latest.roundId) ? round : latest,
  );
}

async function inferDeploymentBlock(provider, address, deployBlockHint) {
  const currentBlock = await provider.getBlockNumber();
  const currentCode = await provider.getCode(address, currentBlock);
  if (currentCode === "0x") {
    throw new Error(`No contract code found at ${address}`);
  }

  try {
    let low = 0;
    let high = currentBlock;
    let source = "binary-search";

    if (
      Number.isInteger(deployBlockHint) &&
      deployBlockHint > 0 &&
      deployBlockHint <= currentBlock
    ) {
      const codeAtHint = await provider.getCode(address, deployBlockHint);

      if (codeAtHint !== "0x") {
        const codeBeforeHint = await provider.getCode(address, deployBlockHint - 1);
        if (codeBeforeHint === "0x") {
          return {
            deploymentBlock: deployBlockHint,
            currentBlock,
            source: "registry-hint",
          };
        }

        high = deployBlockHint;
        source = "registry-hint-upper-bound";
      } else {
        low = deployBlockHint + 1;
        source = "registry-hint-lower-bound";
      }
    }

    // Find the first block where proxy bytecode exists.
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const code = await provider.getCode(address, mid);

      if (code === "0x") {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return { deploymentBlock: low, currentBlock, source };
  } catch (error) {
    if (deployBlockHint > 0) {
      return {
        deploymentBlock: deployBlockHint,
        currentBlock,
        source: `registry-hint-fallback (${error.message})`,
      };
    }

    throw error;
  }
}

async function main() {
  ensurePositiveInteger(ITERATION_NUMBER, "ITERATION");
  if (ROUND_NUMBER !== undefined) ensurePositiveInteger(ROUND_NUMBER, "ROUND");

  const rpcUrl = getRpcUrl(CHAIN_ID);
  const registryAddress = REGISTRY_ADDRESSES[CHAIN_ID];
  if (!registryAddress) {
    throw new Error(`No registry address configured for chain ${CHAIN_ID}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);

  log("");
  log("=======================================================", "bright");
  log("  Proof-of-Builders Community Giveaway Entrants", "bright");
  log("=======================================================", "bright");
  log("");
  log(`Fetching iteration ${ITERATION_NUMBER} from registry...`, "dim");

  const selectedRound = await selectRound(registry);
  const roundId = Number(selectedRound.roundId);
  const jurySCAddress = selectedRound.jurySC;
  const deployBlockHint = Number(selectedRound.deployBlockHint ?? 0);
  const roundVersion = Number(
    await registry.roundVersion(ITERATION_NUMBER, roundId).catch(() => 0),
  );

  const {
    deploymentBlock,
    currentBlock,
    source: deploymentBlockSource,
  } = await inferDeploymentBlock(provider, jurySCAddress, deployBlockHint);

  log(`Iteration: ${ITERATION_NUMBER}`, "cyan");
  log(`Round: ${roundId}${ROUND_NUMBER === undefined ? " (latest)" : ""}`, "cyan");
  log(`Chain ID: ${CHAIN_ID}`, "cyan");
  log(`Round Version: ${roundVersion || "unknown"}`, "cyan");
  log(`Jury Contract: ${jurySCAddress}`, "cyan");
  log(`Registry deployBlockHint: ${deployBlockHint || "none"}`, "dim");
  log(`Inferred proxy deployment block: ${deploymentBlock}`, "cyan");
  log(`Inference source: ${deploymentBlockSource}`, "dim");
  log(`Scanning blocks: ${deploymentBlock} -> ${currentBlock}`, "dim");
  log("");

  const juryContract = new ethers.Contract(jurySCAddress, JURY_ABI, provider);
  const communityLogs = await juryContract.queryFilter(
    juryContract.filters.VotedCommunity(),
    deploymentBlock,
    currentBlock,
  );

  const sortedLogs = [...communityLogs].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );

  const blockCache = new Map();
  const txCache = new Map();

  async function getBlock(blockNumber) {
    if (!blockCache.has(blockNumber)) {
      blockCache.set(blockNumber, provider.getBlock(blockNumber));
    }
    return blockCache.get(blockNumber);
  }

  async function getTransaction(hash) {
    if (!txCache.has(hash)) {
      txCache.set(hash, provider.getTransaction(hash));
    }
    return txCache.get(hash);
  }

  const voteEvents = await Promise.all(
    sortedLogs.map(async (voteLog) => {
      const [block, tx] = await Promise.all([
        getBlock(voteLog.blockNumber),
        getTransaction(voteLog.transactionHash),
      ]);

      const txFrom = tx?.from || voteLog.args.voter;

      return {
        blockNumber: voteLog.blockNumber,
        tokenId: Number(voteLog.args.tokenId),
        voter: voteLog.args.voter,
        from: txFrom,
        projectId: Number(voteLog.args.projectId),
        timestamp: Number(block?.timestamp ?? 0),
        transactionHash: voteLog.transactionHash,
      };
    }),
  );

  const orderedEntrants = [];
  const firstVoteByAddress = new Map();
  const mismatchedFromAddresses = [];

  for (const voteEvent of voteEvents) {
    if (!isSameAddress(voteEvent.from, voteEvent.voter)) {
      mismatchedFromAddresses.push(voteEvent);
    }

    const voterKey = voteEvent.from.toLowerCase();
    if (firstVoteByAddress.has(voterKey)) {
      continue;
    }

    const entrant = {
      address: voteEvent.from,
      firstVoteBlock: voteEvent.blockNumber,
      firstVoteTimestamp: voteEvent.timestamp,
      firstVoteTx: voteEvent.transactionHash,
      tokenId: voteEvent.tokenId,
      projectId: voteEvent.projectId,
    };

    firstVoteByAddress.set(voterKey, entrant);
    orderedEntrants.push(entrant);
  }

  log("-------------------------------------------------------", "dim");
  log("Community Vote Scan", "bright");
  log("-------------------------------------------------------", "dim");
  log(`Community vote events found: ${voteEvents.length}`, "cyan");
  log(`Unique community voters: ${orderedEntrants.length}`, "green");
  if (voteEvents.length !== orderedEntrants.length) {
    log(
      `Later community re-votes ignored for giveaway ordering: ${voteEvents.length - orderedEntrants.length}`,
      "yellow",
    );
  }
  if (mismatchedFromAddresses.length > 0) {
    log(
      `Warning: ${mismatchedFromAddresses.length} event voter / tx.from mismatch(es) detected; tx.from was used for ordering`,
      "yellow",
    );
  }
  log("");

  if (orderedEntrants.length === 0) {
    log("No community voters found for this round.", "yellow");
    log("");
    return;
  }

  log("-------------------------------------------------------", "dim");
  log("Ordered Entrants (oldest first)", "bright");
  log("-------------------------------------------------------", "dim");

  orderedEntrants.forEach((entrant, index) => {
    const position = String(index + 1).padStart(3, "0");
    const timestampText = entrant.firstVoteTimestamp
      ? new Date(entrant.firstVoteTimestamp * 1000).toLocaleString()
      : "Unknown timestamp";

    log(`[${position}] ${entrant.address}`, "green");
    log(
      `      first vote: block ${entrant.firstVoteBlock} | ${timestampText}`,
      "dim",
    );
    log(`      tokenId: ${entrant.tokenId} | projectId: ${entrant.projectId}`, "dim");
    log(`      tx: ${entrant.firstVoteTx}`, "dim");
  });
  log("");

  log("-------------------------------------------------------", "dim");
  log("Plain Address List", "bright");
  log("-------------------------------------------------------", "dim");
  for (const entrant of orderedEntrants) {
    console.log(entrant.address);
  }
  log("");

  if (PICK_RANDOM) {
    const winnerIndex = Math.floor(Math.random() * orderedEntrants.length) + 1;
    const winner = orderedEntrants[winnerIndex - 1];
    log("-------------------------------------------------------", "dim");
    log("Giveaway Winner", "bright");
    log("-------------------------------------------------------", "dim");
    log(`Randomly drawn index: ${winnerIndex} of ${orderedEntrants.length}`, "cyan");
    log(`Winner address: ${winner.address}`, "green");
    log(`Winner first vote block: ${winner.firstVoteBlock}`, "dim");
    log(`Winner first vote tx: ${winner.firstVoteTx}`, "dim");
    log("");
  }

  log("=======================================================", "bright");
  log("  Report Complete", "bright");
  log("=======================================================", "bright");
  log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("");
    console.error("Error:", error.message);
    console.error(error);
    process.exit(1);
  });
