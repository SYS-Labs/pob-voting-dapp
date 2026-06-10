<script lang="ts">
  import { Link, navigate, useLocation } from 'svelte-routing';
  import Modal from './Modal.svelte';
  import WalletIcon from './WalletIcon.svelte';
  import { NETWORKS } from '~/constants/networks';
  import type { PageType } from '~/interfaces';

  type ThemeName = 'dark' | 'light';
  type HeaderTabId = PageType | 'about';

  interface HeaderTab {
    id: HeaderTabId;
    label: string;
    show: boolean;
    path: string;
  }

  interface Props {
    walletAddress: string | null;
    onConnect: () => void | Promise<void>;
    correctNetwork: boolean;
    chainId: number | null;
    pendingAction: string | null;
    onSwitchNetwork: () => void;
    onOpenDisconnect: () => void;
    currentPage: PageType;
    onNavigate: (page: PageType) => void;
    showIterationTab: boolean;
    showBadgesTab: boolean;
    showCertsTab: boolean;
    currentIteration: number | null;
    walletIcon?: string | null;
    walletName?: string | null;
    theme: ThemeName;
    onToggleTheme: () => void;
  }

  let {
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
    showCertsTab,
    currentIteration,
    walletIcon = null,
    walletName = null,
    theme,
    onToggleTheme,
  }: Props = $props();

  let mobileMenuOpen = $state(false);

  const location = useLocation();

  export function getNetworkLabel(chainId: number | null): string {
    if (!chainId) return 'No Network';
    return NETWORKS[chainId]?.name || `Chain ${chainId}`;
  }

  const iterationLabel = $derived(currentIteration !== null ? `PoB #${currentIteration}` : 'Round');
  const walletShort = $derived(walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '');
  const networkLabel = $derived(getNetworkLabel(chainId));
  const profilePath = $derived(walletAddress ? `/profile/${walletAddress}` : '/');
  const nextThemeLabel = $derived(theme === 'dark' ? 'Light' : 'Dark');

  const tabs = $derived.by((): HeaderTab[] => [
    { id: 'iterations', label: 'Vote', show: true, path: '/' },
    { id: 'about', label: 'About', show: true, path: '/#about' },
    { id: 'iteration', label: iterationLabel, show: showIterationTab, path: currentIteration ? `/iteration/${currentIteration}` : '/iteration/1' },
    { id: 'badges', label: 'Badges', show: showBadgesTab, path: '/badges' },
    { id: 'certs', label: 'Certs', show: showCertsTab, path: '/certs' },
    { id: 'profile', label: 'Profile', show: walletAddress !== null, path: profilePath },
    { id: 'join', label: 'Join', show: true, path: '/join' },
    { id: 'faq', label: 'Learn', show: true, path: '/faq' },
    { id: 'get-address', label: 'Key Tool', show: true, path: '/get-address' },
  ]);

  const visibleTabs = $derived(tabs.filter(tab => tab.show));

  function isTabActive(tabId: HeaderTabId, tabPath: string, currentPath: string): boolean {
    if (tabId === 'iterations') return currentPage === 'iterations';
    if (tabId === 'about') return currentPage === 'iterations' && typeof window !== 'undefined' && window.location.hash === '#about';
    if (tabId === 'iteration') return currentPage === 'iteration' || currentPage === 'project';
    if (tabId === 'certs') return currentPage === 'certs' || currentPage === 'cert-request' || currentPage === 'cert-review' || currentPage === 'cert';
    if (tabId === 'profile') return currentPage === 'profile';
    if (tabId === 'faq') return currentPage === 'faq';
    if (tabId === 'join') return currentPage === 'join';
    if (tabId === 'get-address') return currentPage === 'get-address';
    return currentPath === tabPath;
  }

  function handleNavigate(tabId: PageType) {
    onNavigate(tabId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scrollToAbout() {
    document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleAboutNavigate(event: MouseEvent) {
    event.preventDefault();
    mobileMenuOpen = false;

    if (window.location.pathname !== '/') {
      navigate('/#about');
      window.setTimeout(scrollToAbout, 50);
      return;
    }

    if (window.location.hash !== '#about') {
      history.pushState(null, '', '/#about');
    }
    scrollToAbout();
  }

  function handleConnect() {
    mobileMenuOpen = false;
    void onConnect();
  }

  function handleSwitchNetwork() {
    mobileMenuOpen = false;
    onSwitchNetwork();
  }

  function handleOpenDisconnect() {
    mobileMenuOpen = false;
    onOpenDisconnect();
  }
</script>

<header class="pob-shell pob-header sticky top-0 z-40">
  <div class="pob-header__inner">
    <Link to="/" class="pob-header__brand" onclick={() => handleNavigate('iterations')}>
      <img src="/syscoin.svg" alt="Syscoin" class="pob-header__logo" />
      <span>
        <span class="pob-header__brand-title">Proof of Builders</span>
        <span class="pob-header__brand-kicker">Recognition, voting, and certs</span>
      </span>
    </Link>

    <nav class="pob-header__nav header-nav-desktop" aria-label="Primary navigation">
      {#each visibleTabs as tab (tab.id)}
        {#if tab.id === 'about'}
          <a
            href={tab.path}
            class="pob-button pob-button--header {isTabActive(tab.id, tab.path, $location.pathname) ? '' : 'pob-button--outline'}"
            aria-current={isTabActive(tab.id, tab.path, $location.pathname) ? 'page' : undefined}
            onclick={handleAboutNavigate}
          >
            {tab.label}
          </a>
        {:else}
          <Link
            to={tab.path}
            class="pob-button pob-button--header {isTabActive(tab.id, tab.path, $location.pathname) ? '' : 'pob-button--outline'}"
            aria-current={isTabActive(tab.id, tab.path, $location.pathname) ? 'page' : undefined}
            onclick={() => handleNavigate(tab.id as PageType)}
          >
            {tab.label}
          </Link>
        {/if}
      {/each}
    </nav>

    <div class="pob-header__actions">
      <button
        type="button"
        class="pob-theme-toggle"
        aria-pressed={theme === 'light'}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        onclick={onToggleTheme}
      >
        <span class="pob-theme-toggle__dot"></span>
        <span>{nextThemeLabel}</span>
      </button>

      <div class="wallet-button-container pob-header__wallet">
        {#if walletAddress}
          {#if correctNetwork}
            <button
              type="button"
              onclick={handleOpenDisconnect}
              class="pob-button pob-button--header pob-button--header-wallet pob-button--outline"
              disabled={pendingAction !== null}
            >
              <span class="pob-mono pob-header__wallet-address">{walletShort}</span>
              <span class="pob-header__wallet-divider"></span>
              <span class="pob-header__network">
                <WalletIcon icon={walletIcon} name={walletName} size="xs" />
                <span class="pob-header__network-label">{networkLabel}</span>
              </span>
            </button>
          {:else}
            <button
              type="button"
              onclick={handleSwitchNetwork}
              class="pob-button pob-button--header pob-button--outline"
            >
              Switch Network
            </button>
          {/if}
        {:else}
          <button
            type="button"
            onclick={handleConnect}
            class="pob-button pob-button--header"
          >
            Connect Wallet
          </button>
        {/if}
      </div>

      <button
        type="button"
        onclick={() => mobileMenuOpen = !mobileMenuOpen}
        class="header-nav-mobile pob-button pob-button--header pob-button--outline"
        aria-expanded={mobileMenuOpen}
        aria-controls="pob-mobile-menu"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M2 4h16M2 10h16M2 16h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Menu</span>
      </button>
    </div>
  </div>

  <Modal
    isOpen={mobileMenuOpen}
    onClose={() => mobileMenuOpen = false}
    maxWidth="sm"
    closeOnBackdropClick={true}
    closeOnEscape={true}
    showCloseButton={true}
  >
    {#snippet children()}
      <div class="pob-pane pob-mobile-menu" id="pob-mobile-menu">
        <div class="pob-pane__heading">
          <div>
            <h3 class="pob-pane__title">Menu</h3>
            <p class="pob-eyebrow pob-eyebrow--muted mt-1">Navigate the builder community</p>
          </div>
        </div>

        <div class="pob-mobile-menu__wallet">
          {#if walletAddress}
            {#if correctNetwork}
              <button
                type="button"
                onclick={handleOpenDisconnect}
                class="pob-button pob-button--header pob-button--header-wallet pob-button--outline pob-button--full"
                disabled={pendingAction !== null}
              >
                <span class="pob-mono">{walletShort}</span>
                <span class="pob-header__wallet-divider"></span>
                <span class="pob-header__network">
                  <WalletIcon icon={walletIcon} name={walletName} size="xs" />
                  {networkLabel}
                </span>
              </button>
            {:else}
              <button
                type="button"
                onclick={handleSwitchNetwork}
                class="pob-button pob-button--header pob-button--outline pob-button--full"
              >
                Switch Network
              </button>
            {/if}
          {:else}
            <button
              type="button"
              onclick={handleConnect}
              class="pob-button pob-button--header pob-button--full"
            >
              Connect Wallet
            </button>
          {/if}
        </div>

        <nav class="pob-mobile-menu__nav" aria-label="Mobile navigation">
          {#each visibleTabs as tab (tab.id)}
            {#if tab.id === 'about'}
              <a
                href={tab.path}
                class="pob-button pob-button--header {isTabActive(tab.id, tab.path, $location.pathname) ? '' : 'pob-button--outline'}"
                onclick={handleAboutNavigate}
              >
                {tab.label}
              </a>
            {:else}
              <Link
                to={tab.path}
                class="pob-button pob-button--header {isTabActive(tab.id, tab.path, $location.pathname) ? '' : 'pob-button--outline'}"
                onclick={() => { handleNavigate(tab.id as PageType); mobileMenuOpen = false; }}
              >
                {tab.label}
              </Link>
            {/if}
          {/each}
        </nav>
      </div>
    {/snippet}
  </Modal>
</header>
