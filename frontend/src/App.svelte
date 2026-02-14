<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Router, Route, navigate } from 'svelte-routing';
  import { Contract, JsonRpcProvider } from 'ethers';
  import '~/App.css';

  // Components
  import Header from '~/components/Header.svelte';
  import SwitchNetworkModal from '~/components/SwitchNetworkModal.svelte';
  import DisconnectModal from '~/components/DisconnectModal.svelte';
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
  import ProfilePage from '~/pages/ProfilePage.svelte';
  import FaqPage from '~/pages/FaqPage.svelte';
  import ForumPage from '~/pages/ForumPage.svelte';
  import NotFoundPage from '~/pages/NotFoundPage.svelte';

  // Stores
  import {
    walletStore,
    connectWallet,
    disconnectWallet,
    initWallet,
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
    executeClaim,
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
  } from '~/stores/certState';

  // ABIs and constants
  import { JurySC_01ABI } from '~/abis';
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
    if (pathname === '/certs') return 'certs';
    if (pathname.startsWith('/profile/')) return 'profile';
    if (pathname === '/faq') return 'faq';
    if (pathname.startsWith('/forum')) return 'forum';
    return 'iterations';
  }

  const currentPage = $derived(getPageFromPath(currentPath));

  // Wallet state
  const provider = $derived($walletStore.provider);
  const signer = $derived($walletStore.signer);
  const walletAddress = $derived($walletStore.walletAddress);
  const chainId = $derived($walletStore.chainId);

  // Iterations state
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
  const devRelAccount = $derived($contractStateStore.devRelAccount);
  const daoHicVoters = $derived($contractStateStore.daoHicVoters);
  const daoHicIndividualVotes = $derived($contractStateStore.daoHicIndividualVotes);
  const projectsLocked = $derived($contractStateStore.projectsLocked);
  const contractLocked = $derived($contractStateStore.contractLocked);
  const voteCounts = $derived($contractStateStore.voteCounts);
  const totalCommunityVoters = $derived($contractStateStore.totalCommunityVoters);
  const badges = $derived($contractStateStore.badges);
  const communityBadges = $derived($contractStateStore.communityBadges);
  const devRelVote = $derived($contractStateStore.devRelVote);
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

  // Admin panel state
  const openAdminSection = $derived($adminPanelStore);

  // Network validation
  const correctNetwork = $derived(
    chainId === SYS_COIN_ID || chainId === SYS_TESTNET_ID || chainId === HARDHAT_ID || chainId === null
  );

  // Public provider for selected iteration
  const publicProvider = $derived.by(() => {
    if (!selectedIteration) return null;
    return getPublicProviderForChain(selectedIteration.chainId);
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

  const showIterationPage = $derived(Boolean(selectedIteration));
  const showIterationLoader = $derived(!showIterationPage && (iterationsLoading || loading));

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
    if (currentPage !== 'iteration') return;
    if (!selectedIteration || !statusFlags) return;

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

  // Confirm removal handlers
  async function handleConfirmRemoveVoter() {
    if (!pendingRemovalVoter || !signer || !selectedIteration) return;
    const contract = new Contract(selectedIteration.jurySC, JurySC_01ABI, signer);
    await runTransaction(
      'Remove DAO HIC Voter',
      () => contract.removeDaoHicVoter(pendingRemovalVoter),
      () => refreshOwnerData()
    );
    setPendingRemovalVoter(null);
  }

  async function handleConfirmRemoveProject() {
    if (!pendingRemovalProject || !signer || !selectedIteration) return;
    const contract = new Contract(selectedIteration.jurySC, JurySC_01ABI, signer);
    await runTransaction(
      'Remove Project',
      () => contract.removeProject(pendingRemovalProject.address),
      () => refreshProjects()
    );
    setPendingRemovalProject(null);
  }

  // Retry handler that captures current page context
  function handleRetryLoadIteration() {
    retryLoadIteration(currentPage, isOwner);
  }

  // Initialize
  onMount(() => {
    initWallet();
    const cleanup = setupWalletListeners();
    refreshIterations();
    return cleanup;
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
    <SwitchNetworkModal isOpen={switchNetworkModalOpen} onClose={closeSwitchNetworkModal} />

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
      walletAddress={walletAddress || ''}
      {chainId}
      networkLabel={chainId ? NETWORKS[chainId]?.name ?? `Chain ${chainId}` : 'Unknown Network'}
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
      onConnect={connectWallet}
      {correctNetwork}
      {chainId}
      {pendingAction}
      onSwitchNetwork={openSwitchNetworkModal}
      onOpenDisconnect={openDisconnectModal}
      {currentPage}
      onNavigate={(page) => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      showIterationTab={Boolean(selectedIteration)}
      showBadgesTab={walletAddress !== null && !isOwner}
      showCertsTab={walletAddress !== null && !isOwner}
      currentIteration={selectedIteration?.iteration ?? null}
    />

    <!-- Main content with Routes -->
    <main class="pob-main relative z-10 {(currentPage === 'iteration' || currentPage === 'project') && showIterationPage ? 'pob-main--desktop' : ''}">
      <!-- Home page - Iterations list -->
      <Route path="/">
        <IterationsPage
          {filteredIterations}
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
            iterationNumber={params.iterationNumber}
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
            {devRelVote}
            {daoHicVote}
            {entityVotes}
            {pendingAction}
            {walletAddress}
            {chainId}
            {projectsLocked}
            {contractLocked}
            {devRelAccount}
            {daoHicVoters}
            {daoHicIndividualVotes}
            {winner}
            {voteCounts}
            {totalCommunityVoters}
            {openAdminSection}
            {signer}
            {publicProvider}
            {JurySC_01ABI}
            {getProjectLabel}
            {executeMint}
            {executeVote}
            {executeClaim}
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
            onConnect={connectWallet}
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
            {devRelVote}
            {daoHicVote}
            {pendingAction}
            {walletAddress}
            {chainId}
            {signer}
            {getProjectLabel}
            {executeMint}
            {executeVote}
            {refreshVotingData}
            {refreshBadges}
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
          {walletAddress}
          loading={certLoading}
          {chainId}
          {signer}
          {isOwner}
          {publicProvider}
          iterations={filteredIterations.map(i => i.iteration)}
          onRefresh={() => {
            if (walletAddress && chainId && publicProvider) {
              const iters = filteredIterations.map(i => i.iteration);
              loadCertState(chainId, walletAddress, iters, publicProvider);
            }
          }}
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

      <!-- FAQ page -->
      <Route path="/faq">
        <FaqPage {chainId} />
      </Route>

      <!-- Forum pages -->
      <Route path="/forum">
        <ForumPage {walletAddress} />
      </Route>

      <Route path="/forum/:tweetId" let:params>
        <ForumPage tweetId={params.tweetId} {walletAddress} />
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
