import Modal from './Modal';

interface ConfirmRemoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  targetAddress: string;
  isPending: boolean;
  title?: string;
  description?: string;
  entityLabel?: string;
  confirmLabel?: string;
}

const ConfirmRemoveModal = ({
  isOpen,
  onClose,
  onConfirm,
  targetAddress,
  isPending,
  title,
  description,
  entityLabel,
  confirmLabel,
}: ConfirmRemoveModalProps) => {
  const modalTitle = title ?? 'Remove DAO HIC Voter?';
  const modalDescription =
    description ?? 'This will revoke voting access for the following address:';
  const modalEntityLabel = entityLabel ?? 'DAO HIC voter';
  const modalConfirmLabel = confirmLabel ?? 'Yes, remove';

  const handleConfirm = () => {
    onConfirm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="md"
      closeOnBackdropClick={!isPending}
      closeOnEscape={!isPending}
      showCloseButton={!isPending}
    >
      <div className="pob-pane space-y-4">
          <h2 className="text-xl font-bold text-white">{modalTitle}</h2>

          <div className="space-y-3">
            <p className="text-sm text-[var(--pob-text-muted)]">{modalDescription}</p>

            <div className="pob-fieldset space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--pob-text-muted)]">
                {modalEntityLabel}
              </p>
              <p className="pob-mono break-all text-sm text-white">{targetAddress}</p>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
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
              onClick={handleConfirm}
              disabled={isPending}
              className="pob-button flex-1 justify-center"
            >
              {isPending ? 'Removing...' : modalConfirmLabel}
            </button>
          </div>
        </div>
    </Modal>
  );
};

export default ConfirmRemoveModal;
