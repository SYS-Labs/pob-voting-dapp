<script lang="ts">
  import type { Iteration } from '~/interfaces';
  import { formatAddress } from '~/utils';
  import Modal from './Modal.svelte';
  import { createWriteDispatcher } from '~/utils/writeDispatch';
  import { REGISTRY_ADDRESSES } from '~/utils/registry';
  import PoBRegistryABI from '~/abis/PoBRegistry.json';
  import { Contract } from 'ethers';

  interface StatusFlags {
    isActive: boolean;
    votingEnded: boolean;
  }

  interface Winner {
    projectAddress: string | null;
    hasWinner: boolean;
  }

  interface Props {
    currentIteration: Iteration;
    statusFlags: StatusFlags;
    projectsLocked: boolean;
    contractLocked: boolean;
    smtVoters: string[];
    daoHicVoters: string[];
    winner: Winner;
    pendingAction: string | null;
    openAdminSection: string | null;
    signer: any;
    votingMode: number;
    setVotingMode: (mode: number, refreshCallback?: () => Promise<void>) => Promise<void>;
    getProjectLabel: (address: string | null) => string | null;
    handleToggleAdminSection: (sectionId: string) => void;
    runTransaction: (label: string, txFn: () => Promise<any>, refreshFn?: () => Promise<void>) => Promise<boolean>;
    refreshVotingData: () => Promise<void>;
    refreshProjects: () => Promise<void>;
    refreshOwnerData: () => Promise<void>;
    refreshBadges: () => Promise<void>;
    setPendingRemovalVoter: (voter: string | null) => void;
    setError: (error: string) => void;
    registryInitComplete: boolean | null;
    refreshRegistryInitStatus: () => void;
  }

  let {
    currentIteration,
    statusFlags,
    projectsLocked,
    contractLocked,
    smtVoters,
    daoHicVoters,
    winner,
    pendingAction,
    openAdminSection,
    signer,
    votingMode,
    setVotingMode,
    getProjectLabel,
    handleToggleAdminSection,
    runTransaction,
    refreshVotingData,
    refreshProjects,
    refreshOwnerData,
    refreshBadges,
    setPendingRemovalVoter,
    setError,
    registryInitComplete,
    refreshRegistryInitStatus,
  }: Props = $props();

  let showActivationConfirm = $state(false);
  let activationMode = $state<'activate' | 'deactivate'>('activate');

  async function handleActivationAction() {
    if (!signer || !currentIteration) return;

    const writer = createWriteDispatcher(currentIteration, signer);

    if (activationMode === 'activate') {
      if (statusFlags.isActive || statusFlags.votingEnded) {
        showActivationConfirm = false;
        return;
      }

      const success = await runTransaction(
        'Activate Program',
        () => writer.activate(),
        refreshVotingData,
      );

      if (success) {
        showActivationConfirm = false;
      }
    } else {
      if (!statusFlags.isActive || statusFlags.votingEnded) {
        showActivationConfirm = false;
        return;
      }

      const success = await runTransaction(
        'End Voting Early',
        () => writer.closeManually(),
        async () => {
          await Promise.all([
            refreshVotingData(),
            refreshOwnerData(),
            refreshBadges(),
          ]);
        },
      );

      if (success) {
        showActivationConfirm = false;
      }
    }
  }

  const isBusy = $derived(pendingAction !== null);
  const canActivate = $derived(!statusFlags.isActive && !statusFlags.votingEnded);
  const canDeactivate = $derived(statusFlags.isActive && !statusFlags.votingEnded);

  const primaryButtonLabel = $derived(
    canDeactivate ? 'End Voting Now' :
    canActivate ? 'Activate Now' :
    statusFlags.votingEnded ? 'Voting Ended' : 'Activation Unavailable'
  );

  const activationHint = $derived(
    canDeactivate ? 'End the 48-hour voting window early. This finalizes results immediately.' :
    canActivate ? 'Start the 48-hour voting window' :
    statusFlags.votingEnded ? 'Voting already ended for this iteration.' : 'Activation is currently unavailable.'
  );

  const primaryButtonDisabled = $derived(isBusy || (!canActivate && !canDeactivate));
  const primaryButtonClass = $derived(`pob-button pob-button--full${canDeactivate ? ' pob-button--danger' : ''}`);
  const isDeactivateMode = $derived(activationMode === 'deactivate');

  const modalTitle = $derived(isDeactivateMode ? 'End Voting Early?' : 'Start Voting Window?');
  const modalBody = $derived(
    isDeactivateMode
      ? 'Ending the voting window immediately finalizes vote totals and prevents any further ballots. This cannot be undone.'
      : 'Starting the 48-hour voting window locks project registration and opens voting to jurors right away. This cannot be undone.'
  );
  const modalPrompt = $derived(
    isDeactivateMode ? 'Do you want to end the voting window right now?' : 'Do you want to activate the program right now?'
  );
  const confirmLabel = $derived(
    isDeactivateMode ? (isBusy ? 'Ending...' : 'Yes, end voting') : (isBusy ? 'Activating...' : 'Yes, activate now')
  );
  const confirmClass = $derived(`pob-button flex-1 justify-center${isDeactivateMode ? ' pob-button--danger' : ''}`);

  async function handleCompleteInitialization() {
    if (!signer || !currentIteration?.chainId) return;
    const registryAddress = REGISTRY_ADDRESSES[currentIteration.chainId];
    if (!registryAddress) return;
    const registry = new Contract(registryAddress, PoBRegistryABI, signer);
    const success = await runTransaction(
      'Open Project Editing',
      () => registry.completeInitialization(),
    );
    if (success) {
      refreshRegistryInitStatus();
    }
  }

  function handlePrimaryClick() {
    if (primaryButtonDisabled) return;
    activationMode = canDeactivate ? 'deactivate' : 'activate';
    showActivationConfirm = true;
  }

  async function handleRegisterProject() {
    const addressInput = document.getElementById('project-address') as HTMLInputElement;
    const address = addressInput?.value?.trim();
    if (!address || !signer || !currentIteration) {
      setError('Please enter an address');
      return;
    }
    const writer = createWriteDispatcher(currentIteration, signer);
    await runTransaction('Register Project', () => writer.registerProject(address), refreshProjects);
    if (addressInput) addressInput.value = '';
  }

  async function handleAddSmtVoter() {
    const input = document.getElementById('smt-address') as HTMLInputElement;
    const address = input?.value?.trim();
    if (!address || !signer || !currentIteration) {
      setError('Please enter an address');
      return;
    }
    const writer = createWriteDispatcher(currentIteration, signer);
    await runTransaction('Add SMT Voter', () => writer.addSmtVoter(address), refreshOwnerData);
    if (input) input.value = '';
  }

  async function handleAddDaoHic() {
    const input = document.getElementById('daohic-address') as HTMLInputElement;
    const address = input?.value?.trim();
    if (!address || !signer || !currentIteration) {
      setError('Please enter an address');
      return;
    }
    const writer = createWriteDispatcher(currentIteration, signer);
    await runTransaction('Add DAO HIC Voter', () => writer.addDaoHicVoter(address), refreshOwnerData);
    if (input) input.value = '';
  }

  async function handleLockContract() {
    if (!signer || !currentIteration) return;
    const writer = createWriteDispatcher(currentIteration, signer);
    await runTransaction('Lock Contract for History', () => writer.lockContractForHistory(), refreshProjects);
  }

  async function handleToggleVotingMode() {
    const newMode = votingMode === 0 ? 1 : 0;
    await setVotingMode(newMode, refreshVotingData);
  }
</script>

<section class="pob-pane">
  <div class="pob-pane__heading">
    <h3 class="pob-pane__title">Owner Panel</h3>
    <span class="pob-pill pob-pill--admin">Admin</span>
  </div>
  <div class="pob-admin-accordion">
    <!-- Manage Program -->
    <article class="pob-accordion-item{openAdminSection === 'activate' ? ' is-open' : ''}">
      <button
        type="button"
        class="pob-accordion-trigger"
        onclick={() => handleToggleAdminSection('activate')}
        aria-expanded={openAdminSection === 'activate'}
        aria-controls="owner-activate"
      >
        <span>Manage Program</span>
        <svg
          class="pob-accordion-icon{openAdminSection === 'activate' ? ' is-open' : ''}"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="M2.25 4.5 6 8.25 9.75 4.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      {#if openAdminSection === 'activate'}
        <div class="pob-accordion-content space-y-3" id="owner-activate">
          {#if registryInitComplete === false}
            <div class="space-y-3" style="padding-bottom: 0.75rem; border-bottom: 1px solid var(--pob-border);">
              <p class="text-sm text-[var(--pob-text-muted)]">
                The metadata registry is in <strong class="text-white">initialization mode</strong>. While in this mode, the registry owner can set metadata on behalf of any project. Once you open project editing:
              </p>
              <ul class="text-sm text-[var(--pob-text-muted)]" style="padding-left: 1.25rem; list-style: disc; line-height: 1.7;">
                <li>Each project wallet manages its own metadata independently</li>
                <li>The registry owner can no longer edit project metadata on behalf of others</li>
                <li>Iteration metadata becomes read-only for iterations with a locked contract</li>
              </ul>
              <button
                type="button"
                onclick={handleCompleteInitialization}
                disabled={isBusy}
                class="pob-button pob-button--outline pob-button--full"
              >
                Open Project Editing
              </button>
            </div>
          {/if}
          <p class="pob-form-hint">{activationHint}</p>
          <button
            type="button"
            onclick={handlePrimaryClick}
            disabled={primaryButtonDisabled}
            class={primaryButtonClass}
          >
            {primaryButtonLabel}
          </button>
        </div>
      {/if}
    </article>

    <!-- Voting Mode -->
    {#if !statusFlags.isActive && !statusFlags.votingEnded}
      <article class="pob-accordion-item{openAdminSection === 'voting_mode' ? ' is-open' : ''}">
        <button
          type="button"
          class="pob-accordion-trigger"
          onclick={() => handleToggleAdminSection('voting_mode')}
          aria-expanded={openAdminSection === 'voting_mode'}
          aria-controls="owner-voting-mode"
        >
          <span>Voting Mode</span>
          <svg
            class="pob-accordion-icon{openAdminSection === 'voting_mode' ? ' is-open' : ''}"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M2.25 4.5 6 8.25 9.75 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        {#if openAdminSection === 'voting_mode'}
          <div class="pob-accordion-content" id="owner-voting-mode">
            <p class="text-sm text-[var(--pob-text-muted)]">
              Current mode: <span class="text-white font-semibold">{votingMode === 0 ? '🎯 Consensus' : '⚖️ Weighted'}</span>
            </p>
            <p class="pob-form-hint" style="margin-top: 0.75rem;">
              {votingMode === 0
                ? 'Consensus mode: Winner must receive votes from at least 2 out of 3 entities (SMT, DAO HIC, Community).'
                : 'Weighted mode: Each entity has 1/3 weight. Winner has the highest proportional score across all entities.'}
            </p>
            <button
              type="button"
              onclick={handleToggleVotingMode}
              disabled={pendingAction !== null}
              class="pob-button pob-button--outline pob-button--full"
              style="margin-top: 0.75rem;"
            >
              Switch to {votingMode === 0 ? '⚖️ Weighted' : '🎯 Consensus'}
            </button>
            <p class="pob-form-hint" style="margin-top: 0.75rem;">
              ⚠️ Voting mode cannot be changed after activation.
            </p>
          </div>
        {/if}
      </article>
    {/if}

    <!-- Register Project -->
    {#if !statusFlags.votingEnded}
      <article class="pob-accordion-item{openAdminSection === 'projects' ? ' is-open' : ''}">
        <button
          type="button"
          class="pob-accordion-trigger"
          onclick={() => handleToggleAdminSection('projects')}
          aria-expanded={openAdminSection === 'projects'}
          aria-controls="owner-projects"
        >
          <span>Manage Projects</span>
          <svg
            class="pob-accordion-icon{openAdminSection === 'projects' ? ' is-open' : ''}"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M2.25 4.5 6 8.25 9.75 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        {#if openAdminSection === 'projects'}
          <div class="pob-accordion-content" id="owner-projects">
            <div class="pob-fieldset pob-form-group">
              <input
                type="text"
                placeholder="Project address (0x...)"
                id="project-address"
                class="pob-input"
                disabled={projectsLocked}
              />
              <button
                type="button"
                onclick={handleRegisterProject}
                disabled={pendingAction !== null || projectsLocked}
                class="pob-button pob-button--outline pob-button--full"
              >
                Register Project
              </button>
            </div>
            {#if projectsLocked}
              <p class="pob-form-hint" style="margin-top: 0.75rem;">
                Projects are locked after activation. Registration and removal are disabled.
              </p>
            {/if}
            <p class="pob-form-hint" style="margin-top: 0.75rem;">
              View and manage all registered projects in the Projects section above. Remove buttons appear next to each project when unlocked.
            </p>
          </div>
        {/if}
      </article>
    {/if}

    <!-- SMT Voters -->
    {#if !statusFlags.votingEnded}
      <article class="pob-accordion-item{openAdminSection === 'smt' ? ' is-open' : ''}">
        <button
          type="button"
          class="pob-accordion-trigger"
          onclick={() => handleToggleAdminSection('smt')}
          aria-expanded={openAdminSection === 'smt'}
          aria-controls="owner-smt"
        >
          <span>SMT Voters</span>
          <svg
            class="pob-accordion-icon{openAdminSection === 'smt' ? ' is-open' : ''}"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M2.25 4.5 6 8.25 9.75 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        {#if openAdminSection === 'smt'}
          <div class="pob-accordion-content" id="owner-smt">
            {#if smtVoters.length}
              <ul class="pob-admin-voter-list">
                {#each smtVoters as voter, index (voter)}
                  <li class="pob-admin-voter">
                    <div class="pob-admin-voter__info">
                      <span class="pob-admin-voter__badge">#{index + 1}</span>
                      <div>
                        <p class="pob-admin-voter__label">SMT voter</p>
                        <p class="pob-admin-voter__brief">{formatAddress(voter)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onclick={() => setPendingRemovalVoter(voter)}
                      disabled={pendingAction !== null}
                      class="pob-button pob-button--outline pob-button--small"
                    >
                      Remove
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <div class="text-sm text-[var(--pob-text-muted)]" style="padding: 0 1.25rem;">
                No SMT voters registered yet.
              </div>
            {/if}
            {#if currentIteration?.version !== '003' && smtVoters.length >= 1}
              <p class="pob-form-hint" style="margin-top: 0.75rem; padding: 0 1.25rem;">
                This iteration supports only 1 SMT voter.
              </p>
            {:else}
              <div class="pob-fieldset pob-form-group" style="margin-top: 1rem;">
                <input
                  type="text"
                  placeholder="SMT voter address (0x...)"
                  id="smt-address"
                  class="pob-input"
                />
                <button
                  type="button"
                  onclick={handleAddSmtVoter}
                  disabled={pendingAction !== null}
                  class="pob-button pob-button--outline pob-button--full"
                >
                  Add Voter
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </article>
    {/if}

    <!-- Add DAO HIC Voter -->
    {#if !statusFlags.votingEnded}
      <article class="pob-accordion-item{openAdminSection === 'dao_hic' ? ' is-open' : ''}">
        <button
          type="button"
          class="pob-accordion-trigger"
          onclick={() => handleToggleAdminSection('dao_hic')}
          aria-expanded={openAdminSection === 'dao_hic'}
          aria-controls="owner-daohic"
        >
          <span>DAO HIC Voters</span>
          <svg
            class="pob-accordion-icon{openAdminSection === 'dao_hic' ? ' is-open' : ''}"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M2.25 4.5 6 8.25 9.75 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        {#if openAdminSection === 'dao_hic'}
          <div class="pob-accordion-content" id="owner-daohic">
            {#if daoHicVoters.length}
              <ul class="pob-admin-voter-list">
                {#each daoHicVoters as voter, index (voter)}
                  <li class="pob-admin-voter">
                    <div class="pob-admin-voter__info">
                      <span class="pob-admin-voter__badge">#{index + 1}</span>
                      <div>
                        <p class="pob-admin-voter__label">DAO HIC voter</p>
                        <p class="pob-admin-voter__brief">{formatAddress(voter)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onclick={() => setPendingRemovalVoter(voter)}
                      disabled={pendingAction !== null}
                      class="pob-button pob-button--outline pob-button--small"
                    >
                      Remove
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <div class="text-sm text-[var(--pob-text-muted)]" style="padding: 0 1.25rem;">
                No DAO HIC voters registered yet.
              </div>
            {/if}
            <div class="pob-fieldset pob-form-group" style="margin-top: 1rem;">
              <input
                type="text"
                placeholder="DAO HIC voter address (0x...)"
                id="daohic-address"
                class="pob-input"
              />
              <button
                type="button"
                onclick={handleAddDaoHic}
                disabled={pendingAction !== null}
                class="pob-button pob-button--outline pob-button--full"
              >
                Add Voter
              </button>
            </div>
          </div>
        {/if}
      </article>
    {/if}

    <!-- Lock Contract for History -->
    {#if statusFlags.votingEnded}
      <article class="pob-accordion-item{openAdminSection === 'lock' ? ' is-open' : ''}">
        <button
          type="button"
          class="pob-accordion-trigger"
          onclick={() => handleToggleAdminSection('lock')}
          aria-expanded={openAdminSection === 'lock'}
          aria-controls="owner-lock"
        >
          <span>Lock Contract</span>
          <svg
            class="pob-accordion-icon{openAdminSection === 'lock' ? ' is-open' : ''}"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M2.25 4.5 6 8.25 9.75 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        {#if openAdminSection === 'lock'}
          <div class="pob-accordion-content" id="owner-lock">
            <div class="space-y-3">
              <p class="text-sm text-[var(--pob-text-muted)]">
                Lock the contract for history after voting ends. This preserves the final state (winner or no consensus) permanently and is irreversible.
              </p>
              {#if contractLocked}
                <p class="text-sm font-semibold text-[var(--pob-primary)]">
                  Contract is locked for history
                </p>
              {/if}
              {#if !contractLocked && statusFlags.votingEnded}
                {#if winner.hasWinner}
                  <p class="text-sm text-white">
                    Winner:{' '}
                    <span class="italic">
                      {getProjectLabel(winner.projectAddress) ?? 'Unknown'}
                    </span>
                  </p>
                {:else}
                  <p class="text-sm text-[var(--pob-text-muted)]">
                    No consensus reached (tie or insufficient votes)
                  </p>
                {/if}
              {/if}
              <button
                type="button"
                onclick={handleLockContract}
                disabled={pendingAction !== null || contractLocked || !statusFlags.votingEnded}
                class="pob-button pob-button--full"
              >
                {contractLocked ? 'Already Locked' : 'Lock Contract'}
              </button>
              {#if !statusFlags.votingEnded}
                <p class="pob-form-hint">
                  Contract can only be locked after voting has ended.
                </p>
              {/if}
            </div>
          </div>
        {/if}
      </article>
    {/if}

    <Modal
      isOpen={showActivationConfirm}
      onClose={() => {
        if (!isBusy) showActivationConfirm = false;
      }}
      maxWidth="md"
      closeOnBackdropClick={!isBusy}
      closeOnEscape={!isBusy}
      showCloseButton={!isBusy}
    >
      {#snippet children()}
        <div class="pob-pane space-y-5">
          <h2 class="text-xl font-bold text-white">{modalTitle}</h2>
          <div class="pob-warning">
            <p class="pob-warning__headline">THIS ACTION IS IRREVERSIBLE</p>
            <p class="pob-warning__body">{modalBody}</p>
          </div>
          <p class="text-sm text-[var(--pob-text-muted)]">{modalPrompt}</p>
          <div class="flex gap-3 pt-1">
            <button
              type="button"
              onclick={() => {
                if (!isBusy) showActivationConfirm = false;
              }}
              disabled={isBusy}
              class="pob-button pob-button--outline flex-1 justify-center"
            >
              Cancel
            </button>
            <button
              type="button"
              onclick={() => void handleActivationAction()}
              disabled={isBusy}
              class={confirmClass}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      {/snippet}
    </Modal>
  </div>
</section>
