import { useCallback, useMemo, useState, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Contract } from 'ethers';
import '~/App.css';
import Header from '~/components/Header';
import SwitchNetworkModal from '~/components/SwitchNetworkModal';
import DisconnectModal from '~/components/DisconnectModal';
import ConfirmRemoveModal from '~/components/ConfirmRemoveModal';
import TxPendingModal from '~/components/TxPendingModal';
import ErrorModal from '~/components/ErrorModal';
import Footer from '~/components/Footer';
import { JurySC_01ABI } from '~/abis';
import { SYS_COIN_ID, SYS_TESTNET_ID, HARDHAT_ID, NETWORKS } from '~/constants/networks';
import { formatAddress } from '~/utils';
import { useAppState } from '~/contexts/AppStateContext';

// Hooks
import {
  useIterationStatuses,
  useContractState,
  useTransactions,
  useModals,
  useAdminPanel,
} from '~/hooks';

// Pages
import IterationsPage from '~/pages/IterationsPage';
import BadgesPage from '~/pages/BadgesPage';
import FaqPage from '~/pages/FaqPage';
import IterationPage from '~/pages/IterationPage';
import ProjectMetadataPage from '~/pages/ProjectMetadataPage';
import IterationMetadataPage from '~/pages/IterationMetadataPage';
import ForumPage from '~/pages/ForumPage';
import NotFoundPage from '~/pages/NotFoundPage';
import type { IterationStatus } from '~/interfaces';

// Map routes to page types for backward compatibility
type PageType = 'iterations' | 'iteration' | 'badges' | 'faq' | 'forum';

function getPageFromPath(pathname: string): PageType {
  if (pathname.startsWith('/iteration/')) return 'iteration';
  if (pathname === '/badges') return 'badges';
  if (pathname === '/faq') return 'faq';
  if (pathname === '/forum') return 'forum';
  return 'iterations';
}

function App() {
  const location = useLocation();
  const currentPage = getPageFromPath(location.pathname);

  const [error, setError] = useState<string | null>(null);

  // Get global state from context
  const {
    wallet: { provider, signer, walletAddress, chainId, connectWallet, disconnectWallet },
    filteredIterations,
    iterationsLoading,
    selectedIterationNumber,
    setSelectedIteration,
    currentIteration,
    iterationStatuses: globalIterationStatuses,
    updateIterationStatus,
    refreshIterations,
    publicProvider,
  } = useAppState();

  // Sync URL parameter with selected iteration
  useEffect(() => {
    const match = location.pathname.match(/^\/iteration\/(\d+)/);
    if (match) {
      const iterationId = parseInt(match[1], 10);
      if (selectedIterationNumber !== iterationId) {
        setSelectedIteration(iterationId);
      }
    }
  }, [location.pathname, selectedIterationNumber, setSelectedIteration]);

  // Network validation
  const correctNetwork =
    chainId === SYS_COIN_ID || chainId === SYS_TESTNET_ID || chainId === HARDHAT_ID || chainId === null;

  // Iteration statuses - always load (useIterationStatuses creates its own providers per chain)
  const { statuses: contractIterationStatuses } = useIterationStatuses(
    filteredIterations,
    publicProvider, // Kept for backward compatibility but not used
    true, // Always allow reading - hook creates its own providers
  );

  // Merge statuses: prefer context, fallback to contract
  const iterationStatuses = useMemo(() => {
    return { ...contractIterationStatuses, ...globalIterationStatuses };
  }, [contractIterationStatuses, globalIterationStatuses]);

  // Contract state
  const {
    roles,
    isOwner,
    projects,
    devRelAccount,
    daoHicVoters,
    projectsLocked,
    contractLocked,
    voteCounts,
    totalCommunityVoters,
    badges,
    communityBadges,
    devRelVote,
    daoHicVote,
    entityVotes,
    winner,
    votingMode,
    projectScores,
    statusFlags,
    iterationTimes,
    loading,
    hasLoadError,
    refreshProjects,
    refreshOwnerData,
    refreshVotingData,
    refreshBadges,
    retryLoadIteration,
  } = useContractState(
    signer,
    walletAddress,
    currentIteration,
    correctNetwork,
    publicProvider,
    chainId,
    filteredIterations,
    currentPage,
  );

  // Transactions
  const {
    pendingAction,
    txPendingHash,
    txPendingLabel,
    txRefreshCallback,
    setTxRefreshCallback,
    clearTxPending,
    runTransaction,
    executeMint,
    executeVote,
    executeClaim,
    setVotingMode,
  } = useTransactions(signer, currentIteration, walletAddress, correctNetwork, chainId);

  // Modals
  const {
    switchNetworkModalOpen,
    setSwitchNetworkModalOpen,
    disconnectModalOpen,
    setDisconnectModalOpen,
    pendingRemovalVoter,
    setPendingRemovalVoter,
    pendingRemovalProject,
    setPendingRemovalProject,
  } = useModals();

  // Admin panel
  const { openAdminSection, handleToggleAdminSection } = useAdminPanel();

  // Computed values
  const shuffledProjects = useMemo(() => {
    const shuffled = [...projects];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [projects]);

  const iterationStatus = useMemo((): IterationStatus => {
    if (!currentIteration) return 'upcoming';
    const status = iterationStatuses[currentIteration.iteration];
    return status ?? 'upcoming';
  }, [currentIteration, iterationStatuses]);

  // Update statuses map when statusFlags changes (only on iteration detail page)
  useEffect(() => {
    // Only update from statusFlags on iteration detail page (not on iterations list page)
    // On iterations page, statusFlags isn't loaded so it would incorrectly set "upcoming"
    if (currentPage !== 'iteration') {
      return;
    }

    if (currentIteration && statusFlags) {
      let newStatus: IterationStatus = 'upcoming';
      if (statusFlags.votingEnded) {
        newStatus = 'ended';
      } else if (statusFlags.isActive) {
        newStatus = 'active';
      }

      const currentStatus = iterationStatuses[currentIteration.iteration];
      if (currentStatus !== newStatus) {
        updateIterationStatus(currentIteration.iteration, newStatus);
      }
    }
  }, [currentPage, currentIteration, statusFlags, iterationStatuses, updateIterationStatus]);

  const statusBadge = useMemo(() => {
    if (iterationStatus === 'upcoming') return { label: 'Upcoming', color: 'pob-pill pob-pill--upcoming' };
    if (iterationStatus === 'ended') return { label: 'Ended', color: 'pob-pill pob-pill--ended' };
    return { label: 'Active', color: 'pob-pill pob-pill--active' };
  }, [iterationStatus]);

  const showIterationPage = Boolean(currentIteration);

  const getProjectLabel = useCallback(
    (address: string | null) => {
      if (!address) return null;
      const match = projects.find((projectItem) => projectItem.address.toLowerCase() === address.toLowerCase());
      if (match) {
        if (match.metadata?.name) {
          return match.metadata.name;
        }
        return `Project #${match.id}`;
      }
      return formatAddress(address);
    },
    [projects],
  );

  // Handle confirm removal modals
  const handleConfirmRemoveVoter = useCallback(async () => {
    if (!pendingRemovalVoter || !signer || !currentIteration) return;
    const contract = new Contract(currentIteration?.jurySC, JurySC_01ABI, signer);
    await runTransaction(
      'Remove DAO HIC Voter',
      () => contract.removeDaoHicVoter(pendingRemovalVoter),
      refreshOwnerData,
    );
    setPendingRemovalVoter(null);
  }, [pendingRemovalVoter, signer, currentIteration, runTransaction, refreshOwnerData, setPendingRemovalVoter]);

  const handleConfirmRemoveProject = useCallback(async () => {
    if (!pendingRemovalProject || !signer || !currentIteration) return;
    const contract = new Contract(currentIteration?.jurySC, JurySC_01ABI, signer);
    await runTransaction(
      'Remove Project',
      () => contract.removeProject(pendingRemovalProject.address),
      refreshProjects,
    );
    setPendingRemovalProject(null);
  }, [pendingRemovalProject, signer, currentIteration, runTransaction, refreshProjects, setPendingRemovalProject]);

  return (
    <div className="pob-layout relative text-white">
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.18),transparent)] blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-6rem] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.12),transparent)] blur-3xl" />
      </div>

      {/* Modals */}
      <SwitchNetworkModal isOpen={switchNetworkModalOpen} onClose={() => setSwitchNetworkModalOpen(false)} />

      <TxPendingModal
        isOpen={pendingAction !== null || txPendingHash !== null}
        txHash={txPendingHash}
        provider={provider}
        chainId={chainId}
        actionLabel={txPendingLabel || pendingAction || 'Transaction'}
        onClose={clearTxPending}
        onConfirmed={() => {
          console.log('[App] Transaction confirmed, calling refresh callback');
          clearTxPending();
          if (txRefreshCallback) {
            console.log('[App] Executing txRefreshCallback');
            void txRefreshCallback();
            setTxRefreshCallback(null);
          } else {
            console.log('[App] No txRefreshCallback available');
          }
        }}
        onError={setError}
      />

      <DisconnectModal
        isOpen={disconnectModalOpen}
        onClose={() => setDisconnectModalOpen(false)}
        onDisconnect={() => {
          disconnectWallet();
          setDisconnectModalOpen(false);
        }}
        walletAddress={walletAddress || ''}
        chainId={chainId}
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
        isOpen={error !== null}
        error={error || ''}
        onClose={() => {
          setError(null);
        }}
        onRetry={hasLoadError ? retryLoadIteration : undefined}
        title={hasLoadError ? 'Error Loading Program' : 'Transaction Error'}
      />

      {/* Header - will be updated to use Link in next step */}
      <Header
        walletAddress={walletAddress}
        onConnect={connectWallet}
        correctNetwork={correctNetwork}
        chainId={chainId}
        pendingAction={pendingAction}
        onSwitchNetwork={() => setSwitchNetworkModalOpen(true)}
        onOpenDisconnect={() => setDisconnectModalOpen(true)}
        currentPage={currentPage}
        onNavigate={(_page) => {
          // This will be replaced with navigate() in Header component
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        showIterationTab={Boolean(currentIteration)}
        showBadgesTab={walletAddress !== null && !isOwner}
        currentIteration={currentIteration?.iteration ?? null}
      />

      {/* Main content with Routes */}
      <main className={`pob-main relative z-10 ${currentPage === 'iteration' && showIterationPage ? 'pob-main--desktop' : ''}`}>
        <Routes>
          {/* Home page - Iterations list */}
          <Route
            path="/"
            element={
              <IterationsPage
                filteredIterations={filteredIterations}
                selectedIteration={selectedIterationNumber}
                iterationStatuses={iterationStatuses}
                onSelectIteration={(iteration: number) => {
                  setSelectedIteration(iteration);
                  // Navigation will happen via Link in IterationsPage
                }}
                walletAddress={walletAddress}
                chainId={chainId}
                signer={signer}
                runTransaction={runTransaction}
                refreshIterations={refreshIterations}
                isLoading={iterationsLoading}
              />
            }
          />

          {/* Iteration detail page */}
          <Route
            path="/iteration/:iterationNumber"
            element={
              showIterationPage ? (
                <IterationPage
                    currentIteration={currentIteration}
                    statusBadge={statusBadge}
                    iterationTimes={iterationTimes}
                    projects={projects}
                    shuffledProjects={shuffledProjects}
                    loading={loading}
                    roles={roles}
                    isOwner={isOwner}
                    statusFlags={statusFlags}
                    communityBadges={communityBadges}
                    badges={badges}
                    devRelVote={devRelVote}
                    daoHicVote={daoHicVote}
                    entityVotes={entityVotes}
                    pendingAction={pendingAction}
                    walletAddress={walletAddress}
                    chainId={chainId}
                    projectsLocked={projectsLocked}
                    contractLocked={contractLocked}
                    devRelAccount={devRelAccount}
                    daoHicVoters={daoHicVoters}
                    winner={winner}
                    voteCounts={voteCounts}
                    totalCommunityVoters={totalCommunityVoters}
                    openAdminSection={openAdminSection}
                    signer={signer}
                    publicProvider={publicProvider}
                    JurySC_01ABI={JurySC_01ABI}
                    getProjectLabel={getProjectLabel}
                    executeMint={executeMint}
                    executeVote={executeVote}
                    executeClaim={executeClaim}
                    handleToggleAdminSection={handleToggleAdminSection}
                    runTransaction={runTransaction}
                    refreshVotingData={refreshVotingData}
                    refreshProjects={refreshProjects}
                    refreshOwnerData={refreshOwnerData}
                    refreshBadges={refreshBadges}
                    setPendingRemovalProject={setPendingRemovalProject}
                    setPendingRemovalVoter={setPendingRemovalVoter}
                    setError={setError}
                    onOpenDisconnect={() => setDisconnectModalOpen(true)}
                    onConnect={connectWallet}
                    votingMode={votingMode}
                    projectScores={projectScores}
                    setVotingMode={setVotingMode}
                  />
              ) : (
                <NotFoundPage />
              )
            }
          />

          {/* Project metadata page */}
          <Route
            path="/iteration/:iterationNumber/metadata"
            element={
              <ProjectMetadataPage
                projects={projects}
                walletAddress={walletAddress}
                chainId={chainId}
                contractAddress={currentIteration?.jurySC ?? null}
                signer={signer}
                votingActive={statusFlags.isActive && !statusFlags.votingEnded}
              />
            }
          />

          {/* Iteration metadata page */}
          <Route
            path="/iteration/:iterationNumber/details"
            element={
              <IterationMetadataPage
                currentIteration={currentIteration}
                walletAddress={walletAddress}
                chainId={chainId}
                signer={signer}
                votingActive={statusFlags.isActive && !statusFlags.votingEnded}
                isOwner={isOwner}
              />
            }
          />

          {/* Badges page */}
          <Route
            path="/badges"
            element={
              <BadgesPage
                badges={badges}
                walletAddress={walletAddress}
                loading={loading}
              />
            }
          />

          {/* FAQ page */}
          <Route path="/faq" element={<FaqPage chainId={chainId} />} />

          {/* Forum pages */}
          <Route
            path="/forum"
            element={<ForumPage walletAddress={walletAddress} />}
          />
          <Route
            path="/forum/:tweetId"
            element={<ForumPage walletAddress={walletAddress} />}
          />

          {/* 404 - catch all */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default App;
