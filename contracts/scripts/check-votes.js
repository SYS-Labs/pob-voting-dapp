import pkg from "hardhat";
const { ethers, network } = pkg;
import fs from "fs";
import path from "path";

/**
 * Script to check voting status for a given iteration
 *
 * Usage:
 *   # Check current round (top-level)
 *   CHAIN_ID=5700 ITERATION=1 node scripts/check-votes.js
 *
 *   # Check specific round (searches current + prev_rounds)
 *   CHAIN_ID=5700 ITERATION=1 ROUND=1 node scripts/check-votes.js
 *
 *   # Force check with specific voting mode (0=CONSENSUS, 1=WEIGHTED)
 *   VOTING_MODE=0 ITERATION=1 node scripts/check-votes.js
 *   VOTING_MODE=1 ITERATION=1 node scripts/check-votes.js
 *
 *   # With custom iterations file
 *   ITERATIONS_FILE=../frontend/public/iterations.json ITERATION=1 node scripts/check-votes.js
 *
 * Note: Past rounds are stored in the prev_rounds array. Without ROUND parameter,
 * the script checks the current round (top-level). With ROUND parameter, it searches
 * both current and prev_rounds.
 */

const CHAIN_ID = Number(process.env.CHAIN_ID || 5700);
const ITERATION_NUMBER = Number(process.env.ITERATION || 1);
const ROUND_NUMBER = process.env.ROUND ? Number(process.env.ROUND) : undefined;
const FORCED_VOTING_MODE = process.env.VOTING_MODE !== undefined ? Number(process.env.VOTING_MODE) : undefined;
const ITERATIONS_FILE = process.env.ITERATIONS_FILE || '../frontend/public/iterations.json';
const PROJECTS_FILE = process.env.PROJECTS_FILE || '../frontend/public/projects.json';

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

async function main() {
  log('\n═══════════════════════════════════════════════════════', 'bright');
  log('       Proof-of-Builders Voting Report', 'bright');
  log('═══════════════════════════════════════════════════════\n', 'bright');

  // Load iterations config
  const iterationsPath = path.join(process.cwd(), ITERATIONS_FILE);
  if (!fs.existsSync(iterationsPath)) {
    throw new Error(`Iterations file not found: ${iterationsPath}`);
  }

  const iterations = JSON.parse(fs.readFileSync(iterationsPath, 'utf8'));

  // Find base iteration by iteration number and chainId
  const baseIteration = iterations.find(it =>
    it.iteration === ITERATION_NUMBER &&
    it.chainId === CHAIN_ID
  );

  if (!baseIteration) {
    throw new Error(`Iteration ${ITERATION_NUMBER} on chain ${CHAIN_ID} not found in ${ITERATIONS_FILE}`);
  }

  let iteration;
  if (ROUND_NUMBER !== undefined) {
    // Check if requested round is the current round (top-level)
    if (baseIteration.round === ROUND_NUMBER) {
      iteration = baseIteration;
    } else if (baseIteration.prev_rounds) {
      // Search in previous rounds
      const prevRound = baseIteration.prev_rounds.find(r => r.round === ROUND_NUMBER);
      if (prevRound) {
        // Merge prev_round data with base iteration data
        iteration = {
          ...baseIteration,
          ...prevRound,
          name: `${baseIteration.name} - Round ${prevRound.round}`,
        };
      }
    }

    if (!iteration) {
      const availableRounds = [
        baseIteration.round,
        ...(baseIteration.prev_rounds || []).map(r => r.round)
      ].filter(r => r !== undefined).join(', ');
      throw new Error(
        `Round ${ROUND_NUMBER} not found for Iteration ${ITERATION_NUMBER} on chain ${CHAIN_ID}. ` +
        `Available rounds: ${availableRounds}`
      );
    }
  } else {
    // No round specified, use current round (top-level)
    iteration = baseIteration;
  }

  log(`Iteration: ${iteration.name}`, 'cyan');
  if (iteration.round !== undefined) {
    log(`Round: ${iteration.round}`, 'cyan');
  }
  log(`Chain ID: ${iteration.chainId}`, 'cyan');
  log(`Jury Contract: ${iteration.jurySC}`, 'cyan');
  log(`Deploy Block: ${iteration.deployBlockHint}`, 'dim');

  // Load project metadata
  const projectsPath = path.join(process.cwd(), PROJECTS_FILE);
  const projectMetadata = {};
  if (fs.existsSync(projectsPath)) {
    const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
    projects
      .filter(p => p.chainId === CHAIN_ID)
      .forEach(p => {
        projectMetadata[p.account.toLowerCase()] = p;
      });
  }

  // Get RPC URL for the chain
  let rpcUrl;
  if (CHAIN_ID === 5700) {
    rpcUrl = 'https://rpc.tanenbaum.io';
  } else if (CHAIN_ID === 57) {
    rpcUrl = 'https://rpc.syscoin.org';
  } else if (CHAIN_ID === 274) {
    rpcUrl = 'https://rpc.zksys-devnet.zeeve.online';
  } else if (CHAIN_ID === 31337) {
    rpcUrl = 'http://127.0.0.1:8547';
  } else {
    throw new Error(`Unsupported chain ID: ${CHAIN_ID}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  log(`Connected to: ${rpcUrl}\n`, 'dim');

  // Load contract ABIs
  const JurySC_ABI = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), '../frontend/src/abis/JurySC_01.json'), 'utf8')
  );

  const juryContract = new ethers.Contract(iteration.jurySC, JurySC_ABI, provider);

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

  // Load projects
  const projects = [];
  for (let i = 1; i <= projectCount; i++) {
    const address = await juryContract.projectAddress(i);
    const metadata = projectMetadata[address.toLowerCase()];
    projects.push({
      id: i,
      address,
      name: metadata?.name || `Project #${i}`,
      votes: {
        DevRel: 0,
        DAO_HIC: 0,
        Community: 0,
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
    juryContract.queryFilter(juryContract.filters.VotedDevRel(), iteration.deployBlockHint, 'latest'),
    juryContract.queryFilter(juryContract.filters.VotedDaoHic(), iteration.deployBlockHint, 'latest'),
    juryContract.queryFilter(juryContract.filters.VotedCommunity(), iteration.deployBlockHint, 'latest'),
  ]);

  const allVoteEvents = [
    ...devRelLogs.map(log => ({ ...log, voterType: 'DevRel' })),
    ...daoHicLogs.map(log => ({ ...log, voterType: 'DAO_HIC' })),
    ...communityLogs.map(log => ({ ...log, voterType: 'Community' })),
  ].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  log(`Found ${allVoteEvents.length} vote events (scanning blocks ${iteration.deployBlockHint} → ${currentBlock})`, 'cyan');
  log(`  DevRel: ${devRelLogs.length}`, 'dim');
  log(`  DAO_HIC: ${daoHicLogs.length}`, 'dim');
  log(`  Community: ${communityLogs.length}`, 'dim');
  log('');

  if (allVoteEvents.length > 0) {
    for (let i = 0; i < allVoteEvents.length; i++) {
      const voteLog = allVoteEvents[i];
      const voter = voteLog.args.voter;
      const projectIdOrAddress = voteLog.args.projectId || voteLog.args.projectAddress;
      const block = await provider.getBlock(voteLog.blockNumber);
      const timestamp = new Date(block.timestamp * 1000);

      // Find project
      let project;
      if (typeof projectIdOrAddress === 'bigint' || typeof projectIdOrAddress === 'number') {
        project = projects.find(p => p.id === Number(projectIdOrAddress));
      } else {
        project = projects.find(p => p.address.toLowerCase() === projectIdOrAddress.toLowerCase());
      }

      const voteNum = String(i + 1).padStart(3, ' ');
      log(`[${voteNum}] Block ${voteLog.blockNumber} | ${timestamp.toLocaleString()}`, 'dim');
      log(`      Type: ${voteLog.voterType}`, 'cyan');
      log(`      Voter: ${formatAddress(voter)}`, 'bright');
      log(`      Voted for: ${project?.name || 'Unknown'}`, 'green');
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
    // Get community votes per project
    const communityVotesByProject = new Map();
    for (const project of projects) {
      const votes = await juryContract.communityProjectVotes(project.address);
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

      // Show breakdown
      const breakdown = [];
      if (project.votes.DevRel > 0) {
        breakdown.push(`DevRel`);
      }
      if (project.votes.DAO_HIC > 0) {
        breakdown.push(`DAO_HIC (${project.votes.DAO_HIC} votes)`);
      }
      if (project.votes.Community > 0) {
        breakdown.push(`Community (${project.votes.Community} votes)`);
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
          // Calculate consensus weight for winner
          let winnerWeight = 0;
          if (winningProject?.votes.DevRel > 0) winnerWeight++;
          if (winningProject?.votes.DAO_HIC > 0) winnerWeight++;
          if (winningProject?.votes.Community > 0) winnerWeight++;

          log(`Consensus Weight: ${winnerWeight}/3 entities (${(winnerWeight * 100 / 3).toFixed(2)}%)`, 'green');
          log('');

          const breakdown = [];
          if (winningProject?.votes.DevRel > 0) breakdown.push('DevRel');
          if (winningProject?.votes.DAO_HIC > 0) breakdown.push('DAO_HIC');
          if (winningProject?.votes.Community > 0) breakdown.push('Community');

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
              if (project.votes.DevRel > 0) weight++;
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

            // Show breakdown
            const breakdown = [];
            if (project.votes.DevRel > 0) breakdown.push('DevRel');
            if (project.votes.DAO_HIC > 0) breakdown.push('DAO_HIC');
            if (project.votes.Community > 0) breakdown.push('Community');

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

              // Show contribution breakdown
              const breakdown = [];
              if (winningProject?.votes.DevRel > 0) breakdown.push('DevRel');
              if (winningProject?.votes.DAO_HIC > 0) breakdown.push(`DAO_HIC (${winningProject?.votes.DAO_HIC})`);
              if (winningProject?.votes.Community > 0) breakdown.push(`Community (${winningProject?.votes.Community})`);

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

              // Show breakdown
              const breakdown = [];
              if (project.votes.DevRel > 0) breakdown.push('DevRel');
              if (project.votes.DAO_HIC > 0) breakdown.push(`DAO_HIC (${project.votes.DAO_HIC})`);
              if (project.votes.Community > 0) breakdown.push(`Community (${project.votes.Community})`);

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

    const projectsByWeight = [...projects].sort((a, b) => b.totalWeight - a.totalWeight);
    if (projectsByWeight[0].totalWeight > 0) {
      const tied = projectsByWeight.filter(p => p.totalWeight === projectsByWeight[0].totalWeight && p.totalWeight > 0);

      if (tied.length > 1) {
        log(`  Tied (${tied.length} projects with weight ${tied[0].totalWeight}):`, 'yellow');
        tied.forEach(p => log(`    - ${p.name}`, 'yellow'));
      } else {
        log(`  Leading: ${projectsByWeight[0].name} (Weight: ${projectsByWeight[0].totalWeight})`, 'cyan');
      }
    } else {
      log(`  No votes cast yet`, 'dim');
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
