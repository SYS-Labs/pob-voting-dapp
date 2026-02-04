<script lang="ts">
  import Modal from './Modal.svelte';
  import type { ParticipantRole } from '~/interfaces';
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    projectName: string;
    projectAddress: string;
    votingRole: ParticipantRole | null;
    hasVotedForProject: boolean;
    hasBadge: boolean;
    executeMint?: (role: ParticipantRole, refreshCallback?: () => Promise<void>) => Promise<void>;
    refreshBadges?: () => Promise<void>;
    mintAmount?: string;
    tokenSymbol?: string;
    isPending: boolean;
    pendingAction?: string | null;
  }

  let {
    isOpen,
    onClose,
    onConfirm,
    projectName,
    projectAddress,
    votingRole,
    hasVotedForProject,
    hasBadge,
    executeMint,
    refreshBadges,
    mintAmount = '30',
    tokenSymbol = 'TSYS',
    isPending,
    pendingAction,
  }: Props = $props();

  const showMintFlow = $derived(votingRole === 'community' && !hasBadge);
  const roleInfo = $derived(
    votingRole && ROLE_LABELS[votingRole]
      ? { label: ROLE_LABELS[votingRole], color: ROLE_COLORS[votingRole] }
      : null
  );

  async function handleMint() {
    if (executeMint) {
      await executeMint('community', refreshBadges);
    }
  }
</script>

<Modal
  {isOpen}
  {onClose}
  maxWidth="md"
  closeOnBackdropClick={!isPending}
  closeOnEscape={!isPending}
  showCloseButton={!isPending}
>
  {#snippet children()}
    <div class="pob-pane">
      {#if showMintFlow}
        <!-- Community without badge - mint flow -->
        <h2 class="pob-pane__title mb-3">Mint Badge to Vote</h2>
        <p class="text-sm text-[var(--pob-text-muted)] mb-4">
          As a community juror, you must mint a badge to participate in voting.
          The badge requires a {mintAmount} {tokenSymbol} deposit, which you can reclaim after voting ends.
        </p>

        <div class="pob-fieldset mb-4">
          <span class="pob-label">Project you want to vote for</span>
          <div class="text-sm">
            <p class="font-semibold text-white">{projectName}</p>
            <p class="pob-mono text-xs text-[var(--pob-text-muted)] mt-1">
              {projectAddress}
            </p>
          </div>
        </div>

        <p class="text-xs text-[var(--pob-text-muted)] italic mb-4">
          After minting, you can vote on any project during the voting period.
        </p>

        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={onClose}
            disabled={isPending}
            class="pob-button pob-button--outline flex-1 justify-center"
          >
            Cancel
          </button>
          {#if executeMint}
            <button
              type="button"
              onclick={handleMint}
              disabled={isPending}
              class="pob-button flex-1 justify-center"
            >
              {pendingAction === 'Mint Community Badge' ? 'Minting...' : `Mint Badge (${mintAmount} ${tokenSymbol})`}
            </button>
          {/if}
        </div>
      {:else}
        <!-- Normal vote confirmation -->
        <h2 class="pob-pane__title mb-3">
          {hasVotedForProject ? 'Change Vote' : 'Confirm Vote'}
        </h2>

        <div class="pob-fieldset mb-4">
          <span class="pob-label">Project</span>
          <div class="text-sm">
            <p class="font-semibold text-white">{projectName}</p>
            <p class="pob-mono text-xs text-[var(--pob-text-muted)] mt-1">
              {projectAddress}
            </p>
          </div>
        </div>

        {#if roleInfo}
          <div class="pob-fieldset mb-4">
            <span class="pob-label">Voting as</span>
            <span class="pob-pill {roleInfo.color}">
              {roleInfo.label}
            </span>
          </div>
        {/if}

        {#if hasVotedForProject}
          <p class="text-sm text-[var(--pob-text-muted)] mb-4">
            Your previous vote will be replaced with this selection.
          </p>
        {/if}

        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={onClose}
            disabled={isPending}
            class="pob-button pob-button--outline flex-1 justify-center"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={onConfirm}
            disabled={isPending}
            class="pob-button flex-1 justify-center"
          >
            {isPending ? 'Confirming…' : 'Confirm Vote'}
          </button>
        </div>
      {/if}
    </div>
  {/snippet}
</Modal>
