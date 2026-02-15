<script lang="ts">
  import { Link } from 'svelte-routing';

  interface Props {
    winner: { projectAddress: string | null; hasWinner: boolean };
    entityVotes: { smt: string | null; daoHic: string | null; community: string | null };
    daoHicIndividualVotes?: Record<string, string>;
    votingMode: number;
    projects: { id: number; address: string; metadata?: any }[];
    projectScores?: { addresses: string[]; scores: string[]; totalPossible: string } | null;
    getProjectLabel?: (address: string | null) => string | null;
    isOwner: boolean;
    iterationNumber?: number;
  }

  let {
    winner,
    entityVotes,
    daoHicIndividualVotes = {},
    votingMode,
    projects,
    projectScores = null,
    getProjectLabel,
    isOwner,
    iterationNumber,
  }: Props = $props();

  // Consensus mode: compute weight for winner
  let winnerConsensusWeight = $derived.by(() => {
    if (votingMode !== 0 || !winner.hasWinner || !winner.projectAddress) return { weight: 0, percentage: '0.00' };
    let weight = 0;
    const firstEntityVote = entityVotes.smt;
    if (firstEntityVote?.toLowerCase() === winner.projectAddress.toLowerCase()) weight++;
    if (entityVotes.daoHic?.toLowerCase() === winner.projectAddress.toLowerCase()) weight++;
    if (entityVotes.community?.toLowerCase() === winner.projectAddress.toLowerCase()) weight++;
    const percentage = ((weight / 3) * 100).toFixed(2);
    return { weight, percentage };
  });

  // Weighted mode: compute score for winner
  let winnerWeightedScore = $derived.by(() => {
    if (votingMode !== 1 || !projectScores || !winner.hasWinner || !winner.projectAddress) return null;
    const scoreIndex = projectScores.addresses.findIndex(
      addr => addr.toLowerCase() === winner.projectAddress?.toLowerCase()
    );
    if (scoreIndex < 0) return null;
    const score = BigInt(projectScores.scores[scoreIndex]);
    const totalPossible = BigInt(projectScores.totalPossible);
    const percentage = Number((score * 10000n) / totalPossible) / 100;
    return { score, percentage };
  });

  // Consensus mode runners-up
  let consensusRunnersUp = $derived.by(() => {
    if (votingMode !== 0 || !winner.hasWinner || !winner.projectAddress) return [];
    return projects
      .filter(p => p.address.toLowerCase() !== winner.projectAddress?.toLowerCase())
      .map(project => {
        let weight = 0;
        const firstEntityVote = entityVotes.smt;
        if (firstEntityVote?.toLowerCase() === project.address.toLowerCase()) weight++;
        if (entityVotes.daoHic?.toLowerCase() === project.address.toLowerCase()) weight++;
        if (entityVotes.community?.toLowerCase() === project.address.toLowerCase()) weight++;
        const percentage = ((weight / 3) * 100).toFixed(2);
        return { ...project, weight, percentage };
      })
      .sort((a, b) => b.weight - a.weight);
  });

  // Weighted mode runners-up
  let weightedRunnersUp = $derived.by(() => {
    if (votingMode !== 1 || !projectScores || !winner.hasWinner || !winner.projectAddress) return [];
    return projects
      .filter(p => p.address.toLowerCase() !== winner.projectAddress?.toLowerCase())
      .map(project => {
        const scoreIndex = projectScores!.addresses.findIndex(
          addr => addr.toLowerCase() === project.address.toLowerCase()
        );
        const score = scoreIndex >= 0 ? BigInt(projectScores!.scores[scoreIndex]) : 0n;
        const totalPossible = BigInt(projectScores!.totalPossible);
        const percentage = Number((score * 10000n) / totalPossible) / 100;
        return { ...project, score, percentage };
      })
      .sort((a, b) => {
        if (a.score > b.score) return -1;
        if (a.score < b.score) return 1;
        return 0;
      });
  });

  // No-winner: unique projects that received votes (non-owner view)
  const firstEntityVoteAddr = $derived(entityVotes.smt);
  const firstEntityLabel = 'SMT';

  let votedProjectAddresses = $derived.by(() => {
    return Array.from(new Set(
      [entityVotes.community, entityVotes.daoHic, firstEntityVoteAddr].filter(Boolean) as string[]
    ));
  });

  // No-winner: three-way tie check
  let isThreeWayTie = $derived(
    firstEntityVoteAddr && entityVotes.daoHic && entityVotes.community &&
    firstEntityVoteAddr !== entityVotes.daoHic &&
    entityVotes.daoHic !== entityVotes.community &&
    firstEntityVoteAddr !== entityVotes.community
  );

  // DAO HIC individual vote unique projects
  let daoHicUniqueProjects = $derived.by(() => {
    return [...new Set(Object.values(daoHicIndividualVotes).map(p => p.toLowerCase()))];
  });

  // Helper to get label for a project address
  function getLabel(address: string | null, fallback: string): string {
    if (!address) return fallback;
    return getProjectLabel ? getProjectLabel(address) ?? fallback : fallback;
  }
</script>

{#snippet projectName(address: string | null, fallback: string)}
  {#if address && iterationNumber}
    <Link
      to="/iteration/{iterationNumber}/project/{address}"
      class="final-results-link"
    >
      {getLabel(address, fallback)}
    </Link>
  {:else}
    {getLabel(address, fallback)}
  {/if}
{/snippet}

<div
  style="margin-top: 1rem; padding: 1rem; border: 2px solid var(--pob-primary); border-radius: 0.5rem; background-color: rgba(247, 147, 26, 0.05);"
>
  <h4 class="text-sm font-semibold text-white mb-2">Final Results</h4>

  {#if winner.hasWinner && winner.projectAddress}
    <div class="space-y-3">
      <!-- Winner Display -->
      <div class="space-y-1">
        {#if votingMode === 0}
          <!-- Consensus mode - show name with trophy and entity count -->
          <p class="text-lg font-bold text-[var(--pob-primary)]">
            🏆{' '}
            <span class="italic">
              {@render projectName(winner.projectAddress, winner.projectAddress)}
            </span>
          </p>
          <p class="text-sm text-[var(--pob-text-muted)]">
            {winnerConsensusWeight.weight}/3 entities ({winnerConsensusWeight.percentage}%)
          </p>
        {:else}
          <!-- Weighted mode - show name with trophy and progress bar -->
          {#if winnerWeightedScore}
            <div class="flex items-center justify-between">
              <p class="text-lg font-bold text-[var(--pob-primary)]">
                🏆{' '}
                <span class="italic">
                  {@render projectName(winner.projectAddress, winner.projectAddress)}
                </span>
              </p>
              <p class="text-sm text-[var(--pob-text-muted)]">{winnerWeightedScore.percentage.toFixed(2)}%</p>
            </div>
            <div class="score-bar-container">
              <div
                class="score-bar-fill"
                style="width: {Math.min(winnerWeightedScore.percentage, 100)}%"
              ></div>
            </div>
          {:else}
            <p class="text-lg font-bold text-[var(--pob-primary)]">
              🏆{' '}
              <span class="italic">
                {@render projectName(winner.projectAddress, winner.projectAddress)}
              </span>
            </p>
          {/if}
        {/if}
      </div>

      <!-- Runners-up -->
      {#if projects.length > 1}
        <div class="space-y-2 border-t border-[var(--pob-border)]" style="padding-top: 1rem;">
          <p class="text-sm font-semibold text-white" style="margin-bottom: 0.25rem;">Runners-up:</p>
          <div class="space-y-2">
            {#if votingMode === 0}
              <!-- Consensus mode - show other projects by entity count -->
              {#each consensusRunnersUp as project (project.address)}
                <div class="text-xs">
                  <p class="text-white italic">
                    {@render projectName(project.address, `Project #${project.id}`)}
                  </p>
                  <p class="text-[var(--pob-text-muted)] ml-2">
                    {project.weight}/3 entities ({project.percentage}%)
                  </p>
                </div>
              {/each}
            {:else}
              <!-- Weighted mode - show other projects by score with progress bars -->
              {#if projectScores}
                {#each weightedRunnersUp as project (project.address)}
                  <div class="text-xs space-y-1">
                    <div class="flex items-center justify-between">
                      <p class="text-white italic">
                        {@render projectName(project.address, `Project #${project.id}`)}
                      </p>
                      <p class="text-[var(--pob-text-muted)]">
                        {project.percentage.toFixed(2)}%
                      </p>
                    </div>
                    <div class="score-bar-container">
                      <div
                        class="score-bar-fill"
                        style="width: {Math.min(project.percentage, 100)}%"
                      ></div>
                    </div>
                  </div>
                {/each}
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="space-y-2">
      <p class="text-sm font-semibold text-yellow-400">
        No Winner
      </p>
      <p class="text-xs text-[var(--pob-text-muted)] mb-2">
        {votingMode === 0
          ? 'No project achieved 2-out-of-3 entity majority.'
          : 'No clear winner (tie or insufficient votes).'}
      </p>
      <div class="text-xs text-[var(--pob-text-muted)] space-y-1">
        <p class="font-semibold text-white">Participation:</p>
        {#if isOwner}
          <!-- Owner: Show which entity voted for which project -->
          <!-- Community -->
          <p>
            • Community:{' '}
            {#if entityVotes.community}
              <span class="italic">
                {@render projectName(entityVotes.community, entityVotes.community)}
              </span>
            {:else}
              Did not vote
            {/if}
          </p>
          <!-- DAO HIC - show individual votes if no consensus -->
          {#if entityVotes.daoHic}
            <p>
              • DAO HIC:{' '}
              <span class="italic">
                {@render projectName(entityVotes.daoHic, entityVotes.daoHic)}
              </span>
            </p>
          {:else if Object.keys(daoHicIndividualVotes).length > 0}
            <div>
              <p>• DAO HIC: <span class="text-yellow-400">No consensus</span></p>
              <div class="ml-4 mt-1 space-y-0.5">
                {#each daoHicUniqueProjects as projectAddr (projectAddr)}
                  <p class="text-[var(--pob-text-muted)]">
                    → <span class="italic">
                      {@render projectName(projectAddr, projectAddr)}
                    </span>
                  </p>
                {/each}
              </div>
            </div>
          {:else}
            <p>• DAO HIC: Did not vote</p>
          {/if}
          <!-- SMT -->
          <p>
            • {firstEntityLabel}:{' '}
            {#if firstEntityVoteAddr}
              <span class="italic">
                {@render projectName(firstEntityVoteAddr, firstEntityVoteAddr)}
              </span>
            {:else}
              Did not vote
            {/if}
          </p>
        {:else}
          <!-- Non-owner: Just list projects that received votes (without revealing which entity) -->
          {#each votedProjectAddresses as address (address)}
            <p>
              • <span class="italic">
                {@render projectName(address, address)}
              </span>
            </p>
          {/each}
        {/if}
      </div>
      {#if isThreeWayTie}
        <p class="text-xs text-[var(--pob-text-muted)] mt-2">
          Three-way tie — each entity voted differently
        </p>
      {/if}
    </div>
  {/if}
</div>
