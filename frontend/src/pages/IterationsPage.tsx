import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Contract, isAddress } from 'ethers';
import type { JsonRpcSigner } from 'ethers';
import type { Iteration, IterationStatus } from '~/interfaces';
import IterationSection from '~/components/IterationSection';
import Modal from '~/components/Modal';
import PoBRegistryABI from '~/abis/PoBRegistry.json';
import JurySCABI from '~/abis/JurySC_02_v001.json';
import { REGISTRY_ADDRESSES } from '~/utils/registry';

interface IterationsPageProps {
  filteredIterations: Iteration[];
  selectedIteration: number | null;
  iterationStatuses: { [iterationNumber: number]: IterationStatus };
  onSelectIteration: (iteration: number) => void;
  walletAddress: string | null;
  chainId: number | null;
  signer: JsonRpcSigner | null;
  runTransaction: (label: string, action: () => Promise<unknown>, onConfirmed?: () => Promise<void>) => Promise<boolean>;
  refreshIterations: () => Promise<void>;
}

const IterationsPage = ({
  filteredIterations,
  selectedIteration,
  iterationStatuses,
  onSelectIteration,
  walletAddress,
  chainId,
  signer,
  runTransaction,
  refreshIterations,
}: IterationsPageProps) => {
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [roundModalOpen, setRoundModalOpen] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [registerForm, setRegisterForm] = useState({
    iterationId: '',
    chainId: chainId ? String(chainId) : '',
  });
  const [roundForm, setRoundForm] = useState({
    iterationId: '',
    roundId: '',
    jurySC: '',
  });
  const [autoFetchedData, setAutoFetchedData] = useState<{
    pob: string;
    deployBlockHint: string;
    chainId: string;
  } | null>(null);
  const [isFetchingJuryData, setIsFetchingJuryData] = useState(false);
  const [dataVerified, setDataVerified] = useState(false);

  const registryAddress = useMemo(() => {
    if (!chainId) return '';
    return REGISTRY_ADDRESSES[chainId] || '';
  }, [chainId]);

  const canSubmit = Boolean(walletAddress && signer && chainId && registryAddress);

  const openRegisterModal = () => {
    setRegisterError(null);
    setRegisterForm({
      iterationId: '',
      chainId: chainId ? String(chainId) : '',
    });
    setRegisterModalOpen(true);
  };

  const openRoundModal = (iteration: Iteration) => {
    setRoundError(null);
    const nextRound = iteration.round ? iteration.round + 1 : 1;
    setRoundForm({
      iterationId: String(iteration.iteration),
      roundId: String(nextRound),
      jurySC: '',
    });
    setAutoFetchedData(null);
    setDataVerified(false);
    setRoundModalOpen(true);
  };

  // Find the deployment block of a contract using binary search
  const findDeploymentBlock = async (
    contractAddress: string,
    provider: any
  ): Promise<number> => {
    const currentBlock = await provider.getBlockNumber();

    // Binary search to find the first block where contract has code
    let low = 0;
    let high = currentBlock;
    let deployBlock = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);

      try {
        const code = await provider.getCode(contractAddress, mid);

        if (code !== '0x') {
          // Contract exists at this block, search earlier
          deployBlock = mid;
          high = mid - 1;
        } else {
          // Contract doesn't exist yet, search later
          low = mid + 1;
        }
      } catch (error) {
        // If we get an error, try moving forward
        low = mid + 1;
      }
    }

    return deployBlock;
  };

  // Manual check function - only fetch when user clicks "Check"
  const handleCheckJurySC = async () => {
    setRoundError(null);
    setDataVerified(false);

    if (!roundForm.jurySC || !isAddress(roundForm.jurySC)) {
      setRoundError('Please enter a valid JurySC address.');
      return;
    }

    if (!signer || !chainId) {
      setRoundError('Connect a wallet to check contract data.');
      return;
    }

    setIsFetchingJuryData(true);
    try {
      const juryContract = new Contract(roundForm.jurySC, JurySCABI, signer);
      const provider = signer.provider!;

      // Only fetch what's required for addRound: pob (for validation) and deployBlockHint
      const [pobAddress, deployBlock] = await Promise.all([
        juryContract.pob(),
        findDeploymentBlock(roundForm.jurySC, provider),
      ]);

      console.log(`Found JurySC deployment at block ${deployBlock}`);

      // Validate PoB address is not zero address
      if (!pobAddress || pobAddress === '0x0000000000000000000000000000000000000000') {
        setRoundError('JurySC contract has not been initialized with a PoB NFT address. The PoB address is 0x0.');
        setAutoFetchedData(null);
        return;
      }

      setAutoFetchedData({
        pob: pobAddress,
        deployBlockHint: String(deployBlock),
        chainId: String(chainId),
      });
      setDataVerified(true);
    } catch (error) {
      console.error('Failed to fetch JurySC data:', error);
      setRoundError('Failed to fetch data from JurySC contract. Make sure the address is correct and the contract is deployed.');
      setAutoFetchedData(null);
    } finally {
      setIsFetchingJuryData(false);
    }
  };

  // Reset verification when JurySC address changes
  useEffect(() => {
    setDataVerified(false);
    setAutoFetchedData(null);
  }, [roundForm.jurySC]);

  const handleRegisterIteration = async (event: React.FormEvent) => {
    event.preventDefault();
    setRegisterError(null);

    if (!signer || !chainId || !registryAddress) {
      setRegisterError('Connect a wallet on a supported network to register iterations.');
      return;
    }

    const iterationId = Number.parseInt(registerForm.iterationId, 10);
    const iterationChainId = Number.parseInt(registerForm.chainId, 10);

    if (!Number.isInteger(iterationId) || iterationId <= 0) {
      setRegisterError('Enter a valid iteration number.');
      return;
    }
    if (!Number.isInteger(iterationChainId) || iterationChainId <= 0) {
      setRegisterError('Enter a valid chain ID.');
      return;
    }

    const registry = new Contract(registryAddress, PoBRegistryABI, signer);

    try {
      await runTransaction(
        'Register iteration',
        () => registry.registerIteration(iterationId, iterationChainId),
        refreshIterations,
      );
      setRegisterModalOpen(false);
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : 'Failed to register iteration.');
    }
  };

  const handleAddRound = async (event: React.FormEvent) => {
    event.preventDefault();
    setRoundError(null);

    if (!signer || !chainId || !registryAddress) {
      setRoundError('Connect a wallet on a supported network to add rounds.');
      return;
    }

    if (!dataVerified || !autoFetchedData) {
      setRoundError('Please click "Check" to verify contract data before adding the round.');
      return;
    }

    const iterationId = Number.parseInt(roundForm.iterationId, 10);
    const roundId = Number.parseInt(roundForm.roundId, 10);
    const deployBlockHint = Number.parseInt(autoFetchedData.deployBlockHint, 10);

    if (!Number.isInteger(iterationId) || iterationId <= 0) {
      setRoundError('Enter a valid iteration number.');
      return;
    }
    if (!Number.isInteger(roundId) || roundId <= 0) {
      setRoundError('Enter a valid round number.');
      return;
    }
    if (!isAddress(roundForm.jurySC)) {
      setRoundError('Enter a valid JurySC address.');
      return;
    }
    if (!isAddress(autoFetchedData.pob)) {
      setRoundError('Invalid PoB address fetched from JurySC.');
      return;
    }

    const registry = new Contract(registryAddress, PoBRegistryABI, signer);

    try {
      await runTransaction(
        'Add round',
        () => registry.addRound(
          iterationId,
          roundId,
          roundForm.jurySC,
          deployBlockHint
        ),
        refreshIterations,
      );
      setRoundModalOpen(false);
    } catch (error) {
      setRoundError(error instanceof Error ? error.message : 'Failed to add round.');
    }
  };

  return (
    <div className="pob-stack" id="iterations">
      <section className="pob-pane">
        <div className="space-y-4">
          <div>
            <h2 className="pob-pane__title text-3xl">Welcome to Proof-of-Builders! 👋</h2>
            <p className="text-sm text-[var(--pob-primary)] mt-1">
              Bitcoin security meets scalable Web3 infrastructure through Syscoin's zkSYS
            </p>
          </div>
          <div className="space-y-3 text-sm text-[var(--pob-text-muted)]">
            <p>
              <strong className="text-white">What's this about?</strong> This is an ongoing program where you can build real projects
              on Syscoin (UTXO, NEVM, and zkSYS) and get recognized for it. Your participation, votes, and results are recorded on-chain,
              making the evaluation process transparent and verifiable. Think of it as building your portfolio while contributing
              to the ecosystem.
            </p>
            <p>
              <strong className="text-white">Why it exists:</strong> Part of Ledger Architects' zkSYS Global Developer Onboarding Campaign,
              with a special focus on Latin America. We're here to help you learn Web3, collaborate with others, and build cool stuff on
              Syscoin. It's a bridge between learning, getting community feedback, and growing the ecosystem together.
            </p>
            <Link to="/faq" className="pob-button pob-button--compact mt-4 inline-block">
              Read the FAQ
            </Link>
          </div>
        </div>
      </section>
      <IterationSection
        title="Program Iterations"
        iterations={filteredIterations}
        selectedIteration={selectedIteration}
        iterationStatuses={iterationStatuses}
        onSelectIteration={onSelectIteration}
        onAddRound={openRoundModal}
        headerAction={(
          <button
            type="button"
            onClick={openRegisterModal}
            className="pob-button pob-button--outline pob-button--compact"
            disabled={!canSubmit}
            style={{
              opacity: !canSubmit ? 0.6 : 1,
              cursor: !canSubmit ? 'not-allowed' : 'pointer',
            }}
          >
            Add iteration
          </button>
        )}
      />

      <Modal
        isOpen={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        maxWidth="md"
      >
        <div className="pob-pane">
          <div className="pob-pane__heading">
            <h3 className="pob-pane__title">Register iteration</h3>
          </div>
          <form onSubmit={handleRegisterIteration} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--pob-text)]">
                Iteration ID
              </label>
              <input
                type="number"
                value={registerForm.iterationId}
                onChange={(event) => setRegisterForm({ ...registerForm, iterationId: event.target.value })}
                className="pob-input"
                min={1}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--pob-text)]">
                Chain ID
              </label>
              <input
                type="number"
                value={registerForm.chainId}
                onChange={(event) => setRegisterForm({ ...registerForm, chainId: event.target.value })}
                className="pob-input"
                min={1}
                required
              />
            </div>

            <div className="pob-info" style={{ marginTop: '1rem' }}>
              <p className="text-xs text-[var(--pob-text-muted)]">
                Note: After registering the iteration, you'll need to add rounds and set iteration metadata (name, description, etc.) separately.
              </p>
            </div>

            {registerError && (
              <div className="pob-warning">
                <p className="text-xs">{registerError}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="pob-button pob-button--outline flex-1"
                onClick={() => setRegisterModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pob-button flex-1"
              >
                Register
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal
        isOpen={roundModalOpen}
        onClose={() => setRoundModalOpen(false)}
        maxWidth="md"
      >
        <div className="pob-pane">
          <div className="pob-pane__heading">
            <h3 className="pob-pane__title">Add round</h3>
          </div>
          <form onSubmit={handleAddRound} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--pob-text)]">
                Iteration ID
              </label>
              <input
                type="number"
                value={roundForm.iterationId}
                onChange={(event) => setRoundForm({ ...roundForm, iterationId: event.target.value })}
                className="pob-input"
                min={1}
                required
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
              <p className="text-xs text-[var(--pob-text-muted)]">Pre-filled from selected iteration</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--pob-text)]">
                Round ID
              </label>
              <input
                type="number"
                value={roundForm.roundId}
                onChange={(event) => setRoundForm({ ...roundForm, roundId: event.target.value })}
                className="pob-input"
                min={1}
                required
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
              <p className="text-xs text-[var(--pob-text-muted)]">Auto-incremented next round number</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--pob-text)]">
                JurySC address *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={roundForm.jurySC}
                  onChange={(event) => setRoundForm({ ...roundForm, jurySC: event.target.value })}
                  className="pob-input flex-1"
                  placeholder="0x..."
                  required
                />
                <button
                  type="button"
                  onClick={handleCheckJurySC}
                  disabled={isFetchingJuryData || !roundForm.jurySC || !isAddress(roundForm.jurySC)}
                  className="pob-button pob-button--compact"
                  style={{
                    minWidth: '80px',
                    opacity: isFetchingJuryData || !roundForm.jurySC || !isAddress(roundForm.jurySC) ? 0.6 : 1,
                    cursor: isFetchingJuryData || !roundForm.jurySC || !isAddress(roundForm.jurySC) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isFetchingJuryData ? '...' : dataVerified ? '✓ Checked' : 'Check'}
                </button>
              </div>
              <p className="text-xs text-[var(--pob-text-muted)]">
                {isFetchingJuryData
                  ? 'Fetching contract data from blockchain...'
                  : dataVerified
                  ? '✓ Contract data verified and loaded'
                  : 'Enter JurySC address and click "Check" to verify'}
              </p>
            </div>

            {autoFetchedData && dataVerified && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--pob-text)]">
                    PoB NFT address (auto-fetched)
                  </label>
                  <input
                    type="text"
                    value={autoFetchedData.pob}
                    className="pob-input"
                    readOnly
                    style={{ opacity: 0.7, cursor: 'not-allowed' }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[var(--pob-text)]">
                    Deploy block hint (auto-detected)
                  </label>
                  <input
                    type="text"
                    value={autoFetchedData.deployBlockHint}
                    className="pob-input"
                    readOnly
                    style={{ opacity: 0.7, cursor: 'not-allowed' }}
                  />
                  <p className="text-xs text-[var(--pob-text-muted)]">Block number where contract was deployed - optimizes badge loading</p>
                </div>
              </>
            )}

            {roundError && (
              <div className="pob-warning">
                <p className="text-xs">{roundError}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="pob-button pob-button--outline flex-1"
                onClick={() => setRoundModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pob-button flex-1"
                disabled={!dataVerified}
                style={{
                  opacity: !dataVerified ? 0.6 : 1,
                  cursor: !dataVerified ? 'not-allowed' : 'pointer',
                }}
                title={!dataVerified ? 'Click "Check" to verify contract data first' : undefined}
              >
                Add round
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
};

export default IterationsPage;
