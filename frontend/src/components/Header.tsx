import { useState } from 'react';
import Modal from './Modal';

interface HeaderProps {
  walletAddress: string | null;
  onConnect: () => void | Promise<void>;
  correctNetwork: boolean;
  chainId: number | null;
  pendingAction: string | null;
  onSwitchNetwork: () => void;
  onOpenDisconnect: () => void;
  currentPage: 'iterations' | 'iteration' | 'badges' | 'faq';
  onNavigate: (page: 'iterations' | 'iteration' | 'badges' | 'faq') => void;
  showIterationTab: boolean;
  showBadgesTab: boolean;
  currentIteration: number | null;
}

const NETWORK_NAMES: Record<number, string> = {
  57: 'NEVM Mainnet',
  5700: 'NEVM Testnet',
  31337: 'Hardhat',
};

export const getNetworkLabel = (chainId: number | null): string => {
  if (!chainId) return 'No Network';
  return NETWORK_NAMES[chainId] || `Chain ${chainId}`;
};

const Header = ({
  walletAddress,
  onConnect,
  correctNetwork,
  chainId,
  pendingAction,
  onSwitchNetwork,
  onOpenDisconnect,
  currentPage,
  onNavigate,
  showIterationTab,
  showBadgesTab,
  currentIteration,
}: HeaderProps) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const iterationLabel = currentIteration !== null ? `PoB #${currentIteration}` : 'Iteration';

  const tabs: Array<{ id: 'iterations' | 'iteration' | 'badges' | 'faq'; label: string; show: boolean }> = [
    { id: 'iterations', label: 'Home', show: true },
    { id: 'iteration', label: iterationLabel, show: showIterationTab },
    { id: 'badges', label: 'Badges', show: showBadgesTab },
    { id: 'faq', label: 'FAQ', show: true },
  ];

  const visibleTabs = tabs.filter((tab) => tab.show);

  return (
    <header className="pob-shell sticky top-0 z-40">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-4 lg:py-5">
        {/* Site name */}
        <div className="flex items-center gap-3">
          <img src="/syscoin.svg" alt="Syscoin" style={{ width: '1.5rem', height: '1.5rem' }} />
          <h1 className="pob-pane__meta">Proof of Builders</h1>
        </div>

        {/* Navigation - tabs on desktop, menu button on mobile */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Desktop tabs - shows on medium+ screens */}
          <nav className="header-nav-desktop" style={{ alignItems: 'center', gap: '0.5rem' }}>
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                className={`pob-button pob-button--header ${
                  currentPage === tab.id
                    ? ''
                    : 'pob-button--outline'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Mobile menu button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="header-nav-mobile pob-button pob-button--header pob-button--outline"
          >
            <span>Menu</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifySelf: 'end' }}>

          {walletAddress ? (
            correctNetwork ? (
              <button
                type="button"
                onClick={onOpenDisconnect}
                className="pob-button pob-button--header pob-button--header-wallet pob-button--outline"
                disabled={pendingAction !== null}
              >
                <span className="pob-mono">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </span>
                <span style={{ height: '0.75rem', width: '1px', background: 'rgba(247,147,26,0.3)' }} />
                <span style={{ color: 'var(--pob-primary)' }}>
                  {getNetworkLabel(chainId)}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSwitchNetwork}
                className="pob-button pob-button--header pob-button--outline"
              >
                Switch Network
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => {
                void onConnect();
              }}
              className="pob-button pob-button--header"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>

      {/* Mobile menu modal */}
      <Modal
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        maxWidth="sm"
        closeOnBackdropClick={true}
        closeOnEscape={true}
        showCloseButton={true}
      >
        <div className="pob-pane">
          <div className="pob-pane__heading">
            <h3 className="pob-pane__title">Menu</h3>
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onNavigate(tab.id);
                  setMobileMenuOpen(false);
                }}
                className={`pob-button pob-button--header ${currentPage === tab.id ? '' : 'pob-button--outline'}`}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </Modal>
    </header>
  );
};

export default Header;
