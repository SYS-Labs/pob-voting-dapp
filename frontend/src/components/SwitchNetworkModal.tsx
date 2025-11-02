import Modal from './Modal';

interface SwitchNetworkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SwitchNetworkModal = ({ isOpen, onClose }: SwitchNetworkModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md">
      <div className="pob-pane space-y-4">
          <h2 className="text-xl font-bold text-white">Switch Network</h2>

          <p className="text-sm text-[var(--pob-text-muted)]">
            Please switch to one of the supported networks in your wallet:
          </p>

          <div className="space-y-2">
            <div className="pob-fieldset space-y-1">
              <p className="font-semibold text-white">NEVM Mainnet</p>
              <p className="pob-mono text-xs text-[var(--pob-text-muted)]">Chain ID: 57</p>
            </div>
            <div className="pob-fieldset space-y-1">
              <p className="font-semibold text-white">NEVM Testnet</p>
              <p className="pob-mono text-xs text-[var(--pob-text-muted)]">Chain ID: 5700</p>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={onClose}
              className="pob-button w-full justify-center"
            >
              Close
            </button>
          </div>
        </div>
    </Modal>
  );
};

export default SwitchNetworkModal;
