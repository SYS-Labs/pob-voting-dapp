import Modal from './Modal';
import type { ParticipantRole } from '~/interfaces';
import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';

interface VoteConfirmationModalProps {
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

const VoteConfirmationModal = ({
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
}: VoteConfirmationModalProps) => {
  // Community member without badge - show mint button
  const showMintFlow = votingRole === 'community' && !hasBadge;

  // Get role display info
  const roleInfo = votingRole && ROLE_LABELS[votingRole]
    ? { label: ROLE_LABELS[votingRole], color: ROLE_COLORS[votingRole] }
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="md"
      closeOnBackdropClick={!isPending}
      closeOnEscape={!isPending}
      showCloseButton={!isPending}
    >
      <div className="pob-pane">
        {showMintFlow ? (
          <>
            {/* Community without badge - mint flow */}
            <h2 className="pob-pane__title mb-3">Mint Badge to Vote</h2>
            <p className="text-sm text-[var(--pob-text-muted)] mb-4">
              As a community juror, you must mint a badge to participate in voting.
              The badge requires a {mintAmount} {tokenSymbol} deposit, which you can reclaim after voting ends.
            </p>

            <div className="pob-fieldset mb-4">
              <label className="pob-label">Project you want to vote for</label>
              <div className="text-sm">
                <p className="font-semibold text-white">{projectName}</p>
                <p className="pob-mono text-xs text-[var(--pob-text-muted)] mt-1">
                  {projectAddress}
                </p>
              </div>
            </div>

            {executeMint && (
              <button
                type="button"
                onClick={() => {
                  executeMint('community', refreshBadges);
                  // Don't close immediately - let the TxPendingModal take over
                  // User can close this modal manually if needed
                }}
                disabled={isPending}
                className="pob-button w-full justify-center mb-3"
              >
                {pendingAction === 'Mint Community Badge' ? 'Minting...' : `Mint community badge (${mintAmount} ${tokenSymbol})`}
              </button>
            )}

            <p className="text-xs text-[var(--pob-text-muted)] italic mb-4">
              After minting, you can vote on any project during the voting period.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="pob-button pob-button--outline flex-1 justify-center"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Normal vote confirmation */}
            <h2 className="pob-pane__title mb-3">
              {hasVotedForProject ? 'Change Vote' : 'Confirm Vote'}
            </h2>

            <div className="pob-fieldset mb-4">
              <label className="pob-label">Project</label>
              <div className="text-sm">
                <p className="font-semibold text-white">{projectName}</p>
                <p className="pob-mono text-xs text-[var(--pob-text-muted)] mt-1">
                  {projectAddress}
                </p>
              </div>
            </div>

            {roleInfo && (
              <div className="pob-fieldset mb-4">
                <label className="pob-label">Voting as</label>
                <span className={`pob-pill ${roleInfo.color}`}>
                  {roleInfo.label}
                </span>
              </div>
            )}

            {hasVotedForProject && (
              <p className="text-sm text-[var(--pob-text-muted)] mb-4">
                Your previous vote will be replaced with this selection.
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="pob-button pob-button--outline flex-1 justify-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isPending}
                className="pob-button flex-1 justify-center"
              >
                {isPending ? 'Confirming…' : 'Confirm Vote'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default VoteConfirmationModal;
