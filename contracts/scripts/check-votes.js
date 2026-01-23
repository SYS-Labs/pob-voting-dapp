import pkg from "hardhat";
const { ethers, network } = pkg;
import fs from "fs";
import path from "path";

/**
 * Script to check voting status for an iteration
 *
 * Usage:
 *   # Basic usage (testnet) - check latest round
 *   CHAIN_ID=5700 ITERATION=1 node scripts/check-votes.js
 *
 *   # Check specific round
 *   CHAIN_ID=5700 ITERATION=1 ROUND=2 node scripts/check-votes.js
 *
 *   # Mainnet
 *   CHAIN_ID=57 ITERATION=1 node scripts/check-votes.js
 *
 *   # Local network
 *   CHAIN_ID=31337 ITERATION=1 node scripts/check-votes.js
 *
 *   # Force check with specific voting mode (0=CONSENSUS, 1=WEIGHTED)
 *   CHAIN_ID=5700 ITERATION=1 VOTING_MODE=1 node scripts/check-votes.js
 *
 *   # Custom API URL (for project names)
 *   API_URL=http://localhost:4000 ITERATION=1 node scripts/check-votes.js
 */

const CHAIN_ID = Number(process.env.CHAIN_ID || 5700);
const ITERATION_NUMBER = Number(process.env.ITERATION || 1);
const ROUND_NUMBER = process.env.ROUND ? Number(process.env.ROUND) : undefined;
const FORCED_VOTING_MODE = process.env.VOTING_MODE !== undefined ? Number(process.env.VOTING_MODE) : undefined;
const API_BASE_URL = process.env.API_URL || 'https://pob-api.syscoin.org';

// Registry contract addresses per chain
const REGISTRY_ADDRESSES = {
  57: '', // Mainnet - TODO: deploy
  5700: '0xA985cE400afea8eEf107c24d879c8c777ece1a8a',
  31337: '0xab180957A96821e90C0114292DDAfa9E9B050d65',
};

// Registry ABI (minimal)
const REGISTRY_ABI = [
  'function getIteration(uint256 iterationId) external view returns (tuple(uint256 iterationId, uint256 chainId, uint256 roundCount, bool exists))',
  'function getRounds(uint256 iterationId) external view returns (tuple(uint256 iterationId, uint256 roundId, address jurySC, uint256 deployBlockHint, bool exists)[])',
];

// Vote weights per entity (customize as needed)
const VOTE_WEIGHTS = {
  DevRel: 1,
  DAO_HIC: 1,
  Community: 1,
};

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function formatAddress(addr) {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Fetch project metadata from API to get project names
 * Returns a map of project address (lowercase) -> metadata
 */
async function fetchProjectMetadataFromAPI(chainId, iterationId) {
  try {
    const url = `${API_BASE_URL}/api/iterations/${chainId}/${iterationId}`;
    log(`Fetching project names from API...`, 'dim');

    const response = await fetch(url);
    if (!response.ok) {
      log(`API request failed: ${response.status}`, 'dim');
      return new Map();
    }

    const data = await response.json();
    const iteration = data.iteration;

    if (!iteration) {
      log(`Iteration not found in API`, 'dim');
      return new Map();
    }

    // Build map of project address -> metadata
    const metadataMap = new Map();
    for (const project of iteration.projects || []) {
      if (project.address && project.metadata) {
        metadataMap.set(project.address.toLowerCase(), project.metadata);
      }
    }

    log(`Found ${metadataMap.size} project(s) with metadata`, 'dim');
    return metadataMap;
  } catch (error) {
    log(`Failed to fetch from API: ${error.message}`, 'dim');
    return new Map();
  }
}

async function main() {
  log('\n═══════════════════════════════════════════════════════', 'bright');
  log('       Proof-of-Builders Voting Report', 'bright');
  log('═══════════════════════════════════════════════════════\n', 'bright');

  // Get RPC URL for the chain
  let rpcUrl;
  if (CHAIN_ID === 5700) {
    rpcUrl = 'https://rpc.tanenbaum.io';
  } else if (CHAIN_ID === 57) {
    rpcUrl = 'https://rpc.syscoin.org';
  } else if (CHAIN_ID === 31337) {
    rpcUrl = 'http://127.0.0.1:8547';
  } else {
    throw new Error(`Unsupported chain ID: ${CHAIN_ID}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Get registry address for this chain
  const registryAddress = REGISTRY_ADDRESSES[CHAIN_ID];
  if (!registryAddress) {
    throw new Error(`No registry address configured for chain ${CHAIN_ID}`);
  }

  // Connect to registry and fetch iteration data
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);

  log(`Fetching iteration ${ITERATION_NUMBER} from registry...`, 'dim');

  const [iterationInfo, rounds] = await Promise.all([
    registry.getIteration(ITERATION_NUMBER),
    registry.getRounds(ITERATION_NUMBER),
  ]);

  if (!rounds || rounds.length === 0) {
    throw new Error(`No rounds found for iteration ${ITERATION_NUMBER}`);
  }

  // Select round: use specified ROUND_NUMBER or latest (highest roundId)
  let selectedRound;
  if (ROUND_NUMBER !== undefined) {
    selectedRound = rounds.find(r => Number(r.roundId) === ROUND_NUMBER);
    if (!selectedRound) {
      const availableRounds = rounds.map(r => Number(r.roundId)).join(', ');
      throw new Error(`Round ${ROUND_NUMBER} not found. Available rounds: ${availableRounds}`);
    }
  } else {
    // Get latest round (highest roundId)
    selectedRound = rounds.reduce((latest, r) =>
      Number(r.roundId) > Number(latest.roundId) ? r : latest
    );
  }

  const jurySCAddress = selectedRound.jurySC;
  const deployBlockHint = Number(selectedRound.deployBlockHint);
  const roundId = Number(selectedRound.roundId);

  log(`Iteration: ${ITERATION_NUMBER}`, 'cyan');
  log(`Round: ${roundId}${ROUND_NUMBER === undefined ? ' (latest)' : ''}`, 'cyan');
  log(`Chain ID: ${CHAIN_ID}`, 'cyan');
  log(`Jury Contract: ${jurySCAddress}`, 'cyan');
  log(`Deploy Block: ${deployBlockHint}`, 'dim');
  log(`Connected to: ${rpcUrl}\n`, 'dim');

  // Load contract ABIs
  const JurySC_ABI = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), '../frontend/src/abis/JurySC_02_v001.json'), 'utf8')
  );

  const juryContract = new ethers.Contract(jurySCAddress, JurySC_ABI, provider);

  // Get contract state
  const [
    isActive,
    votingEnded,
    startTimeRaw,
    endTimeRaw,
    projectCount,
    devRelAccount,
    daoHicVoters,
    votingMode,
  ] = await Promise.all([
    juryContract.isActive(),
    juryContract.votingEnded(),
    juryContract.startTime(),
    juryContract.endTime(),
    juryContract.projectCount(),
    juryContract.devRelAccount().catch(() => ethers.ZeroAddress),
    juryContract.getDaoHicVoters(),
    juryContract.votingMode(),
  ]);

  const startTime = Number(startTimeRaw);
  const endTime = Number(endTimeRaw);

  // Use forced voting mode if provided, otherwise use contract's mode
  const effectiveVotingMode = FORCED_VOTING_MODE !== undefined ? FORCED_VOTING_MODE : Number(votingMode);
  const votingModeNames = ['CONSENSUS', 'WEIGHTED'];
  const votingModeName = votingModeNames[effectiveVotingMode] || `Unknown (${effectiveVotingMode})`;
  const isForced = FORCED_VOTING_MODE !== undefined;

  // Status
  let status = 'Upcoming';
  if (votingEnded) {
    status = 'Ended';
  } else if (isActive) {
    status = 'Active';
  }

  log('─────────────────────────────────────────────────────', 'dim');
  log('PROGRAM STATUS', 'bright');
  log('─────────────────────────────────────────────────────', 'dim');
  log(`Status: ${status}`, status === 'Active' ? 'green' : status === 'Ended' ? 'red' : 'yellow');
  log(`Voting Mode: ${votingModeName}${isForced ? ' (FORCED)' : ''}`, isForced ? 'magenta' : 'cyan');

  if (startTime > 0) {
    log(`Start:  ${new Date(startTime * 1000).toLocaleString()}`, 'dim');
    log(`End:    ${new Date(endTime * 1000).toLocaleString()}`, 'dim');
    const timeLeft = endTime - Math.floor(Date.now() / 1000);
    if (timeLeft > 0 && isActive) {
      const hours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      log(`Remaining: ${hours}h ${minutes}m`, 'cyan');
    }
  }
  log('');

  // Fetch project metadata from API (for names)
  const projectMetadata = await fetchProjectMetadataFromAPI(CHAIN_ID, ITERATION_NUMBER);

  // Load projects
  const projects = [];
  for (let i = 1; i <= projectCount; i++) {
    const address = await juryContract.projectAddress(i);
    const metadata = projectMetadata.get(address.toLowerCase());
    projects.push({
      id: i,
      address,
      name: metadata?.name || `Project #${i}`,
      votes: {
        DevRel: 0,
        DAO_HIC: 0,
        Community: 0,
      },
      // Actual vote counts (not just consensus flags)
      voteCounts: {
        daoHic: 0,
        community: 0,
      },
      totalWeight: 0,
    });
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 1: VOTE ACTIVITY FOUND
  // ═══════════════════════════════════════════════════════
  log('─────────────────────────────────────────────────────', 'dim');
  log('1. VOTE ACTIVITY HISTORY', 'bright');
  log('─────────────────────────────────────────────────────', 'dim');

  const currentBlock = await provider.getBlockNumber();
  const [devRelLogs, daoHicLogs, communityLogs] = await Promise.all([
    juryContract.queryFilter(juryContract.filters.VotedDevRel(), deployBlockHint, 'latest'),
    juryContract.queryFilter(juryContract.filters.VotedDaoHic(), deployBlockHint, 'latest'),
    juryContract.queryFilter(juryContract.filters.VotedCommunity(), deployBlockHint, 'latest'),
  ]);

  const allVoteEvents = [
    ...devRelLogs.map(log => ({ ...log, voterType: 'DevRel' })),
    ...daoHicLogs.map(log => ({ ...log, voterType: 'DAO_HIC' })),
    ...communityLogs.map(log => ({ ...log, voterType: 'Community' })),
  ].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  log(`Found ${allVoteEvents.length} vote events (scanning blocks ${deployBlockHint} → ${currentBlock})`, 'cyan');
  log(`  DevRel: ${devRelLogs.length}`, 'dim');
  log(`  DAO_HIC: ${daoHicLogs.length}`, 'dim');
  log(`  Community: ${communityLogs.length}`, 'dim');
  log(`  (includes vote changes - only latest vote per voter counts)`, 'dim');
  log('');

  if (allVoteEvents.length > 0) {
    // Track latest vote per voter to mark superseded ones
    const latestVoteByVoter = new Map();
    for (const voteLog of allVoteEvents) {
      const voter = voteLog.args.voter.toLowerCase();
      const voterKey = `${voteLog.voterType}:${voter}`;
      latestVoteByVoter.set(voterKey, voteLog);
    }

    for (let i = 0; i < allVoteEvents.length; i++) {
      const voteLog = allVoteEvents[i];
      const voter = voteLog.args.voter;
      const voterKey = `${voteLog.voterType}:${voter.toLowerCase()}`;
      const projectIdOrAddress = voteLog.args.projectId || voteLog.args.projectAddress;
      const block = await provider.getBlock(voteLog.blockNumber);
      const timestamp = new Date(block.timestamp * 1000);

      // Check if this vote was superseded
      const isSuperseded = latestVoteByVoter.get(voterKey) !== voteLog;

      // Find project
      let project;
      if (typeof projectIdOrAddress === 'bigint' || typeof projectIdOrAddress === 'number') {
        project = projects.find(p => p.id === Number(projectIdOrAddress));
      } else {
        project = projects.find(p => p.address.toLowerCase() === projectIdOrAddress.toLowerCase());
      }

      const voteNum = String(i + 1).padStart(3, ' ');
      const supersededTag = isSuperseded ? ' [SUPERSEDED]' : '';
      log(`[${voteNum}] Block ${voteLog.blockNumber} | ${timestamp.toLocaleString()}${supersededTag}`, isSuperseded ? 'yellow' : 'dim');
      log(`      Type: ${voteLog.voterType}`, isSuperseded ? 'yellow' : 'cyan');
      log(`      Voter: ${formatAddress(voter)}`, isSuperseded ? 'yellow' : 'bright');
      log(`      Voted for: ${project?.name || 'Unknown'}`, isSuperseded ? 'yellow' : 'green');
      log(`      Tx: ${voteLog.transactionHash}`, 'dim');
      log('');
    }
  } else {
    log('  No vote events found', 'yellow');
    log('');
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 2: FINAL VOTE PER VOTER
  // ═══════════════════════════════════════════════════════
  log('─────────────────────────────────────────────────────', 'dim');
  log('2. FINAL VOTE PER VOTER', 'bright');
  log('─────────────────────────────────────────────────────', 'dim');

  // DevRel
  const devRelVoteAddress = await juryContract.devRelVote().catch(() => ethers.ZeroAddress);
  const devRelProject = projects.find(p => p.address.toLowerCase() === devRelVoteAddress.toLowerCase());

  log('DevRel Entity:', 'cyan');
  if (devRelAccount !== ethers.ZeroAddress) {
    log(`  Account: ${devRelAccount}`, 'dim');
    if (devRelProject) {
      log(`  ✓ Voted for: ${devRelProject.name}`, 'green');
      devRelProject.votes.DevRel = 1;
    } else {
      log(`  ✗ No vote cast`, 'yellow');
    }
  } else {
    log(`  Not configured`, 'dim');
  }
  log('');

  // DAO_HIC
  log(`DAO_HIC Entity (${daoHicVoters.length} authorized voters):`, 'cyan');
  const daoHicVotesByVoter = new Map();

  for (let i = 0; i < daoHicVoters.length; i++) {
    const voterAddress = daoHicVoters[i];
    const hasVoted = await juryContract.daoHicHasVoted(voterAddress);
    const voteFor = hasVoted ? await juryContract.daoHicVoteOf(voterAddress) : null;
    const project = voteFor ? projects.find(p => p.address.toLowerCase() === voteFor.toLowerCase()) : null;

    log(`  [${i + 1}] ${voterAddress}`, 'dim');
    if (hasVoted && project) {
      log(`      ✓ Voted for: ${project.name}`, 'green');
      daoHicVotesByVoter.set(voterAddress.toLowerCase(), project);
    } else {
      log(`      ✗ No vote cast`, 'yellow');
    }
  }

  // Fetch actual DAO_HIC vote counts per project
  for (const project of projects) {
    const daoVotes = await juryContract.daoHicProjectVotes(project.address);
    project.voteCounts.daoHic = Number(daoVotes);
  }

  // DAO_HIC consensus
  const daoHicEntityVote = await juryContract.getDaoHicEntityVote().catch(() => ethers.ZeroAddress);
  const daoHicEntityProject = projects.find(p => p.address.toLowerCase() === daoHicEntityVote.toLowerCase());

  log(`  Entity consensus:`, 'cyan');
  if (daoHicEntityProject) {
    log(`  ✓ ${daoHicEntityProject.name}`, 'green');
    daoHicEntityProject.votes.DAO_HIC = 1;
  } else {
    log(`  ✗ No consensus`, 'yellow');
  }
  log('');

  // Community
  const totalCommunityVoters = await juryContract.communityVotesCast();
  log(`Community Entity (${totalCommunityVoters} votes cast):`, 'cyan');

  if (Number(totalCommunityVoters) > 0) {
    // Get community votes per project and store actual counts
    const communityVotesByProject = new Map();
    for (const project of projects) {
      const votes = await juryContract.communityProjectVotes(project.address);
      project.voteCounts.community = Number(votes);
      if (Number(votes) > 0) {
        communityVotesByProject.set(project.address.toLowerCase(), Number(votes));
      }
    }

    // Show breakdown
    for (const [projectAddr, voteCount] of communityVotesByProject.entries()) {
      const project = projects.find(p => p.address.toLowerCase() === projectAddr);
      log(`  ${project?.name || projectAddr}: ${voteCount} vote${voteCount !== 1 ? 's' : ''}`, 'green');
    }

    // Community entity consensus
    const communityEntityVote = await juryContract.getCommunityEntityVote().catch(() => ethers.ZeroAddress);
    const communityEntityProject = projects.find(p => p.address.toLowerCase() === communityEntityVote.toLowerCase());

    log(`  Entity consensus:`, 'cyan');
    if (communityEntityProject) {
      log(`  ✓ ${communityEntityProject.name}`, 'green');
      communityEntityProject.votes.Community = 1;
    } else {
      log(`  ✗ No consensus`, 'yellow');
    }
  } else {
    log(`  No votes cast`, 'dim');
  }
  log('');

  // ═══════════════════════════════════════════════════════
  // SECTION 3 & 4: PROJECTS BY WEIGHTED VOTES
  // ═══════════════════════════════════════════════════════
  log('─────────────────────────────────────────────────────', 'dim');
  log('3. PROJECTS BY WEIGHTED VOTES', 'bright');
  log('─────────────────────────────────────────────────────', 'dim');
  log(`Each entity has 1/3 weight (proportional distribution within entity)`, 'dim');
  log('');

  // Get scores from contract
  try {
    const [addresses, scores, totalPossible] = await juryContract.getWinnerWithScores();

    // Map scores to projects
    const projectsWithScores = projects.map(project => {
      const index = addresses.findIndex(addr => addr.toLowerCase() === project.address.toLowerCase());
      const score = index >= 0 ? scores[index] : 0n;
      const percentage = totalPossible > 0n
        ? (Number(score) * 100 / Number(totalPossible)).toFixed(2)
        : '0.00';

      return {
        ...project,
        score: score,
        percentage: percentage
      };
    });

    // Sort by score (descending: highest → lowest)
    const sortedProjects = projectsWithScores.sort((a, b) => {
      if (a.score > b.score) return -1;
      if (a.score < b.score) return 1;
      return 0;
    });

    for (const project of sortedProjects) {
      const scoreNum = Number(project.score);
      const weightColor = scoreNum === 0 ? 'dim' : scoreNum < Number(totalPossible) / 3 ? 'yellow' : scoreNum < Number(totalPossible) * 2 / 3 ? 'cyan' : 'green';

      log(`${project.name} (ID: ${project.id})`, 'bright');
      log(`  Address: ${project.address}`, 'dim');
      log(`  Weighted Score: ${project.percentage}%`, weightColor);
      log(`    (${ethers.formatEther(project.score)} / ${ethers.formatEther(totalPossible)})`, 'dim');

      // Show breakdown using actual vote counts
      const breakdown = [];
      if (devRelVoteAddress.toLowerCase() === project.address.toLowerCase()) {
        breakdown.push(`DevRel`);
      }
      if (project.voteCounts.daoHic > 0) {
        breakdown.push(`DAO_HIC (${project.voteCounts.daoHic} vote${project.voteCounts.daoHic !== 1 ? 's' : ''})`);
      }
      if (project.voteCounts.community > 0) {
        breakdown.push(`Community (${project.voteCounts.community} vote${project.voteCounts.community !== 1 ? 's' : ''})`);
      }

      if (breakdown.length > 0) {
        log(`  Votes from: ${breakdown.join(', ')}`, 'green');
      } else {
        log(`  No votes received`, 'dim');
      }
      log('');
    }
  } catch (error) {
    log('⚠️  Could not retrieve weighted scores from contract', 'yellow');
    log(`Error: ${error.message}`, 'dim');
    log('');
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 5: FINAL OUTCOME
  // ═══════════════════════════════════════════════════════
  log('─────────────────────────────────────────────────────', 'dim');
  log('5. FINAL OUTCOME', 'bright');
  log('─────────────────────────────────────────────────────', 'dim');

  if (votingEnded) {
    try {
      // Get results based on effective voting mode (forced or contract's)
      let selectedWinner, selectedHas;
      if (effectiveVotingMode === 0) {
        [selectedWinner, selectedHas] = await juryContract.getWinnerConsensus();
      } else {
        [selectedWinner, selectedHas] = await juryContract.getWinnerWeighted();
      }

      log('');
      log(`🎯 VOTING MODE: ${votingModeName}${isForced ? ' (FORCED)' : ''}`, isForced ? 'magenta' : 'bright');
      log('');

      // Show winner based on current mode
      if (selectedHas && selectedWinner !== ethers.ZeroAddress) {
        const winningProject = projects.find(p => p.address.toLowerCase() === selectedWinner.toLowerCase());

        log('🏆🏆🏆  WINNER  🏆🏆🏆', 'green');
        log('');
        log(`Project: ${winningProject?.name || 'Unknown'}`, 'bright');
        log(`ID: ${winningProject?.id}`, 'green');
        log(`Address: ${winningProject?.address}`, 'green');
        log('');

        // Mode-specific details
        if (effectiveVotingMode === 0) {
          // CONSENSUS mode
          // Calculate consensus weight for winner (entity-level, not individual votes)
          let winnerWeight = 0;
          if (devRelVoteAddress.toLowerCase() === winningProject?.address.toLowerCase()) winnerWeight++;
          if (winningProject?.votes.DAO_HIC > 0) winnerWeight++;
          if (winningProject?.votes.Community > 0) winnerWeight++;

          log(`Consensus Weight: ${winnerWeight}/3 entities (${(winnerWeight * 100 / 3).toFixed(2)}%)`, 'green');
          log('');

          // Show breakdown with actual vote counts
          const breakdown = [];
          if (devRelVoteAddress.toLowerCase() === winningProject?.address.toLowerCase()) {
            breakdown.push('DevRel');
          }
          if (winningProject?.voteCounts.daoHic > 0) {
            breakdown.push(`DAO_HIC (${winningProject.voteCounts.daoHic} vote${winningProject.voteCounts.daoHic !== 1 ? 's' : ''})`);
          }
          if (winningProject?.voteCounts.community > 0) {
            breakdown.push(`Community (${winningProject.voteCounts.community} vote${winningProject.voteCounts.community !== 1 ? 's' : ''})`);
          }

          if (breakdown.length > 0) {
            log(`Winning votes from: ${breakdown.join(', ')}`, 'cyan');
          }

          // Show other competing projects
          log('');
          log('Other Projects:', 'bright');
          log('');

          const otherProjects = projects
            .filter(p => p.address.toLowerCase() !== selectedWinner.toLowerCase())
            .map(project => {
              let weight = 0;
              if (devRelVoteAddress.toLowerCase() === project.address.toLowerCase()) weight++;
              if (project.votes.DAO_HIC > 0) weight++;
              if (project.votes.Community > 0) weight++;
              return { ...project, consensusWeight: weight };
            })
            .sort((a, b) => b.consensusWeight - a.consensusWeight);

          for (const project of otherProjects) {
            const weightColor = project.consensusWeight === 0 ? 'dim' : project.consensusWeight === 1 ? 'yellow' : 'cyan';
            const percentage = (project.consensusWeight * 100 / 3).toFixed(2);

            log(`  ${project.name} (ID: ${project.id})`, 'bright');
            log(`    Consensus Weight: ${project.consensusWeight}/3 entities (${percentage}%)`, weightColor);

            // Show breakdown with actual vote counts
            const breakdown = [];
            if (devRelVoteAddress.toLowerCase() === project.address.toLowerCase()) {
              breakdown.push('DevRel');
            }
            if (project.voteCounts.daoHic > 0) {
              breakdown.push(`DAO_HIC (${project.voteCounts.daoHic} vote${project.voteCounts.daoHic !== 1 ? 's' : ''})`);
            }
            if (project.voteCounts.community > 0) {
              breakdown.push(`Community (${project.voteCounts.community} vote${project.voteCounts.community !== 1 ? 's' : ''})`);
            }

            if (breakdown.length > 0) {
              log(`    Votes from: ${breakdown.join(', ')}`, 'dim');
            }
            log('');
          }
        } else {
          // WEIGHTED mode - show percentage score
          try {
            const [addresses, scores, totalPossible] = await juryContract.getWinnerWithScores();
            const winnerIndex = addresses.findIndex(addr =>
              addr.toLowerCase() === selectedWinner.toLowerCase()
            );

            if (winnerIndex >= 0) {
              const score = scores[winnerIndex];
              const percentage = (Number(score) * 100 / Number(totalPossible)).toFixed(2);
              log(`Weighted Score: ${percentage}%`, 'green');
              log(`  (${ethers.formatEther(score)} / ${ethers.formatEther(totalPossible)})`, 'dim');
              log('');

              // Show contribution breakdown using actual vote counts
              const breakdown = [];
              if (devRelVoteAddress.toLowerCase() === winningProject?.address.toLowerCase()) {
                breakdown.push('DevRel');
              }
              if (winningProject?.voteCounts.daoHic > 0) {
                breakdown.push(`DAO_HIC (${winningProject.voteCounts.daoHic} vote${winningProject.voteCounts.daoHic !== 1 ? 's' : ''})`);
              }
              if (winningProject?.voteCounts.community > 0) {
                breakdown.push(`Community (${winningProject.voteCounts.community} vote${winningProject.voteCounts.community !== 1 ? 's' : ''})`);
              }

              if (breakdown.length > 0) {
                log(`Votes from: ${breakdown.join(', ')}`, 'cyan');
              }
            }

            // Show other competing projects
            log('');
            log('Other Projects:', 'bright');
            log('');

            const projectsWithScores = projects
              .map(project => {
                const index = addresses.findIndex(addr => addr.toLowerCase() === project.address.toLowerCase());
                const score = index >= 0 ? scores[index] : 0n;
                const percentage = totalPossible > 0n
                  ? (Number(score) * 100 / Number(totalPossible)).toFixed(2)
                  : '0.00';
                return { ...project, score, percentage };
              })
              // Filter out the winner and sort by score descending
              .filter(p => p.address.toLowerCase() !== selectedWinner.toLowerCase())
              .sort((a, b) => {
                if (a.score > b.score) return -1;
                if (a.score < b.score) return 1;
                return 0;
              });

            for (const project of projectsWithScores) {
              const scoreNum = Number(project.score);
              const weightColor = scoreNum === 0 ? 'dim' : 'cyan';

              log(`  ${project.name} (ID: ${project.id})`, 'bright');
              log(`    Score: ${project.percentage}% (${ethers.formatEther(project.score)} / ${ethers.formatEther(totalPossible)})`, weightColor);

              // Show breakdown using actual vote counts
              const breakdown = [];
              if (devRelVoteAddress.toLowerCase() === project.address.toLowerCase()) {
                breakdown.push('DevRel');
              }
              if (project.voteCounts.daoHic > 0) {
                breakdown.push(`DAO_HIC (${project.voteCounts.daoHic} vote${project.voteCounts.daoHic !== 1 ? 's' : ''})`);
              }
              if (project.voteCounts.community > 0) {
                breakdown.push(`Community (${project.voteCounts.community} vote${project.voteCounts.community !== 1 ? 's' : ''})`);
              }

              if (breakdown.length > 0) {
                log(`    Votes from: ${breakdown.join(', ')}`, 'dim');
              }
              log('');
            }

          } catch (err) {
            log(`Winner determined by weighted voting`, 'cyan');
          }
        }
      } else {
        log('⚠️  NO WINNER', 'yellow');
        log('');
        if (effectiveVotingMode === 0) {
          log(`No project achieved 2-out-of-3 entity consensus`, 'dim');
        } else {
          log(`No clear winner (tie or no votes)`, 'dim');
        }
        log('');

        // Show participation
        const participation = [];
        if (devRelProject) participation.push('DevRel');
        if (daoHicEntityProject) participation.push('DAO_HIC');
        if (Number(totalCommunityVoters) > 0) participation.push(`Community (${totalCommunityVoters})`);

        if (participation.length > 0) {
          log(`Entities that voted: ${participation.join(', ')}`, 'dim');
        }
      }

    } catch (error) {
      log(`Could not determine winner: ${error.message}`, 'red');
    }
  } else if (isActive) {
    log('');
    log('⏳  VOTING IN PROGRESS', 'cyan');
    log('');
    log('Current standings (not final):', 'dim');

    // Use actual scores from contract
    try {
      const [addresses, scores, totalPossible] = await juryContract.getWinnerWithScores();
      const hasVotes = scores.some(s => s > 0n);

      if (hasVotes) {
        // Find leading project(s)
        const maxScore = scores.reduce((max, s) => s > max ? s : max, 0n);
        const leaders = projects.filter(p => {
          const idx = addresses.findIndex(a => a.toLowerCase() === p.address.toLowerCase());
          return idx >= 0 && scores[idx] === maxScore;
        });

        if (leaders.length > 1) {
          const pct = (Number(maxScore) * 100 / Number(totalPossible)).toFixed(2);
          log(`  Tied (${leaders.length} projects at ${pct}%):`, 'yellow');
          leaders.forEach(p => log(`    - ${p.name}`, 'yellow'));
        } else if (leaders.length === 1) {
          const pct = (Number(maxScore) * 100 / Number(totalPossible)).toFixed(2);
          log(`  Leading: ${leaders[0].name} (${pct}%)`, 'cyan');
        }
      } else {
        log(`  No votes cast yet`, 'dim');
      }
    } catch (err) {
      log(`  Could not retrieve standings: ${err.message}`, 'dim');
    }
  } else {
    log('');
    log('📅  VOTING NOT STARTED', 'yellow');
    log('');
    log('The voting period has not begun yet.', 'dim');
  }

  log('');
  log('═══════════════════════════════════════════════════════', 'bright');
  log('                    Report Complete', 'bright');
  log('═══════════════════════════════════════════════════════\n', 'bright');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  });
