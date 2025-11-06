import { useCallback, useMemo, useState } from 'react';
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

// Hooks
import {
  useWallet,
  useIteration,
  useIterationStatuses,
  useContractState,
  useTransactions,
  useModals,
  useAdminPanel,
  useProjectMetadata,
  usePublicProvider,
} from '~/hooks';

// Pages
import IterationsPage from '~/pages/IterationsPage';
import BadgesPage from '~/pages/BadgesPage';
import FaqPage from '~/pages/FaqPage';
import IterationPage from '~/pages/IterationPage';
import type { IterationStatus } from '~/interfaces';

type PageType = 'iterations' | 'iteration' | 'badges' | 'faq';

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('iterations');
  const [error, setError] = useState<string | null>(null);

  // Project metadata
  const { projectMetadata, projectMetadataLoading } = useProjectMetadata();

  // Contract state depends on wallet and iteration, so we need resetState first
  const resetContractState = useCallback(() => {
    // This will be set by useContractState's resetState
  }, []);

  // Wallet state
  const { provider, signer, walletAddress, chainId, connectWallet, disconnectWallet } = useWallet(resetContractState);

  // Iteration management
  const { selectedIterationNumber, setSelectedIteration, filteredIterations, currentIteration } =
    useIteration(chainId);

  // Public provider for read-only operations
  const readChainId = currentIteration?.chainId ?? chainId;
  const publicProvider = usePublicProvider(readChainId);

  console.log('[App] Read chain setup:', {
    walletChainId: chainId,
    currentIterationChainId: currentIteration?.chainId,
    readChainId,
    hasPublicProvider: !!publicProvider,
  });

  // Network validation - allow reading from any iteration network even if wallet is on different network
  const correctNetwork =
    chainId === SYS_COIN_ID || chainId === SYS_TESTNET_ID || chainId === HARDHAT_ID || chainId === null;

  // For reading iteration data, we should allow any network if we have a public provider
  const canReadIterationData = publicProvider !== null;

  console.log('[App] Network validation:', {
    walletNetwork: chainId,
    correctNetwork,
    canReadIterationData,
  });

  // Iteration statuses - single source of truth for all iteration states
  const { statuses: iterationStatuses, updateIterationStatus } = useIterationStatuses(
    filteredIterations,
    publicProvider,
    canReadIterationData,
  );

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
  } = useContractState(signer, walletAddress, currentIteration, correctNetwork, publicProvider, chainId, projectMetadata, projectMetadataLoading, filteredIterations, currentPage);

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
    // Fisher-Yates shuffle algorithm to randomize project order
    const shuffled = [...projects];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [projects]);

  // Get status for current iteration from the single source of truth
  const iterationStatus = useMemo((): IterationStatus => {
    if (!currentIteration) return 'upcoming';
    const status = iterationStatuses[currentIteration.iteration];
    return status ?? 'upcoming';
  }, [currentIteration, iterationStatuses]);

  // Update statuses map when statusFlags changes (keep them in sync)
  useMemo(() => {
    if (currentIteration && statusFlags) {
      let newStatus: IterationStatus = 'upcoming';
      if (statusFlags.votingEnded) {
        newStatus = 'ended';
      } else if (statusFlags.isActive) {
        newStatus = 'active';
      }

      // Only update if different from current
      const currentStatus = iterationStatuses[currentIteration.iteration];
      if (currentStatus !== newStatus) {
        updateIterationStatus(currentIteration.iteration, newStatus);
      }
    }
  }, [currentIteration, statusFlags, iterationStatuses, updateIterationStatus]);

  const statusBadge = useMemo(() => {
    if (iterationStatus === 'upcoming') return { label: 'Upcoming', color: 'pob-pill pob-pill--upcoming' };
    if (iterationStatus === 'ended') return { label: 'Ended', color: 'pob-pill pob-pill--ended' };
    return { label: 'Active', color: 'pob-pill pob-pill--active' };
  }, [iterationStatus]);

  // Show iteration page if there's a current iteration (wallet not required for viewing)
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
          // Call the targeted refresh callback if available
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

      {/* Header */}
      <Header
        walletAddress={walletAddress}
        onConnect={connectWallet}
        correctNetwork={correctNetwork}
        chainId={chainId}
        pendingAction={pendingAction}
        onSwitchNetwork={() => setSwitchNetworkModalOpen(true)}
        onOpenDisconnect={() => setDisconnectModalOpen(true)}
        currentPage={currentPage}
        onNavigate={(page) => {
          setCurrentPage(page);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        showIterationTab={Boolean(currentIteration)}
        showBadgesTab={walletAddress !== null && !isOwner}
        currentIteration={currentIteration?.iteration ?? null}
      />

      {/* Main content */}
      <main
        className={`pob-main relative z-10 ${currentPage === 'iteration' && showIterationPage ? 'pob-main--desktop' : ''}`}
      >
        {currentPage === 'iteration' && showIterationPage ? (
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
        ) : null}

        {currentPage === 'iterations' && (
          <IterationsPage
            filteredIterations={filteredIterations}
            selectedIteration={selectedIterationNumber}
            iterationStatuses={iterationStatuses}
            onSelectIteration={(iteration: number) => {
              setSelectedIteration(iteration);
              setCurrentPage('iteration');
            }}
          />
        )}

        {currentPage === 'badges' && (
          <BadgesPage
            badges={badges}
            walletAddress={walletAddress}
            iterations={filteredIterations}
            onSelectIteration={(iteration: number) => {
              setSelectedIteration(iteration);
              setCurrentPage('iteration');
            }}
          />
        )}

        {currentPage === 'faq' && <FaqPage />}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default App;
