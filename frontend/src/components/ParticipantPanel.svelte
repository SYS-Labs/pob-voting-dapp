<script lang="ts">
  import { Link } from 'svelte-routing';
  import { Contract } from 'ethers';
  import type { ParticipantRole, Badge, PreviousRound } from '~/interfaces';
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
  import { PoB_01ABI, PoB_02ABI } from '~/abis';

  function getPoBContractABI(version: string | undefined) {
    if (version === '001' || version === '002') return PoB_01ABI;
    return PoB_02ABI;
  }

  interface RoleStatuses {
    community: boolean;
    devrel: boolean;
    dao_hic: boolean;
    project: boolean;
  }

  interface RoundEligibility {
    round: number;
    pobAddress: string;
    version: string;
    isProject: boolean;
    hasMinted: boolean;
  }

  interface Props {
    roles: RoleStatuses;
    projectsLocked: boolean;
    votingEnded: boolean;
    pendingAction: string | null;
    walletAddress: string | null;
    badges: Badge[];
    allBadges: Badge[];
    executeMint: (role: ParticipantRole) => void;
    previousRounds?: PreviousRound[];
    signer?: any;
    runTransaction?: (label: string, txFn: () => Promise<any>, refreshFn?: () => Promise<void>) => Promise<boolean>;
    refreshBadges?: () => Promise<void>;
    iterationNumber?: number;
  }

  let {
    roles,
    projectsLocked,
    pendingAction,
    walletAddress,
    badges,
    allBadges,
    executeMint,
    previousRounds,
    signer,
    runTransaction,
    refreshBadges,
    iterationNumber,
  }: Props = $props();

  // Compute eligibility for previous rounds
  const roundEligibilities = $derived.by((): RoundEligibility[] => {
    if (!walletAddress || !previousRounds || previousRounds.length === 0) {
      return [];
    }

    const walletLower = walletAddress.toLowerCase();

    return previousRounds.map(round => {
      const hasMinted = allBadges.some(
        badge => badge.round === round.round && badge.role === 'project'
      );

      const isProject = Array.isArray(round.projects) &&
        round.projects.some(p => p.address.toLowerCase() === walletLower);

      return {
        round: round.round,
        pobAddress: round.pob,
        version: round.version,
        isProject: hasMinted ? false : isProject,
        hasMinted,
      };
    }).filter(e => e.isProject || e.hasMinted);
  });

  async function handlePreviousRoundMint(eligibility: RoundEligibility) {
    if (!signer || !runTransaction || !refreshBadges) return;

    const pobABI = getPoBContractABI(eligibility.version);
    const contract = new Contract(eligibility.pobAddress, pobABI, signer);

    const tx = () => contract.mintProject();
    const label = `Mint Project Badge (Round ${eligibility.round})`;

    await runTransaction(label, tx, refreshBadges);
  }

  const hasPreviousRoundMints = $derived(roundEligibilities.some(e => !e.hasMinted && e.isProject));
  const projectBadge = $derived(badges.find((badge) => badge.role === 'project'));
  const showPanel = $derived(roles.project || hasPreviousRoundMints);
  const unmintedEligibilities = $derived(roundEligibilities.filter(e => !e.hasMinted && e.isProject));
</script>

{#if showPanel}
  <section class="pob-pane">
    <div class="pob-pane__heading">
      <h3 class="pob-pane__title">Participant Panel</h3>
    </div>
    <div class="pob-fieldset space-y-3">
      <div class="flex items-center justify-between">
        <span class="pob-pill {ROLE_COLORS.project}">{ROLE_LABELS.project}</span>
      </div>
      <div class="space-y-2">
        <!-- Current round content -->
        {#if roles.project}
          <p class="text-sm text-[var(--pob-text-muted)]">
            You are registered as a project participant in this iteration. Your project will be evaluated by the jury.
          </p>

          <!-- View Project button -->
          {#if walletAddress && iterationNumber}
            <Link
              to="/iteration/{iterationNumber}/project/{walletAddress}"
              class="pob-button pob-button--outline w-full justify-center text-xs"
            >
              Manage my project
            </Link>
          {/if}

          <!-- Mint button -->
          {#if !projectBadge && projectsLocked}
            <button
              type="button"
              onclick={() => void executeMint('project')}
              class="pob-button w-full justify-center text-xs"
              disabled={pendingAction !== null || !walletAddress}
            >
              {pendingAction === 'Mint Project Badge' ? 'Minting…' : 'Mint project badge'}
            </button>
          {/if}
          {#if !projectBadge && !projectsLocked}
            <p class="text-xs text-[var(--pob-text-muted)] italic">
              Badge minting available when voting starts
            </p>
          {/if}
        {/if}

        <!-- Previous round only -->
        {#if !roles.project && hasPreviousRoundMints}
          <p class="text-sm text-[var(--pob-text-muted)]">
            You participated as a project in previous rounds of this iteration.
          </p>
        {/if}

        <!-- Previous Rounds Badge Minting -->
        {#if unmintedEligibilities.length > 0}
          <div class="{roles.project ? 'pt-3 border-t border-[var(--pob-border)]' : ''}">
            <p class="text-xs text-[var(--pob-text-muted)] mb-2">
              Previous round badges available:
            </p>
            <div class="space-y-2">
              {#each unmintedEligibilities as eligibility (eligibility.round)}
                <div class="flex items-center justify-between gap-2 p-2 bg-[var(--pob-surface)] rounded">
                  <span class="text-xs text-[var(--pob-text-muted)]">
                    Round {eligibility.round}
                  </span>
                  <button
                    type="button"
                    onclick={() => void handlePreviousRoundMint(eligibility)}
                    class="pob-button text-xs"
                    disabled={pendingAction !== null || !walletAddress}
                  >
                    {pendingAction?.includes(`Round ${eligibility.round}`) ? 'Minting…' : 'Mint badge'}
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </section>
{/if}
