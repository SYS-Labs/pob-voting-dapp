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
    executeMint?: (role: ParticipantRole, refreshCallback?: () => Promise<void>, communityAmount?: string) => Promise<void>;
    refreshBadges?: () => Promise<void>;
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

  let donationAmount = $state('');

  $effect(() => {
    if (!isOpen) {
      donationAmount = '';
    }
  });

  async function handleMint() {
    if (executeMint) {
      await executeMint('community', refreshBadges, donationAmount);
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
        <h2 class="pob-pane__title mb-3">Mint Badge to Vote</h2>
        <p class="text-sm text-[var(--pob-text-muted)] mb-4">
          As a community juror, you must mint a badge to participate in voting. You can mint for free or optionally donate any desired amount of {tokenSymbol}. Any donation is forwarded directly to the configured PoB donation address.
        </p>

        <label class="pob-fieldset mb-4 block">
          <span class="pob-label">Optional donation amount ({tokenSymbol})</span>
          <input
            type="number"
            min="0"
            step="any"
            inputmode="decimal"
            bind:value={donationAmount}
            class="pob-input mt-2 w-full"
            placeholder="0"
            disabled={isPending}
          />
          <p class="mt-2 text-xs text-[var(--pob-text-muted)]">Leave this blank to mint for free.</p>
        </label>

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
              {#if pendingAction === 'Mint Community Badge'}
                Minting...
              {:else if donationAmount.trim() !== ''}
                Mint Badge + Donate {donationAmount.trim()} {tokenSymbol}
              {:else}
                Mint Badge for Free
              {/if}
            </button>
          {/if}
        </div>
      {:else}
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
