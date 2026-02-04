<script lang="ts">
  import { Link } from 'svelte-routing';
  import { Contract, isAddress } from 'ethers';
  import type { JsonRpcSigner, JsonRpcProvider } from 'ethers';
  import type { Iteration, IterationStatus } from '~/interfaces';
  import IterationSection from '~/components/IterationSection.svelte';
  import Modal from '~/components/Modal.svelte';
  import PoBRegistryABI from '~/abis/PoBRegistry.json';
  import JurySCABI from '~/abis/JurySC_02_v001.json';
  import { REGISTRY_ADDRESSES } from '~/utils/registry';
  import { getPublicProvider } from '~/utils/provider';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    filteredIterations: Iteration[];
    selectedIteration: number | null;
    iterationStatuses: { [iterationNumber: number]: IterationStatus };
    onSelectIteration: (iteration: number) => void;
    walletAddress: string | null;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    runTransaction: (label: string, action: () => Promise<unknown>, onConfirmed?: () => Promise<void>) => Promise<boolean>;
    refreshIterations: () => Promise<void>;
    isLoading?: boolean;
  }

  let {
    filteredIterations,
    selectedIteration,
    iterationStatuses,
    onSelectIteration,
    walletAddress,
    chainId,
    signer,
    runTransaction,
    refreshIterations,
    isLoading = false,
  }: Props = $props();

  let registerModalOpen = $state(false);
  let roundModalOpen = $state(false);
  let registerError = $state<string | null>(null);
  let roundError = $state<string | null>(null);
  let registerForm = $state({
    iterationId: '',
    chainId: '',
  });

  // Update chainId when it changes from props
  $effect(() => {
    if (chainId && !registerForm.chainId) {
      registerForm.chainId = String(chainId);
    }
  });
  let roundForm = $state({
    iterationId: '',
    roundId: '',
    jurySC: '',
  });
  let autoFetchedData = $state<{
    pob: string;
    deployBlockHint: string;
    chainId: string;
  } | null>(null);
  let isFetchingJuryData = $state(false);
  let dataVerified = $state(false);
  let isRegistryOwner = $state(false);

  const registryAddress = $derived(chainId ? REGISTRY_ADDRESSES[chainId] || '' : '');

  // Check if the connected wallet is the registry owner
  async function checkRegistryOwner() {
    if (!walletAddress || !chainId || !registryAddress) {
      isRegistryOwner = false;
      return;
    }

    try {
      const provider = getPublicProvider(chainId) as JsonRpcProvider;
      const registry = new Contract(registryAddress, PoBRegistryABI, provider);
      const owner = await registry.owner();
      isRegistryOwner = owner.toLowerCase() === walletAddress.toLowerCase();
    } catch (error) {
      console.error('Failed to check registry owner:', error);
      isRegistryOwner = false;
    }
  }

  // Check registry owner when wallet/chain changes
  $effect(() => {
    checkRegistryOwner();
  });

  const canSubmit = $derived(Boolean(walletAddress && signer && chainId && registryAddress && isRegistryOwner));

  function openRegisterModal() {
    registerError = null;
    registerForm = {
      iterationId: '',
      chainId: chainId ? String(chainId) : '',
    };
    registerModalOpen = true;
  }

  function openRoundModal(iteration: Iteration) {
    roundError = null;
    const nextRound = iteration.round ? iteration.round + 1 : 1;
    roundForm = {
      iterationId: String(iteration.iteration),
      roundId: String(nextRound),
      jurySC: '',
    };
    autoFetchedData = null;
    dataVerified = false;
    roundModalOpen = true;
  }

  // Find deployment block using binary search
  async function findDeploymentBlock(contractAddress: string, provider: any): Promise<number> {
    const currentBlock = await provider.getBlockNumber();
    let low = 0;
    let high = currentBlock;
    let deployBlock = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      try {
        const code = await provider.getCode(contractAddress, mid);
        if (code !== '0x') {
          deployBlock = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      } catch (error) {
        low = mid + 1;
      }
    }

    return deployBlock;
  }

  async function handleCheckJurySC() {
    roundError = null;
    dataVerified = false;

    if (!roundForm.jurySC || !isAddress(roundForm.jurySC)) {
      roundError = 'Please enter a valid JurySC address.';
      return;
    }

    if (!signer || !chainId) {
      roundError = 'Connect a wallet to check contract data.';
      return;
    }

    isFetchingJuryData = true;
    try {
      const juryContract = new Contract(roundForm.jurySC, JurySCABI, signer);
      const provider = signer.provider!;

      const [pobAddress, deployBlock] = await Promise.all([
        juryContract.pob(),
        findDeploymentBlock(roundForm.jurySC, provider),
      ]);

      console.log(`Found JurySC deployment at block ${deployBlock}`);

      if (!pobAddress || pobAddress === '0x0000000000000000000000000000000000000000') {
        roundError = 'JurySC contract has not been initialized with a PoB NFT address. The PoB address is 0x0.';
        autoFetchedData = null;
        return;
      }

      autoFetchedData = {
        pob: pobAddress,
        deployBlockHint: String(deployBlock),
        chainId: String(chainId),
      };
      dataVerified = true;
    } catch (error) {
      console.error('Failed to fetch JurySC data:', error);
      roundError = 'Failed to fetch data from JurySC contract. Make sure the address is correct and the contract is deployed.';
      autoFetchedData = null;
    } finally {
      isFetchingJuryData = false;
    }
  }

  // Reset verification when JurySC address changes
  $effect(() => {
    if (roundForm.jurySC) {
      dataVerified = false;
      autoFetchedData = null;
    }
  });

  async function handleRegisterIteration(event: SubmitEvent) {
    event.preventDefault();
    registerError = null;

    if (!signer || !chainId || !registryAddress) {
      registerError = 'Connect a wallet on a supported network to register iterations.';
      return;
    }

    const iterationId = Number.parseInt(registerForm.iterationId, 10);
    const iterationChainId = Number.parseInt(registerForm.chainId, 10);

    if (!Number.isInteger(iterationId) || iterationId <= 0) {
      registerError = 'Enter a valid iteration number.';
      return;
    }
    if (!Number.isInteger(iterationChainId) || iterationChainId <= 0) {
      registerError = 'Enter a valid chain ID.';
      return;
    }

    const registry = new Contract(registryAddress, PoBRegistryABI, signer);

    try {
      await runTransaction(
        'Register iteration',
        () => registry.registerIteration(iterationId, iterationChainId),
        refreshIterations,
      );
      registerModalOpen = false;
    } catch (error) {
      registerError = error instanceof Error ? error.message : 'Failed to register iteration.';
    }
  }

  async function handleAddRound(event: SubmitEvent) {
    event.preventDefault();
    roundError = null;

    if (!signer || !chainId || !registryAddress) {
      roundError = 'Connect a wallet on a supported network to add rounds.';
      return;
    }

    if (!dataVerified || !autoFetchedData) {
      roundError = 'Please click "Check" to verify contract data before adding the round.';
      return;
    }

    const iterationId = Number.parseInt(roundForm.iterationId, 10);
    const roundId = Number.parseInt(roundForm.roundId, 10);
    const deployBlockHint = Number.parseInt(autoFetchedData.deployBlockHint, 10);

    if (!Number.isInteger(iterationId) || iterationId <= 0) {
      roundError = 'Enter a valid iteration number.';
      return;
    }
    if (!Number.isInteger(roundId) || roundId <= 0) {
      roundError = 'Enter a valid round number.';
      return;
    }
    if (!isAddress(roundForm.jurySC)) {
      roundError = 'Enter a valid JurySC address.';
      return;
    }
    if (!isAddress(autoFetchedData.pob)) {
      roundError = 'Invalid PoB address fetched from JurySC.';
      return;
    }

    const registry = new Contract(registryAddress, PoBRegistryABI, signer);

    try {
      await runTransaction(
        'Add round',
        () => registry.addRound(iterationId, roundId, roundForm.jurySC, deployBlockHint),
        refreshIterations,
      );
      roundModalOpen = false;
    } catch (error) {
      roundError = error instanceof Error ? error.message : 'Failed to add round.';
    }
  }
</script>

<div class="pob-stack" id="iterations">
  <section class="pob-pane">
    <div class="space-y-4">
      <div>
        <h2 class="pob-pane__title text-3xl">Welcome to Proof-of-Builders! 👋</h2>
        <p class="text-sm text-[var(--pob-primary)] mt-1">
          Bitcoin security meets scalable Web3 infrastructure through Syscoin's zkSYS
        </p>
      </div>
      <div class="space-y-3 text-sm text-[var(--pob-text-muted)]">
        <p>
          <strong class="text-white">What's this about?</strong> This is an ongoing program where you can build real projects
          on Syscoin (UTXO, NEVM, and zkSYS) and get recognized for it. Your participation, votes, and results are recorded on-chain,
          making the evaluation process transparent and verifiable. Think of it as building your portfolio while contributing
          to the ecosystem.
        </p>
        <p>
          <strong class="text-white">Why it exists:</strong> Part of Ledger Architects' zkSYS Global Developer Onboarding Campaign,
          with a special focus on Latin America. We're here to help you learn Web3, collaborate with others, and build cool stuff on
          Syscoin. It's a bridge between learning, getting community feedback, and growing the ecosystem together.
        </p>
        <Link to="/faq" class="pob-button pob-button--compact mt-4 inline-block">
          Read the FAQ
        </Link>
      </div>
    </div>
  </section>

  {#if isLoading}
    <section class="pob-pane">
      <div class="flex flex-col items-center justify-center py-12 gap-4">
        <ProgressSpinner size={48} />
        <p class="text-sm text-[var(--pob-text-muted)]">Loading iterations...</p>
      </div>
    </section>
  {:else}
    <IterationSection
      title="Program Iterations"
      iterations={filteredIterations}
      {selectedIteration}
      {iterationStatuses}
      {onSelectIteration}
      onAddRound={walletAddress && isRegistryOwner ? openRoundModal : undefined}
      emptyMessage={walletAddress && isRegistryOwner
        ? 'No iterations registered yet. Use the "Add iteration" button above to get started.'
        : undefined}
    >
      {#snippet headerAction()}
        {#if walletAddress && isRegistryOwner}
          <button
            type="button"
            onclick={openRegisterModal}
            class="pob-button pob-button--outline pob-button--compact"
            disabled={!canSubmit}
            style="opacity: {!canSubmit ? 0.6 : 1}; cursor: {!canSubmit ? 'not-allowed' : 'pointer'};"
          >
            Add iteration
          </button>
        {/if}
      {/snippet}
    </IterationSection>
  {/if}

  <Modal isOpen={registerModalOpen} onClose={() => registerModalOpen = false} maxWidth="md">
    {#snippet children()}
      <div class="pob-pane">
        <div class="pob-pane__heading">
          <h3 class="pob-pane__title">Register iteration</h3>
        </div>
        <form onsubmit={handleRegisterIteration} class="space-y-4">
          <div class="space-y-1">
            <label for="register-iteration-id" class="text-xs font-medium text-[var(--pob-text)]">
              Iteration ID
            </label>
            <input
              id="register-iteration-id"
              type="number"
              bind:value={registerForm.iterationId}
              class="pob-input"
              min="1"
              required
            />
          </div>
          <div class="space-y-1">
            <label for="register-chain-id" class="text-xs font-medium text-[var(--pob-text)]">
              Chain ID
            </label>
            <input
              id="register-chain-id"
              type="number"
              bind:value={registerForm.chainId}
              class="pob-input"
              min="1"
              required
            />
          </div>

          <div class="pob-info" style="margin-top: 1rem;">
            <p class="text-xs text-[var(--pob-text-muted)]">
              Note: After registering the iteration, you'll need to add rounds and set iteration metadata (name, description, etc.) separately.
            </p>
          </div>

          {#if registerError}
            <div class="pob-warning">
              <p class="text-xs">{registerError}</p>
            </div>
          {/if}

          <div class="flex gap-2 pt-2">
            <button
              type="button"
              class="pob-button pob-button--outline flex-1"
              onclick={() => registerModalOpen = false}
            >
              Cancel
            </button>
            <button type="submit" class="pob-button flex-1">
              Register
            </button>
          </div>
        </form>
      </div>
    {/snippet}
  </Modal>

  <Modal isOpen={roundModalOpen} onClose={() => roundModalOpen = false} maxWidth="md">
    {#snippet children()}
      <div class="pob-pane">
        <div class="pob-pane__heading">
          <h3 class="pob-pane__title">Add round</h3>
        </div>
        <form onsubmit={handleAddRound} class="space-y-4">
          <div class="space-y-1">
            <label for="round-iteration-id" class="text-xs font-medium text-[var(--pob-text)]">
              Iteration ID
            </label>
            <input
              id="round-iteration-id"
              type="number"
              bind:value={roundForm.iterationId}
              class="pob-input"
              min="1"
              required
              readonly
              style="opacity: 0.7; cursor: not-allowed;"
            />
            <p class="text-xs text-[var(--pob-text-muted)]">Pre-filled from selected iteration</p>
          </div>
          <div class="space-y-1">
            <label for="round-round-id" class="text-xs font-medium text-[var(--pob-text)]">
              Round ID
            </label>
            <input
              id="round-round-id"
              type="number"
              bind:value={roundForm.roundId}
              class="pob-input"
              min="1"
              required
              readonly
              style="opacity: 0.7; cursor: not-allowed;"
            />
            <p class="text-xs text-[var(--pob-text-muted)]">Auto-incremented next round number</p>
          </div>
          <div class="space-y-1">
            <label for="round-jurysc" class="text-xs font-medium text-[var(--pob-text)]">
              JurySC address *
            </label>
            <div class="flex gap-2">
              <input
                id="round-jurysc"
                type="text"
                bind:value={roundForm.jurySC}
                class="pob-input flex-1"
                placeholder="0x..."
                required
              />
              <button
                type="button"
                onclick={handleCheckJurySC}
                disabled={isFetchingJuryData || !roundForm.jurySC || !isAddress(roundForm.jurySC)}
                class="pob-button pob-button--compact"
                style="min-width: 80px; opacity: {isFetchingJuryData || !roundForm.jurySC || !isAddress(roundForm.jurySC) ? 0.6 : 1}; cursor: {isFetchingJuryData || !roundForm.jurySC || !isAddress(roundForm.jurySC) ? 'not-allowed' : 'pointer'};"
              >
                {isFetchingJuryData ? '...' : dataVerified ? '✓ Checked' : 'Check'}
              </button>
            </div>
            <p class="text-xs text-[var(--pob-text-muted)]">
              {isFetchingJuryData
                ? 'Fetching contract data from blockchain...'
                : dataVerified
                  ? '✓ Contract data verified and loaded'
                  : 'Enter JurySC address and click "Check" to verify'}
            </p>
          </div>

          {#if autoFetchedData && dataVerified}
            <div class="space-y-1">
              <label for="round-pob" class="text-xs font-medium text-[var(--pob-text)]">
                PoB NFT address (auto-fetched)
              </label>
              <input
                id="round-pob"
                type="text"
                value={autoFetchedData.pob}
                class="pob-input"
                readonly
                style="opacity: 0.7; cursor: not-allowed;"
              />
            </div>
            <div class="space-y-1">
              <label for="round-deploy-block" class="text-xs font-medium text-[var(--pob-text)]">
                Deploy block hint (auto-detected)
              </label>
              <input
                id="round-deploy-block"
                type="text"
                value={autoFetchedData.deployBlockHint}
                class="pob-input"
                readonly
                style="opacity: 0.7; cursor: not-allowed;"
              />
              <p class="text-xs text-[var(--pob-text-muted)]">Block number where contract was deployed - optimizes badge loading</p>
            </div>
          {/if}

          {#if roundError}
            <div class="pob-warning">
              <p class="text-xs">{roundError}</p>
            </div>
          {/if}

          <div class="flex gap-2 pt-2">
            <button
              type="button"
              class="pob-button pob-button--outline flex-1"
              onclick={() => roundModalOpen = false}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="pob-button flex-1"
              disabled={!dataVerified}
              style="opacity: {!dataVerified ? 0.6 : 1}; cursor: {!dataVerified ? 'not-allowed' : 'pointer'};"
              title={!dataVerified ? 'Click "Check" to verify contract data first' : undefined}
            >
              Add round
            </button>
          </div>
        </form>
      </div>
    {/snippet}
  </Modal>
</div>
