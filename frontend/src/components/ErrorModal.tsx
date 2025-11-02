import Modal from './Modal';

interface ErrorModalProps {
  isOpen: boolean;
  error: string;
  onClose: () => void;
  onRetry?: () => void;
  title?: string;
}

export default function ErrorModal({
  isOpen,
  error,
  onClose,
  onRetry,
  title = 'Error',
}: ErrorModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md">
      <div className="pob-pane space-y-4">
        <h2 className="text-xl font-bold text-white">{title}</h2>

        <div className="rounded-lg border border-[rgba(247,147,26,0.4)] bg-[rgba(247,147,26,0.08)] p-4">
          <p className="text-sm text-white">{error}</p>
        </div>

        <div className="flex gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRetry();
              }}
              className="pob-button flex-1 justify-center"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="pob-button pob-button--outline flex-1 justify-center"
          >
            {onRetry ? 'Dismiss' : 'Close'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
