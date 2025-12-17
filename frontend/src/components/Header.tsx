import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import Modal from './Modal';
import { NETWORKS } from '~/constants/networks';

interface HeaderProps {
  walletAddress: string | null;
  onConnect: () => void | Promise<void>;
  correctNetwork: boolean;
  chainId: number | null;
  pendingAction: string | null;
  onSwitchNetwork: () => void;
  onOpenDisconnect: () => void;
  currentPage: 'iterations' | 'iteration' | 'badges' | 'faq' | 'forum';
  onNavigate: (page: 'iterations' | 'iteration' | 'badges' | 'faq' | 'forum') => void;
  showIterationTab: boolean;
  showBadgesTab: boolean;
  currentIteration: number | null;
}

export const getNetworkLabel = (chainId: number | null): string => {
  if (!chainId) return 'No Network';
  return NETWORKS[chainId]?.name || `Chain ${chainId}`;
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

  const tabs: Array<{ id: 'iterations' | 'iteration' | 'badges' | 'faq' | 'forum'; label: string; show: boolean; path: string }> = [
    { id: 'iterations', label: 'Home', show: true, path: '/' },
    { id: 'iteration', label: iterationLabel, show: showIterationTab, path: currentIteration ? `/iteration/${currentIteration}` : '/iteration/1' },
    { id: 'forum', label: 'Forum', show: true, path: '/forum' },
    { id: 'badges', label: 'Badges', show: showBadgesTab, path: '/badges' },
    { id: 'faq', label: 'FAQ', show: true, path: '/faq' },
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
        <div className="header-nav-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Desktop tabs - shows on medium+ screens */}
          <nav className="header-nav-desktop" style={{ alignItems: 'center', gap: '0.5rem' }}>
            {visibleTabs.map((tab) => (
              <NavLink
                key={tab.id}
                to={tab.path}
                onClick={() => {
                  onNavigate(tab.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={({ isActive }) =>
                  `pob-button pob-button--header ${
                    (tab.id === 'iterations' && currentPage === 'iterations') ||
                    (tab.id === 'iteration' && currentPage === 'iteration') ||
                    (tab.id !== 'iterations' && tab.id !== 'iteration' && isActive)
                      ? ''
                      : 'pob-button--outline'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>

          {/* Mobile menu button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="header-nav-mobile pob-button pob-button--header pob-button--outline"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '0.5rem' }}>
              <path d="M2 4h16M2 10h16M2 16h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>Menu</span>
          </button>
        </div>

        <div className="wallet-button-container" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifySelf: 'end' }}>

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
              <NavLink
                key={tab.id}
                to={tab.path}
                onClick={() => {
                  onNavigate(tab.id);
                  setMobileMenuOpen(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={({ isActive }) =>
                  `pob-button pob-button--header ${
                    (tab.id === 'iterations' && currentPage === 'iterations') ||
                    (tab.id === 'iteration' && currentPage === 'iteration') ||
                    (tab.id !== 'iterations' && tab.id !== 'iteration' && isActive)
                      ? ''
                      : 'pob-button--outline'
                  }`
                }
                style={{ width: '100%', justifyContent: 'center', textAlign: 'center' }}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </Modal>
    </header>
  );
};

export default Header;
