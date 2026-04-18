<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Router, Route } from 'svelte-routing';
  import '~/App.css';

  // Components
  import Header from '~/components/Header.svelte';
  import SwitchNetworkModal from '~/components/SwitchNetworkModal.svelte';
  import DisconnectModal from '~/components/DisconnectModal.svelte';
  import WalletSelectModal from '~/components/WalletSelectModal.svelte';
  import ConfirmRemoveModal from '~/components/ConfirmRemoveModal.svelte';
  import TxPendingModal from '~/components/TxPendingModal.svelte';
  import ErrorModal from '~/components/ErrorModal.svelte';
  import Footer from '~/components/Footer.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  // Pages
  import IterationsPage from '~/pages/IterationsPage.svelte';
  import IterationPage from '~/pages/IterationPage.svelte';
  import ProjectPage from '~/pages/ProjectPage.svelte';
  import ProjectEditPage from '~/pages/ProjectEditPage.svelte';
  import IterationMetadataPage from '~/pages/IterationMetadataPage.svelte';
  import IterationEditPage from '~/pages/IterationEditPage.svelte';
  import BadgesPage from '~/pages/BadgesPage.svelte';
  import CertsPage from '~/pages/CertsPage.svelte';
  import CertRequestPage from '~/pages/CertRequestPage.svelte';
  import CertReviewPage from '~/pages/CertReviewPage.svelte';
  import CertPage from '~/pages/CertPage.svelte';
  import ProfilePage from '~/pages/ProfilePage.svelte';
  import GetAddressPage from '~/pages/GetAddressPage.svelte';
  import FaqPage from '~/pages/FaqPage.svelte';
  import PrivacyPage from '~/pages/PrivacyPage.svelte';
  import TermsPage from '~/pages/TermsPage.svelte';
  import NotFoundPage from '~/pages/NotFoundPage.svelte';

  // Stores
  import {
    walletStore,
    walletProvidersStore,
    canSwitchAccount,
    connectWallet,
    switchAccount,
    disconnectWallet,
    initWallet,
    initWalletDiscovery,
    requestWalletProviders,
    setupWalletListeners,
    getPublicProviderForChain,
  } from '~/stores/wallet';
  import {
    iterationsStore,
    usableIterations,
    currentIteration,
    setSelectedIteration,
    updateIterationStatus,
    refreshIterations,
  } from '~/stores/iterations';
  import {
    modalsStore,
    openSwitchNetworkModal,
    closeSwitchNetworkModal,
    openDisconnectModal,
    closeDisconnectModal,
    setPendingRemovalVoter,
    setPendingRemovalProject,
    showError,
    closeErrorModal,
  } from '~/stores/modals';
  import { openAdminSection as adminPanelStore, toggleAdminSection } from '~/stores/adminPanel';
  import {
    transactionsStore,
    clearTxPending,
    setTxRefreshCallback,
    runTransaction,
    executeMint,
    executeVote,
    setVotingModeAction,
  } from '~/stores/transactions';
  import {
    contractStateStore,
    loadIterationState,
    refreshProjects,
    refreshOwnerData,
    refreshVotingData,
    refreshBadges,
    retryLoadIteration,
  } from '~/stores/contractState';

  // Cert store
  import {
    certStateStore,
    loadCertState,
    resetCertState,
    checkCertMenuVisibility,
  } from '~/stores/certState';

  // Write dispatcher and constants
  import { createWriteDispatcher } from '~/utils/writeDispatch';
  import { SYS_COIN_ID, SYS_TESTNET_ID, HARDHAT_ID, NETWORKS } from '~/constants/networks';
  import { formatAddress } from '~/utils';
  import type { IterationStatus, PageType, Project } from '~/interfaces';

  // Router location - track path using browser location
  let currentPath = $state(typeof window !== 'undefined' ? window.location.pathname : '/');

  // Listen for navigation changes
  onMount(() => {
    const updatePath = () => {
      if (currentPath !== window.location.pathname) {
        currentPath = window.location.pathname;
      }
    };

    // Listen for browser back/forward
    window.addEventListener('popstate', updatePath);

    // Intercept pushState/replaceState to detect programmatic navigation
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      originalPushState(...args);
      updatePath();
    };

    history.replaceState = (...args) => {
      originalReplaceState(...args);
      updatePath();
    };

    return () => {
      window.removeEventListener('popstate', updatePath);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  });

  function getPageFromPath(pathname: string): PageType {
    if (pathname.match(/^\/iteration\/\d+\/project\//)) return 'project';
    if (pathname.startsWith('/iteration/')) return 'iteration';
    if (pathname === '/badges') return 'badges';
    if (pathname.match(/^\/certs\/request\/\d+$/)) return 'cert-request';
    if (pathname.match(/^\/certs\/review\/\d+$/)) return 'cert-review';
    if (pathname === '/certs') return 'certs';
    if (pathname.match(/^\/cert\/\d+\/\d+$/)) return 'cert';
    if (pathname.startsWith('/profile/')) return 'profile';
    if (pathname.startsWith('/get-address')) return 'get-address';
    if (pathname === '/faq') return 'faq';
    return 'iterations';
  }

  const currentPage = $derived(getPageFromPath(currentPath));

  // Wallet state
  const provider = $derived($walletStore.provider);
  const signer = $derived($walletStore.signer);
  const walletAddress = $derived($walletStore.walletAddress);
  const chainId = $derived($walletStore.chainId);
  const connectedWalletInfo = $derived($walletStore.selectedWalletInfo);
  const accountSwitchSupported = $derived($canSwitchAccount);
  const walletProviderOptions = $derived($walletProvidersStore);

  // Iterations state
  const allIndexedIterations = $derived($iterationsStore.iterations);
  const filteredIterations = $derived($usableIterations);
  const iterationsLoading = $derived($iterationsStore.loading);
  const selectedIterationNumber = $derived($iterationsStore.selectedIterationNumber);
  const iterationStatusesMap = $derived($iterationsStore.statuses);
  const iterationsError = $derived($iterationsStore.error);
  const selectedIteration = $derived($currentIteration);

  // Contract state
  const roles = $derived($contractStateStore.roles);
  const rolesLoading = $derived($contractStateStore.rolesLoading);
  const isOwner = $derived($contractStateStore.isOwner);
  const projects = $derived($contractStateStore.projects);
  const smtVoters = $derived($contractStateStore.smtVoters);
  const daoHicVoters = $derived($contractStateStore.daoHicVoters);
  const daoHicIndividualVotes = $derived($contractStateStore.daoHicIndividualVotes);
  const projectsLocked = $derived($contractStateStore.projectsLocked);
  const contractLocked = $derived($contractStateStore.contractLocked);
  const voteCounts = $derived($contractStateStore.voteCounts);
  const totalCommunityVoters = $derived($contractStateStore.totalCommunityVoters);
  const badges = $derived($contractStateStore.badges);
  const communityBadges = $derived($contractStateStore.communityBadges);
  const smtVote = $derived($contractStateStore.smtVote);
  const daoHicVote = $derived($contractStateStore.daoHicVote);
  const entityVotes = $derived($contractStateStore.entityVotes);
  const winner = $derived($contractStateStore.winner);
  const votingMode = $derived($contractStateStore.votingMode);
  const projectScores = $derived($contractStateStore.projectScores);
  const statusFlags = $derived($contractStateStore.statusFlags);
  const iterationTimes = $derived($contractStateStore.iterationTimes);
  const loading = $derived($contractStateStore.loading);
  const hasLoadError = $derived($contractStateStore.hasLoadError);

  // Transactions state
  const pendingAction = $derived($transactionsStore.pendingAction);
  const txPendingHash = $derived($transactionsStore.txPendingHash);
  const txPendingLabel = $derived($transactionsStore.txPendingLabel);
  const txRefreshCallbackValue = $derived($transactionsStore.txRefreshCallback);

  // Modals state
  const switchNetworkModalOpen = $derived($modalsStore.switchNetworkModalOpen);
  const disconnectModalOpen = $derived($modalsStore.disconnectModalOpen);
  const pendingRemovalVoter = $derived($modalsStore.pendingRemovalVoter);
  const pendingRemovalProject = $derived($modalsStore.pendingRemovalProject);
  const errorModalOpen = $derived($modalsStore.errorModalOpen);
  const errorMessage = $derived($modalsStore.errorMessage);

  // Cert state
  const certCerts = $derived($certStateStore.certs);
  const certEligibility = $derived($certStateStore.eligibility);
  const certLoading = $derived($certStateStore.loading);

  let certMenuVisible = $state(false);
  let walletSelectorOpen = $state(false);
  let walletConnectPending = $state(false);
  let walletConnectError = $state<string | null>(null);
  let accountSwitchPending = $state(false);

  // Admin panel state
  const openAdminSection = $derived($adminPanelStore);

  const routeIterationNumber = $derived.by(() => {
    const match = currentPath.match(/^\/iteration\/(\d+)/);
    return match ? Number(match[1]) : null;
  });

  const routeIterationExists = $derived.by(() => (
    routeIterationNumber === null ||
    filteredIterations.some((iteration) => iteration.iteration === routeIterationNumber)
  ));

  const routeIterationReady = $derived.by(() => (
    routeIterationNumber === null ||
    selectedIteration?.iteration === routeIterationNumber
  ));

  const headerIterationNumber = $derived(routeIterationNumber ?? selectedIteration?.iteration ?? null);

  const showIterationPage = $derived.by(() => {
    if (!selectedIteration) return false;
    return routeIterationReady;
  });

  const showIterationLoader = $derived.by(() => {
    if (routeIterationNumber !== null) {
      if (iterationsLoading) return true;
      if (!routeIterationExists) return false;
      return !routeIterationReady || loading;
    }
    return !showIterationPage && (iterationsLoading || loading);
  });

  // Public provider for selected iteration
  const publicProvider = $derived.by(() => {
    if (!selectedIteration) return null;
    return getPublicProviderForChain(selectedIteration.chainId);
  });

  const activeRequiredChainId = $derived.by(() => {
    if (!selectedIteration) return null;
    if (currentPage === 'iteration' || currentPage === 'project') {
      return selectedIteration.chainId;
    }
    return null;
  });

  const switchTargetChainId = $derived(activeRequiredChainId ?? SYS_COIN_ID);

  // Network validation
  const correctNetwork = $derived.by(() => {
    if (chainId === null) return true;
    if (activeRequiredChainId !== null) return chainId === activeRequiredChainId;
    return chainId === SYS_COIN_ID || chainId === SYS_TESTNET_ID || chainId === HARDHAT_ID;
  });

  // Shuffled projects
  const shuffledProjects = $derived.by(() => {
    const shuffled = [...projects];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  });

  // Iteration status
  const iterationStatus: IterationStatus = $derived.by(() => {
    if (!selectedIteration) return 'upcoming';
    const status = iterationStatusesMap[selectedIteration.iteration];
    return status ?? 'upcoming';
  });

  const statusBadge = $derived.by(() => {
    if (iterationStatus === 'upcoming') return { label: 'Upcoming', color: 'pob-pill pob-pill--upcoming' };
    if (iterationStatus === 'ended') return { label: 'Ended', color: 'pob-pill pob-pill--ended' };
    return { label: 'Active', color: 'pob-pill pob-pill--active' };
  });

  // Get project label helper
  function getProjectLabel(address: string | null): string | null {
    if (!address) return null;
    const match = projects.find((p) => p.address.toLowerCase() === address.toLowerCase());
    if (match) {
      if (match.metadata?.name) return match.metadata.name;
      return `Project #${match.id}`;
    }
    return formatAddress(address);
  }

  // Update status from statusFlags
  $effect(() => {
    if (routeIterationNumber === null) return;
    if (iterationsLoading || !routeIterationExists) return;
    if (selectedIterationNumber === routeIterationNumber) return;

    setSelectedIteration(routeIterationNumber);
  });

  $effect(() => {
    if (currentPage !== 'iteration') return;
    if (!routeIterationReady || !selectedIteration || !statusFlags) return;

    let newStatus: IterationStatus = 'upcoming';
    if (statusFlags.votingEnded) {
      newStatus = 'ended';
    } else if (statusFlags.isActive) {
      newStatus = 'active';
    }

    const currentStatus = iterationStatusesMap[selectedIteration.iteration];
    if (currentStatus !== newStatus) {
      updateIterationStatus(selectedIteration.iteration, newStatus);
    }
  });

  // Load iteration state when iteration changes
  // Use untrack for values that shouldn't trigger re-runs (isOwner, filteredIterations)
  $effect(() => {
    const needsIterationState =
      currentPage === 'iteration' ||
      currentPage === 'project' ||
      currentPage === 'badges';

    if (!needsIterationState) return;
    if (currentPage !== 'badges' && (!routeIterationExists || !routeIterationReady)) return;
    if (!selectedIteration || !publicProvider) return;

    // Track only the values that should trigger a reload
    const _signer = signer;
    const _walletAddress = walletAddress;
    const _selectedIteration = selectedIteration;
    const _publicProvider = publicProvider;
    const _currentPage = currentPage;

    // Don't track isOwner and filteredIterations - they're outputs of loadIterationState
    untrack(() => {
      loadIterationState(
        _signer,
        _walletAddress,
        _selectedIteration,
        _publicProvider,
        filteredIterations,
        _currentPage,
        isOwner
      ).catch((err) => {
        console.error('[App] loadIterationState failed:', err);
      });
    });
  });

  // Check cert role on wallet connect — drives menu visibility
  $effect(() => {
    if (!walletAddress || !chainId) { certMenuVisible = false; return; }
    checkCertMenuVisibility(chainId, walletAddress).then((v) => { certMenuVisible = v; });
  });

  // Load cert state when navigating to the certs or cert-request page
  $effect(() => {
    if (currentPage !== 'certs' && currentPage !== 'cert-request' && currentPage !== 'cert-review') return;
    if (!walletAddress || !chainId || !publicProvider) return;

    const iters = filteredIterations.map(i => i.iteration);
    if (iters.length === 0) return;

    loadCertState(chainId, walletAddress, iters, publicProvider);
  });

  // Confirm removal handlers
  async function handleConfirmRemoveVoter() {
    if (!pendingRemovalVoter || !signer || !selectedIteration) return;
    const writer = createWriteDispatcher(selectedIteration, signer);
    await runTransaction(
      'Remove DAO HIC Voter',
      () => writer.removeDaoHicVoter(pendingRemovalVoter),
      () => refreshOwnerData()
    );
    setPendingRemovalVoter(null);
  }

  async function handleConfirmRemoveProject() {
    if (!pendingRemovalProject || !signer || !selectedIteration) return;
    const writer = createWriteDispatcher(selectedIteration, signer);
    await runTransaction(
      'Remove Project',
      () => writer.removeProject(pendingRemovalProject.address),
      () => refreshProjects()
    );
    setPendingRemovalProject(null);
  }

  // Retry handler that captures current page context
  function handleRetryLoadIteration() {
    retryLoadIteration(currentPage, isOwner);
  }

  function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string') {
      return (error as any).message;
    }
    return fallback;
  }

  function openWalletSelector() {
    walletConnectError = null;
    requestWalletProviders();
    walletSelectorOpen = true;
  }

  function handleSwitchWallet() {
    closeDisconnectModal();
    openWalletSelector();
  }

  async function handleSwitchAccount() {
    accountSwitchPending = true;
    try {
      await switchAccount();
      closeDisconnectModal();
    } catch (error) {
      showError(getErrorMessage(error, 'Failed to switch account.'));
    } finally {
      accountSwitchPending = false;
    }
  }

  async function handleSelectWallet(walletId: string) {
    walletConnectPending = true;
    walletConnectError = null;

    try {
      await connectWallet(walletId, switchTargetChainId);
      walletSelectorOpen = false;
    } catch (error) {
      walletConnectError = getErrorMessage(error, 'Failed to connect wallet.');
    } finally {
      walletConnectPending = false;
    }
  }

  async function handleExecuteMint(
    role: Parameters<typeof executeMint>[0],
    refreshCallback?: Parameters<typeof executeMint>[1],
    communityAmount?: Parameters<typeof executeMint>[2]
  ) {
    try {
      await executeMint(role, refreshCallback, communityAmount);
    } catch (error) {
      showError(getErrorMessage(error, 'Transaction failed.'));
    }
  }

  async function handleExecuteVote(
    role: Parameters<typeof executeVote>[0],
    projectAddress: string,
    tokenId?: string,
    refreshCallback?: Parameters<typeof executeVote>[3]
  ) {
    try {
      await executeVote(role, projectAddress, tokenId, refreshCallback);
    } catch (error) {
      showError(getErrorMessage(error, 'Transaction failed.'));
    }
  }

  // Initialize
  onMount(() => {
    const cleanupDiscovery = initWalletDiscovery();
    initWallet();
    const cleanup = setupWalletListeners();
    refreshIterations();
    return () => {
      cleanup();
      cleanupDiscovery();
    };
  });
</script>

<Router>
  <div class="pob-layout relative text-white">

    <!-- Background gradients -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.18),transparent)] blur-3xl"></div>
      <div class="absolute bottom-[-10rem] right-[-6rem] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.12),transparent)] blur-3xl"></div>
    </div>

    <!-- Modals -->
    <SwitchNetworkModal
      isOpen={switchNetworkModalOpen}
      onClose={closeSwitchNetworkModal}
      targetChainId={switchTargetChainId}
    />

    <WalletSelectModal
      isOpen={walletSelectorOpen}
      wallets={walletProviderOptions}
      isConnecting={walletConnectPending}
      error={walletConnectError}
      onClose={() => {
        if (!walletConnectPending) walletSelectorOpen = false;
      }}
      onSelect={handleSelectWallet}
      onRefresh={requestWalletProviders}
    />

    <TxPendingModal
      isOpen={pendingAction !== null || txPendingHash !== null}
      txHash={txPendingHash}
      {provider}
      {chainId}
      actionLabel={txPendingLabel || pendingAction || 'Transaction'}
      onClose={clearTxPending}
      onConfirmed={() => {
        console.log('[App] Transaction confirmed, calling refresh callback');
        clearTxPending();
        if (txRefreshCallbackValue) {
          console.log('[App] Executing txRefreshCallback');
          void txRefreshCallbackValue();
          setTxRefreshCallback(null);
        }
      }}
      onError={showError}
    />

    <DisconnectModal
      isOpen={disconnectModalOpen}
      onClose={closeDisconnectModal}
      onDisconnect={() => {
        disconnectWallet();
        closeDisconnectModal();
      }}
      onSwitchWallet={handleSwitchWallet}
      onSwitchAccount={handleSwitchAccount}
      isSwitchingAccount={accountSwitchPending}
      canSwitchAccount={accountSwitchSupported}
      walletAddress={walletAddress || ''}
      {chainId}
      networkLabel={chainId ? NETWORKS[chainId]?.name ?? `Chain ${chainId}` : 'Unknown Network'}
      walletName={connectedWalletInfo?.name ?? null}
      walletIcon={connectedWalletInfo?.icon ?? null}
    />

    <ConfirmRemoveModal
      isOpen={pendingRemovalVoter !== null}
      onClose={() => setPendingRemovalVoter(null)}
      onConfirm={handleConfirmRemoveVoter}
      targetAddress={pendingRemovalVoter ?? ''}
      isPending={pendingAction !== null}
      title="Remove DAO HIC Voter?"
      description="This will revoke voting access for the following address:"
      entityLabel="DAO HIC voter"
      confirmLabel="Yes, remove"
    />

    <ConfirmRemoveModal
      isOpen={pendingRemovalProject !== null}
      onClose={() => setPendingRemovalProject(null)}
      onConfirm={handleConfirmRemoveProject}
      targetAddress={pendingRemovalProject?.address ?? ''}
      isPending={pendingAction !== null}
      title="Remove Project?"
      description={`Remove ${pendingRemovalProject?.metadata?.name ?? 'this project'} from the iteration?`}
      entityLabel="Project address"
      confirmLabel="Yes, remove"
    />

    <ErrorModal
      isOpen={errorModalOpen || errorMessage !== null}
      error={errorMessage || ''}
      onClose={closeErrorModal}
      onRetry={hasLoadError ? handleRetryLoadIteration : undefined}
      title={hasLoadError ? 'Error Loading Program' : 'Transaction Error'}
    />

    <!-- Header -->
    <Header
      {walletAddress}
      onConnect={openWalletSelector}
      {correctNetwork}
      {chainId}
      {pendingAction}
      onSwitchNetwork={openSwitchNetworkModal}
      onOpenDisconnect={openDisconnectModal}
      {currentPage}
      onNavigate={(page) => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      showIterationTab={Boolean(headerIterationNumber)}
      showBadgesTab={walletAddress !== null && !isOwner}
      showCertsTab={certMenuVisible || isOwner}
      currentIteration={headerIterationNumber}
      walletIcon={connectedWalletInfo?.icon ?? null}
      walletName={connectedWalletInfo?.name ?? null}
    />

    <!-- Main content with Routes -->
    <main class="pob-main relative z-10 {(currentPage === 'iteration' || currentPage === 'project') && showIterationPage ? 'pob-main--desktop' : ''}">
      <!-- Home page - Iterations list -->
      <Route path="/">
        <IterationsPage
          filteredIterations={allIndexedIterations}
          selectedIteration={selectedIterationNumber}
          iterationStatuses={iterationStatusesMap}
          onSelectIteration={(iteration) => {
            setSelectedIteration(iteration);
          }}
          {walletAddress}
          {chainId}
          {signer}
          {runTransaction}
          {refreshIterations}
          isLoading={iterationsLoading}
          error={iterationsError}
        />
      </Route>

      <!-- Iteration detail page -->
      <Route path="/iteration/:iterationNumber" let:params>
        {#if showIterationPage}
          <IterationPage
            currentIteration={selectedIteration}
            {statusBadge}
            {iterationTimes}
            {projects}
            {shuffledProjects}
            {loading}
            {roles}
            {rolesLoading}
            {isOwner}
            {statusFlags}
            {communityBadges}
            {badges}
            {smtVote}
            {daoHicVote}
            {entityVotes}
            {pendingAction}
            {walletAddress}
            {chainId}
            {projectsLocked}
            {contractLocked}
            {smtVoters}
            {daoHicVoters}
            {daoHicIndividualVotes}
            {winner}
            {voteCounts}
            {totalCommunityVoters}
            {openAdminSection}
            {signer}
            {publicProvider}
            {getProjectLabel}
            executeMint={handleExecuteMint}
            executeVote={handleExecuteVote}
            handleToggleAdminSection={toggleAdminSection}
            {runTransaction}
            {refreshVotingData}
            {refreshProjects}
            {refreshOwnerData}
            {refreshBadges}
            {setPendingRemovalProject}
            {setPendingRemovalVoter}
            setError={showError}
            onOpenDisconnect={openDisconnectModal}
            onConnect={openWalletSelector}
            {votingMode}
            {projectScores}
            setVotingMode={setVotingModeAction}
          />
        {:else if showIterationLoader}
          <section class="pob-pane">
            <div class="flex flex-col items-center justify-center py-12 gap-4">
              <ProgressSpinner size={48} />
              <p class="text-sm text-[var(--pob-text-muted)]">Loading iteration...</p>
            </div>
          </section>
        {:else}
          <NotFoundPage />
        {/if}
      </Route>

      <!-- Project edit page (must be before project detail to match first) -->
      <Route path="/iteration/:iterationNumber/project/:projectAddress/edit" let:params>
        {#if showIterationPage}
          <ProjectEditPage
            iterationNumber={params.iterationNumber}
            projectAddress={params.projectAddress}
            {projects}
            {walletAddress}
            {chainId}
            iterationChainId={selectedIteration?.chainId ?? null}
            contractAddress={selectedIteration?.jurySC ?? null}
            {signer}
            {projectsLocked}
          />
        {:else if showIterationLoader}
          <section class="pob-pane">
            <div class="flex flex-col items-center justify-center py-12 gap-4">
              <ProgressSpinner size={48} />
              <p class="text-sm text-[var(--pob-text-muted)]">Loading iteration...</p>
            </div>
          </section>
        {:else}
          <NotFoundPage />
        {/if}
      </Route>

      <!-- Project detail page -->
      <Route path="/iteration/:iterationNumber/project/:projectAddress" let:params>
        {#if showIterationPage}
          <ProjectPage
            projectAddress={params.projectAddress}
            currentIteration={selectedIteration}
            {projects}
            {loading}
            {roles}
            {isOwner}
            {projectsLocked}
            {statusFlags}
            {communityBadges}
            {badges}
            {smtVote}
            {daoHicVote}
            {pendingAction}
            {walletAddress}
            {chainId}
            {signer}
            {getProjectLabel}
            executeMint={handleExecuteMint}
            executeVote={handleExecuteVote}
            {refreshVotingData}
            {refreshBadges}
            onConnect={openWalletSelector}
          />
        {:else if showIterationLoader}
          <section class="pob-pane">
            <div class="flex flex-col items-center justify-center py-12 gap-4">
              <ProgressSpinner size={48} />
              <p class="text-sm text-[var(--pob-text-muted)]">Loading iteration...</p>
            </div>
          </section>
        {:else}
          <NotFoundPage />
        {/if}
      </Route>

      <!-- Iteration edit page -->
      <Route path="/iteration/:iterationNumber/details/edit" let:params>
        {#if showIterationPage}
          <IterationEditPage
            iterationNumber={params.iterationNumber}
            currentIteration={selectedIteration}
            {walletAddress}
            {chainId}
            {signer}
            votingActive={statusFlags.isActive && !statusFlags.votingEnded}
            {isOwner}
          />
        {:else if showIterationLoader}
          <section class="pob-pane">
            <div class="flex flex-col items-center justify-center py-12 gap-4">
              <ProgressSpinner size={48} />
              <p class="text-sm text-[var(--pob-text-muted)]">Loading iteration...</p>
            </div>
          </section>
        {:else}
          <NotFoundPage />
        {/if}
      </Route>

      <!-- Iteration metadata page -->
      <Route path="/iteration/:iterationNumber/details" let:params>
        {#if showIterationPage}
          <IterationMetadataPage
            iterationNumber={params.iterationNumber}
            currentIteration={selectedIteration}
            {walletAddress}
            {chainId}
            {signer}
            votingActive={statusFlags.isActive && !statusFlags.votingEnded}
            {isOwner}
          />
        {:else if showIterationLoader}
          <section class="pob-pane">
            <div class="flex flex-col items-center justify-center py-12 gap-4">
              <ProgressSpinner size={48} />
              <p class="text-sm text-[var(--pob-text-muted)]">Loading iteration...</p>
            </div>
          </section>
        {:else}
          <NotFoundPage />
        {/if}
      </Route>

      <!-- Badges page -->
      <Route path="/badges">
        <BadgesPage
          {badges}
          {walletAddress}
          {loading}
        />
      </Route>

      <!-- Certs page -->
      <Route path="/certs">
        <CertsPage
          certs={certCerts}
          eligibility={certEligibility}
          iterations={filteredIterations}
          {walletAddress}
          loading={certLoading}
          {chainId}
          {signer}
          {publicProvider}
          onRefresh={() => {
            if (walletAddress && chainId && publicProvider) {
              const iters = filteredIterations.map(i => i.iteration);
              loadCertState(chainId, walletAddress, iters, publicProvider);
            }
          }}
        />
      </Route>

      <!-- Cert review page (owner reviews a specific requested cert) -->
      <Route path="/certs/review/:tokenId" let:params>
        <CertReviewPage
          tokenId={Number(params.tokenId)}
          iterations={filteredIterations}
          {walletAddress}
          {chainId}
          {signer}
          {publicProvider}
          onRefresh={() => {
            if (walletAddress && chainId && publicProvider) {
              const iters = filteredIterations.map(i => i.iteration);
              loadCertState(chainId, walletAddress, iters, publicProvider);
            }
          }}
        />
      </Route>

      <!-- Cert request page -->
      <Route path="/certs/request/:iteration" let:params>
        <CertRequestPage
          iteration={Number(params.iteration)}
          {walletAddress}
          {chainId}
          {signer}
          {publicProvider}
          onRefresh={() => {
            if (walletAddress && chainId && publicProvider) {
              const iters = filteredIterations.map(i => i.iteration);
              loadCertState(chainId, walletAddress, iters, publicProvider);
            }
          }}
        />
      </Route>

      <!-- Public/tracked cert page -->
      <Route path="/cert/:chainId/:tokenId" let:params>
        <CertPage
          chainId={Number(params.chainId)}
          tokenId={params.tokenId}
          {walletAddress}
          filteredIterations={filteredIterations}
        />
      </Route>

      <!-- Profile page -->
      <Route path="/profile/:address" let:params>
        <ProfilePage
          address={params.address}
          certs={certCerts}
          {badges}
          {walletAddress}
          {chainId}
          {loading}
        />
      </Route>

      <!-- Address generator page -->
      <Route path="/get-address">
        <GetAddressPage />
      </Route>

      <!-- FAQ page -->
      <Route path="/faq">
        <FaqPage {chainId} />
      </Route>

      <!-- Legal pages -->
      <Route path="/privacy">
        <PrivacyPage />
      </Route>

      <Route path="/terms">
        <TermsPage />
      </Route>

      <!-- 404 - catch all -->
      <Route path="*">
        <NotFoundPage />
      </Route>
    </main>

    <!-- Footer -->
    <Footer />
  </div>
</Router>
