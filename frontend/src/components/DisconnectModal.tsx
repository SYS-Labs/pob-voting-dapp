import Modal from './Modal';

interface DisconnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDisconnect: () => void;
  walletAddress: string;
  chainId: number | null;
  networkLabel: string;
}

const DisconnectModal = ({
  isOpen,
  onClose,
  onDisconnect,
  walletAddress,
  chainId,
  networkLabel
}: DisconnectModalProps) => {
  const handleDisconnect = () => {
    onClose();
    onDisconnect();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md">
      <div className="pob-pane space-y-4">
          <h2 className="text-xl font-bold text-white">Wallet Connected</h2>

          <div className="space-y-3">
            <div className="pob-fieldset space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-[var(--pob-text-muted)] uppercase tracking-wider">Network:</span>
                <span className="font-semibold text-white">{networkLabel}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-[var(--pob-text-muted)] uppercase tracking-wider">Chain ID:</span>
                <span className="pob-mono text-xs text-white">{chainId}</span>
              </div>
            </div>

            <div className="pob-fieldset space-y-2">
              <p className="text-xs text-[var(--pob-text-muted)] uppercase tracking-wider">Address</p>
              <p className="pob-mono text-sm text-white break-all">{walletAddress}</p>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleDisconnect}
              className="pob-button pob-button--outline w-full justify-center"
            >
              Disconnect Wallet
            </button>
          </div>
        </div>
    </Modal>
  );
};

export default DisconnectModal;
