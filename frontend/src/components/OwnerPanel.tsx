import { useState } from 'react';
import { Contract } from 'ethers';
import type { Iteration } from '~/interfaces';
import { formatAddress } from '~/utils';
import Modal from './Modal';

interface StatusFlags {
  isActive: boolean;
  votingEnded: boolean;
}

interface Winner {
  projectAddress: string | null;
  hasWinner: boolean;
}

interface OwnerPanelProps {
  currentIteration: Iteration;
  statusFlags: StatusFlags;
  projectsLocked: boolean;
  contractLocked: boolean;
  devRelAccount: string | null;
  daoHicVoters: string[];
  winner: Winner;
  pendingAction: string | null;
  openAdminSection: string | null;
  signer: any;
  JurySC_01ABI: any;
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
  setError: (error: string | null) => void;
}

const OwnerPanel = ({
  currentIteration,
  statusFlags,
  projectsLocked,
  contractLocked,
  devRelAccount,
  daoHicVoters,
  winner,
  pendingAction,
  openAdminSection,
  signer,
  JurySC_01ABI,
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
}: OwnerPanelProps) => {
  const [showActivationConfirm, setShowActivationConfirm] = useState(false);
  const [activationMode, setActivationMode] = useState<'activate' | 'deactivate'>('activate');

  const handleActivationAction = async () => {
    if (!signer || !currentIteration) return;

    const contract = new Contract(currentIteration.jurySC, JurySC_01ABI, signer);

    if (activationMode === 'activate') {
      if (statusFlags.isActive || statusFlags.votingEnded) {
        setShowActivationConfirm(false);
        return;
      }

      const success = await runTransaction(
        'Activate Program',
        () => contract.activate(),
        refreshVotingData,
      );

      if (success) {
        setShowActivationConfirm(false);
      }
    } else {
      if (!statusFlags.isActive || statusFlags.votingEnded) {
        setShowActivationConfirm(false);
        return;
      }

      const success = await runTransaction(
        'End Voting Early',
        () => contract.closeManually(),
        async () => {
          // Refresh all state after manual close
          await Promise.all([
            refreshVotingData(),
            refreshOwnerData(),
            refreshBadges(),
          ]);
        },
      );

      if (success) {
        setShowActivationConfirm(false);
      }
    }
  };

  const isBusy = pendingAction !== null;
  const canActivate = !statusFlags.isActive && !statusFlags.votingEnded;
  const canDeactivate = statusFlags.isActive && !statusFlags.votingEnded;
  const primaryButtonLabel = canDeactivate
    ? 'End Voting Now'
    : canActivate
      ? 'Activate Now'
      : statusFlags.votingEnded
        ? 'Voting Ended'
        : 'Activation Unavailable';
  const activationHint = canDeactivate
    ? 'End the 48-hour voting window early. This finalizes results immediately.'
    : canActivate
      ? 'Start the 48-hour voting window'
      : statusFlags.votingEnded
        ? 'Voting already ended for this iteration.'
        : 'Activation is currently unavailable.';
  const primaryButtonDisabled = isBusy || (!canActivate && !canDeactivate);
  const primaryButtonClass = `pob-button pob-button--full${canDeactivate ? ' pob-button--danger' : ''}`;
  const isDeactivateMode = activationMode === 'deactivate';
  const modalTitle = isDeactivateMode ? 'End Voting Early?' : 'Start Voting Window?';
  const modalBody = isDeactivateMode
    ? 'Ending the voting window immediately finalizes vote totals and prevents any further ballots. This cannot be undone.'
    : 'Starting the 48-hour voting window locks project registration and opens voting to jurors right away. This cannot be undone.';
  const modalPrompt = isDeactivateMode
    ? 'Do you want to end the voting window right now?'
    : 'Do you want to activate the program right now?';
  const confirmLabel = isDeactivateMode
    ? isBusy
      ? 'Ending...'
      : 'Yes, end voting'
    : isBusy
      ? 'Activating...'
      : 'Yes, activate now';
  const confirmClass = `pob-button flex-1 justify-center${isDeactivateMode ? ' pob-button--danger' : ''}`;

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <h3 className="pob-pane__title">Owner Panel</h3>
        <span className="pob-pill pob-pill--admin">Admin</span>
      </div>
      <div className="pob-admin-accordion">
        {/* Manage Program */}
        <article
          className={`pob-accordion-item${openAdminSection === 'activate' ? ' is-open' : ''}`}
        >
          <button
            type="button"
            className="pob-accordion-trigger"
            onClick={() => handleToggleAdminSection('activate')}
            aria-expanded={openAdminSection === 'activate'}
            aria-controls="owner-activate"
          >
            <span>Manage Program</span>
            <svg
              className={`pob-accordion-icon${openAdminSection === 'activate' ? ' is-open' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M2.25 4.5 6 8.25 9.75 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {openAdminSection === 'activate' ? (
            <div className="pob-accordion-content space-y-3" id="owner-activate">
              <p className="pob-form-hint">{activationHint}</p>
              <button
                type="button"
                onClick={() => {
                  if (primaryButtonDisabled) return;
                  setActivationMode(canDeactivate ? 'deactivate' : 'activate');
                  setShowActivationConfirm(true);
                }}
                disabled={primaryButtonDisabled}
                className={primaryButtonClass}
              >
                {primaryButtonLabel}
              </button>
            </div>
          ) : null}
        </article>

        {/* Voting Mode - Only show before activation */}
        {!statusFlags.isActive && !statusFlags.votingEnded && (
          <article
            className={`pob-accordion-item${openAdminSection === 'voting_mode' ? ' is-open' : ''}`}
          >
            <button
              type="button"
              className="pob-accordion-trigger"
              onClick={() => handleToggleAdminSection('voting_mode')}
              aria-expanded={openAdminSection === 'voting_mode'}
              aria-controls="owner-voting-mode"
            >
              <span>Voting Mode</span>
              <svg
                className={`pob-accordion-icon${openAdminSection === 'voting_mode' ? ' is-open' : ''}`}
                width="12"
                height="12"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path
                  d="M2.25 4.5 6 8.25 9.75 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {openAdminSection === 'voting_mode' ? (
              <div className="pob-accordion-content" id="owner-voting-mode">
                <p className="text-sm text-[var(--pob-text-muted)]">
                  Current mode: <span className="text-white font-semibold">{votingMode === 0 ? '🎯 Consensus' : '⚖️ Weighted'}</span>
                  {typeof currentIteration.votingMode === 'number' && (
                    <span className="text-xs text-[var(--pob-text-muted)]"> (read-only)</span>
                  )}
                </p>
                <p className="pob-form-hint" style={{ marginTop: '0.75rem' }}>
                  {votingMode === 0
                    ? 'Consensus mode: Winner must receive votes from at least 2 out of 3 entities (DevRel, DAO HIC, Community).'
                    : 'Weighted mode: Each entity has 1/3 weight. Winner has the highest proportional score across all entities.'}
                </p>
                {typeof currentIteration.votingMode === 'number' ? (
                  <p className="pob-form-hint" style={{ marginTop: '0.75rem' }}>
                    ⚠️ Voting mode is set in iterations.json and cannot be changed from UI.
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        const newMode = votingMode === 0 ? 1 : 0;
                        await setVotingMode(newMode, refreshVotingData);
                      }}
                      disabled={pendingAction !== null}
                      className="pob-button pob-button--outline pob-button--full"
                      style={{ marginTop: '0.75rem' }}
                    >
                      Switch to {votingMode === 0 ? '⚖️ Weighted' : '🎯 Consensus'}
                    </button>
                    <p className="pob-form-hint" style={{ marginTop: '0.75rem' }}>
                      ⚠️ Voting mode cannot be changed after activation.
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </article>
        )}

        {/* Register Project - Only show before voting ends */}
        {!statusFlags.votingEnded && (
          <article
            className={`pob-accordion-item${openAdminSection === 'projects' ? ' is-open' : ''}`}
          >
            <button
              type="button"
              className="pob-accordion-trigger"
              onClick={() => handleToggleAdminSection('projects')}
              aria-expanded={openAdminSection === 'projects'}
              aria-controls="owner-projects"
            >
              <span>Manage Projects</span>
            <svg
              className={`pob-accordion-icon${openAdminSection === 'projects' ? ' is-open' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M2.25 4.5 6 8.25 9.75 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {openAdminSection === 'projects' ? (
            <div className="pob-accordion-content" id="owner-projects">
              <div className="pob-fieldset pob-form-group">
                  <input
                    type="text"
                    placeholder="Project address (0x...)"
                    id="project-address"
                    className="pob-input"
                    disabled={projectsLocked}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const addressInput = document.getElementById('project-address') as HTMLInputElement;
                      const address = addressInput?.value?.trim();
                      if (!address || !signer || !currentIteration) {
                        setError('Please enter an address');
                        return;
                      }
                      const contract = new Contract(currentIteration?.jurySC, JurySC_01ABI, signer);
                      await runTransaction(
                        'Register Project',
                        () => contract.registerProject(address),
                        refreshProjects,
                      );
                      if (addressInput) addressInput.value = '';
                    }}
                    disabled={pendingAction !== null || projectsLocked}
                    className="pob-button pob-button--outline pob-button--full"
                  >
                    Register Project
                  </button>
                </div>
              {projectsLocked ? (
                <p className="pob-form-hint" style={{ marginTop: '0.75rem' }}>
                  Projects are locked after activation. Registration and removal are disabled.
                </p>
              ) : null}
              <p className="pob-form-hint" style={{ marginTop: '0.75rem' }}>
                View and manage all registered projects in the Projects section above. Remove buttons appear next to each project when unlocked.
              </p>
            </div>
          ) : null}
        </article>
        )}

        {/* Set DevRel Account - Only show before voting ends */}
        {!statusFlags.votingEnded && (
          <article
            className={`pob-accordion-item${openAdminSection === 'devrel' ? ' is-open' : ''}`}
          >
            <button
              type="button"
              className="pob-accordion-trigger"
              onClick={() => handleToggleAdminSection('devrel')}
              aria-expanded={openAdminSection === 'devrel'}
              aria-controls="owner-devrel"
            >
              <span>DevRel Account</span>
            <svg
              className={`pob-accordion-icon${openAdminSection === 'devrel' ? ' is-open' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M2.25 4.5 6 8.25 9.75 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {openAdminSection === 'devrel' ? (
            <div className="pob-accordion-content" id="owner-devrel">
              <div className="space-y-3">
                <p className="pob-admin-devrel">
                  <span className="pob-admin-devrel__label">Current DevRel</span>
                  <span className="pob-admin-devrel__value">{devRelAccount ?? 'Not set'}</span>
                </p>
                <div className="pob-fieldset pob-form-group">
                  <p className="pob-form-label">Set DevRel Account</p>
                  <input
                    type="text"
                    placeholder="DevRel address (0x...)"
                    id="devrel-address"
                    className="pob-input"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const input = document.getElementById('devrel-address') as HTMLInputElement;
                      const address = input?.value?.trim();
                      if (!address || !signer || !currentIteration) {
                        setError('Please enter an address');
                        return;
                      }
                      const contract = new Contract(currentIteration?.jurySC, JurySC_01ABI, signer);
                      await runTransaction(
                        'Set DevRel Account',
                        () => contract.setDevRelAccount(address),
                        refreshOwnerData,
                      );
                      if (input) input.value = '';
                    }}
                    disabled={pendingAction !== null}
                    className="pob-button pob-button--outline pob-button--full"
                  >
                    Set DevRel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </article>
        )}

        {/* Add DAO HIC Voter - Only show before voting ends */}
        {!statusFlags.votingEnded && (
          <article
            className={`pob-accordion-item${openAdminSection === 'dao_hic' ? ' is-open' : ''}`}
          >
            <button
              type="button"
              className="pob-accordion-trigger"
              onClick={() => handleToggleAdminSection('dao_hic')}
              aria-expanded={openAdminSection === 'dao_hic'}
              aria-controls="owner-daohic"
            >
              <span>DAO HIC Voters</span>
            <svg
              className={`pob-accordion-icon${openAdminSection === 'dao_hic' ? ' is-open' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M2.25 4.5 6 8.25 9.75 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {openAdminSection === 'dao_hic' ? (
            <div className="pob-accordion-content" id="owner-daohic">
              {daoHicVoters.length ? (
                <ul className="pob-admin-voter-list">
                    {daoHicVoters.map((voter, index) => (
                      <li key={voter} className="pob-admin-voter">
                        <div className="pob-admin-voter__info">
                          <span className="pob-admin-voter__badge">#{index + 1}</span>
                          <div>
                            <p className="pob-admin-voter__label">DAO HIC voter</p>
                            <p className="pob-admin-voter__brief">{formatAddress(voter)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingRemovalVoter(voter)}
                          disabled={pendingAction !== null}
                          className="pob-button pob-button--outline pob-button--small"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-[var(--pob-text-muted)]" style={{ padding: '0 1.25rem' }}>
                    No DAO HIC voters registered yet.
                  </div>
                )}
                <div className="pob-fieldset pob-form-group" style={{ marginTop: '1rem' }}>
                  <input
                    type="text"
                    placeholder="DAO HIC voter address (0x...)"
                    id="daohic-address"
                    className="pob-input"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const input = document.getElementById('daohic-address') as HTMLInputElement;
                      const address = input?.value?.trim();
                      if (!address || !signer || !currentIteration) {
                        setError('Please enter an address');
                        return;
                      }
                      const contract = new Contract(currentIteration?.jurySC, JurySC_01ABI, signer);
                      await runTransaction(
                        'Add DAO HIC Voter',
                        () => contract.addDaoHicVoter(address),
                        refreshOwnerData,
                      );
                      if (input) input.value = '';
                    }}
                    disabled={pendingAction !== null}
                    className="pob-button pob-button--outline pob-button--full"
                  >
                    Add Voter
                  </button>
                </div>
            </div>
          ) : null}
        </article>
        )}

        {/* Lock Contract for History - Only show after voting ends */}
        {statusFlags.votingEnded && (
          <article
          className={`pob-accordion-item${openAdminSection === 'lock' ? ' is-open' : ''}`}
        >
          <button
            type="button"
            className="pob-accordion-trigger"
            onClick={() => handleToggleAdminSection('lock')}
            aria-expanded={openAdminSection === 'lock'}
            aria-controls="owner-lock"
          >
            <span>Lock Contract</span>
            <svg
              className={`pob-accordion-icon${openAdminSection === 'lock' ? ' is-open' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M2.25 4.5 6 8.25 9.75 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {openAdminSection === 'lock' ? (
            <div className="pob-accordion-content" id="owner-lock">
              <div className="space-y-3">
                <p className="text-sm text-[var(--pob-text-muted)]">
                  Lock the contract for history after voting ends. This preserves the final state (winner or no consensus) permanently and is irreversible.
                </p>
                {contractLocked ? (
                  <p className="text-sm font-semibold text-[var(--pob-primary)]">
                    Contract is locked for history
                  </p>
                ) : null}
                {!contractLocked && statusFlags.votingEnded ? (
                  winner.hasWinner ? (
                      <p className="text-sm text-white">
                        Winner:{' '}
                        <span className="italic">
                          {getProjectLabel(winner.projectAddress) ?? 'Unknown'}
                        </span>
                      </p>
                  ) : (
                    <p className="text-sm text-[var(--pob-text-muted)]">
                      No consensus reached (tie or insufficient votes)
                    </p>
                  )
                ) : null}
                <button
                  type="button"
                  onClick={async () => {
                    if (!signer || !currentIteration) return;
                    const contract = new Contract(currentIteration?.jurySC, JurySC_01ABI, signer);
                    await runTransaction(
                      'Lock Contract for History',
                      () => contract.lockContractForHistory(),
                      refreshProjects,
                    );
                  }}
                  disabled={pendingAction !== null || contractLocked || !statusFlags.votingEnded}
                  className="pob-button pob-button--full"
                >
                  {contractLocked ? 'Already Locked' : 'Lock Contract'}
                </button>
                {!statusFlags.votingEnded && (
                  <p className="pob-form-hint">
                    Contract can only be locked after voting has ended.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </article>
        )}

        <Modal
          isOpen={showActivationConfirm}
          onClose={() => {
            if (isBusy) return;
            setShowActivationConfirm(false);
          }}
          maxWidth="md"
          closeOnBackdropClick={!isBusy}
          closeOnEscape={!isBusy}
          showCloseButton={!isBusy}
        >
          <div className="pob-pane space-y-5">
            <h2 className="text-xl font-bold text-white">{modalTitle}</h2>
            <div className="pob-warning">
              <p className="pob-warning__headline">THIS ACTION IS IRREVERSIBLE</p>
              <p className="pob-warning__body">{modalBody}</p>
            </div>
            <p className="text-sm text-[var(--pob-text-muted)]">{modalPrompt}</p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (isBusy) return;
                  setShowActivationConfirm(false);
                }}
                disabled={isBusy}
                className="pob-button pob-button--outline flex-1 justify-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleActivationAction();
                }}
                disabled={isBusy}
                className={confirmClass}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </section>
  );
};

export default OwnerPanel;
