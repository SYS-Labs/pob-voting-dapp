<script lang="ts">
  import { Link, useLocation } from 'svelte-routing';
  import Modal from './Modal.svelte';
  import { NETWORKS } from '~/constants/networks';
  import type { PageType } from '~/interfaces';

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
  }: Props = $props();

  let mobileMenuOpen = $state(false);

  const location = useLocation();

  export function getNetworkLabel(chainId: number | null): string {
    if (!chainId) return 'No Network';
    return NETWORKS[chainId]?.name || `Chain ${chainId}`;
  }

  const iterationLabel = $derived(currentIteration !== null ? `PoB #${currentIteration}` : 'Iteration');

  const tabs = $derived([
    { id: 'iterations' as const, label: 'Home', show: true, path: '/' },
    { id: 'iteration' as const, label: iterationLabel, show: showIterationTab, path: currentIteration ? `/iteration/${currentIteration}` : '/iteration/1' },
    { id: 'forum' as const, label: 'Forum', show: true, path: '/forum' },
    { id: 'badges' as const, label: 'Badges', show: showBadgesTab, path: '/badges' },
    { id: 'certs' as const, label: 'Certs', show: showCertsTab, path: '/certs' },
    { id: 'faq' as const, label: 'FAQ', show: true, path: '/faq' },
  ]);

  const visibleTabs = $derived(tabs.filter(tab => tab.show));

  function isTabActive(tabId: string, tabPath: string, currentPath: string): boolean {
    if (tabId === 'iterations' && currentPage === 'iterations') return true;
    if (tabId === 'iteration' && currentPage === 'iteration') return true;
    if (tabId !== 'iterations' && tabId !== 'iteration' && currentPath === tabPath) return true;
    return false;
  }

  function handleNavigate(tabId: 'iterations' | 'iteration' | 'badges' | 'certs' | 'faq' | 'forum') {
    onNavigate(tabId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<header class="pob-shell sticky top-0 z-40">
  <div class="mx-auto grid w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-4 lg:py-5">
    <!-- Site name -->
    <div class="flex items-center gap-3">
      <img src="/syscoin.svg" alt="Syscoin" style="width: 1.5rem; height: 1.5rem;" />
      <h1 class="pob-pane__meta">Proof of Builders</h1>
    </div>

    <!-- Navigation -->
    <div class="header-nav-container" style="display: flex; align-items: center; justify-content: center;">
      <!-- Desktop tabs -->
      <nav class="header-nav-desktop" style="align-items: center; gap: 0.5rem;">
        {#each visibleTabs as tab (tab.id)}
          <Link
            to={tab.path}
            class="pob-button pob-button--header {isTabActive(tab.id, tab.path, $location.pathname) ? '' : 'pob-button--outline'}"
            onclick={() => handleNavigate(tab.id)}
          >
            {tab.label}
          </Link>
        {/each}
      </nav>

      <!-- Mobile menu button -->
      <button
        type="button"
        onclick={() => mobileMenuOpen = !mobileMenuOpen}
        class="header-nav-mobile pob-button pob-button--header pob-button--outline"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 0.5rem;">
          <path d="M2 4h16M2 10h16M2 16h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Menu</span>
      </button>
    </div>

    <div class="wallet-button-container" style="display: flex; align-items: center; gap: 0.75rem; justify-self: end;">
      {#if walletAddress}
        {#if correctNetwork}
          <button
            type="button"
            onclick={onOpenDisconnect}
            class="pob-button pob-button--header pob-button--header-wallet pob-button--outline"
            disabled={pendingAction !== null}
          >
            <span class="pob-mono">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </span>
            <span style="height: 0.75rem; width: 1px; background: rgba(247,147,26,0.3);"></span>
            <span style="color: var(--pob-primary);">
              {getNetworkLabel(chainId)}
            </span>
          </button>
        {:else}
          <button
            type="button"
            onclick={onSwitchNetwork}
            class="pob-button pob-button--header pob-button--outline"
          >
            Switch Network
          </button>
        {/if}
      {:else}
        <button
          type="button"
          onclick={() => onConnect()}
          class="pob-button pob-button--header"
        >
          Connect Wallet
        </button>
      {/if}
    </div>
  </div>

  <!-- Mobile menu modal -->
  <Modal
    isOpen={mobileMenuOpen}
    onClose={() => mobileMenuOpen = false}
    maxWidth="sm"
    closeOnBackdropClick={true}
    closeOnEscape={true}
    showCloseButton={true}
  >
    {#snippet children()}
      <div class="pob-pane">
        <div class="pob-pane__heading">
          <h3 class="pob-pane__title">Menu</h3>
        </div>
        <nav style="display: flex; flex-direction: column; gap: 0.75rem;">
          {#each visibleTabs as tab (tab.id)}
            <Link
              to={tab.path}
              class="pob-button pob-button--header {isTabActive(tab.id, tab.path, $location.pathname) ? '' : 'pob-button--outline'}"
              onclick={() => { handleNavigate(tab.id); mobileMenuOpen = false; }}
              style="width: 100%; justify-content: center; text-align: center;"
            >
              {tab.label}
            </Link>
          {/each}
        </nav>
      </div>
    {/snippet}
  </Modal>
</header>
