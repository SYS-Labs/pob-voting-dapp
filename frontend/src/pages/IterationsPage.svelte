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
    error?: string | null;
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
    error = null,
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

  const orderedIterations = $derived([...filteredIterations].sort((a, b) => {
    if (b.iteration !== a.iteration) return b.iteration - a.iteration;
    return (b.round ?? 0) - (a.round ?? 0);
  }));

  const howItWorks = [
    {
      title: 'Builders submit work',
      description: 'Projects enter an iteration with public metadata and verifiable contract state.',
    },
    {
      title: 'Jurors and community vote',
      description: 'SMT, DAO HIC, and community badge holders help decide which work stands out.',
    },
    {
      title: 'Results settle on-chain',
      description: 'Voting mode, entity votes, winners, and final state remain readable after the round ends.',
    },
    {
      title: 'Recognition becomes history',
      description: 'Badges and certificates preserve participation, winning, and contributor records.',
    },
  ];

  const aboutPeople = [
    {
      role: 'Initiative',
      name: 'Patrick / 1DigitalCrypto',
      description: 'PoB began from the Ledger Architects initiative to turn builder participation into transparent Syscoin-native recognition.',
      href: 'https://x.com/1DigitalC',
    },
    {
      role: 'LATAM leadership',
      name: 'Fernando Paredes / DevElCuy',
      description: 'Fernando leads execution in Latin America, mentoring builders and coordinating cohorts, events, and institutional relationships.',
      href: 'https://x.com/DevElCuy',
    },
    {
      role: 'Community',
      name: 'Percy Meneses',
      description: 'Percy supports community management and helps as a speaker so participants stay informed, welcomed, and ready to build.',
      href: 'https://x.com/willdev08',
    },
  ];

  function getIterationStatus(iteration: Iteration): IterationStatus {
    return iterationStatuses[iteration.iteration] ?? iteration.status ?? 'upcoming';
  }

  function getStatusBadgeClass(status: IterationStatus) {
    if (status === 'active') return 'pob-pill pob-pill--active';
    if (status === 'ended') return 'pob-pill pob-pill--ended';
    return 'pob-pill pob-pill--upcoming';
  }

  function getStatusLabel(status: IterationStatus) {
    if (status === 'active') return 'Active now';
    if (status === 'ended') return 'Completed';
    return 'Upcoming';
  }

  const activeIterations = $derived(orderedIterations.filter((iteration) => getIterationStatus(iteration) === 'active'));
  const completedIterations = $derived(orderedIterations.filter((iteration) => getIterationStatus(iteration) === 'ended'));
  const registeredRounds = $derived(orderedIterations.filter((iteration) => iteration.round && iteration.jurySC && iteration.pob));
  const primaryIteration = $derived(activeIterations[0] ?? registeredRounds[0] ?? orderedIterations[0] ?? null);
  const primaryIterationStatus = $derived(primaryIteration ? getIterationStatus(primaryIteration) : null);
  const uniqueNetworkCount = $derived(new Set(filteredIterations.map((iteration) => iteration.chainId)).size);
  const profilePath = $derived(walletAddress ? `/profile/${walletAddress}` : null);

  const metrics = $derived([
    { label: 'Registered iterations', value: String(filteredIterations.length) },
    { label: 'Active rounds', value: String(activeIterations.length) },
    { label: 'Completed rounds', value: String(completedIterations.length) },
    { label: 'Networks', value: String(uniqueNetworkCount) },
  ]);

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

<div class="pob-stack pob-home" id="iterations">
  <section class="pob-pane pob-surface--quiet pob-surface--accented pob-home-hero" aria-labelledby="pob-home-title">
    <div class="pob-home-hero__copy">
      <p class="pob-eyebrow">Proof-of-Builders</p>
      <h2 id="pob-home-title" class="pob-home-hero__title">
        Where builders earn recognition and the community helps decide what matters.
      </h2>
      <p class="pob-home-hero__lede">
        PoB brings project work, juror voting, community badges, and certificates into one verifiable Syscoin participation record.
      </p>

      <div class="pob-home-hero__actions">
        {#if primaryIteration}
          <Link
            to="/iteration/{primaryIteration.iteration}"
            class="pob-button"
            onclick={() => onSelectIteration(primaryIteration.iteration)}
          >
            {primaryIterationStatus === 'active' ? 'Vote in current round' : 'Explore iterations'}
          </Link>
        {:else}
          <a href="#iterations-list" class="pob-button">Explore iterations</a>
        {/if}
        <Link to="/faq" class="pob-button pob-button--outline">Learn how PoB works</Link>
      </div>
    </div>

    <aside class="pob-home-spotlight" aria-label="Current round spotlight">
      <p class="pob-eyebrow pob-eyebrow--muted">What is happening now</p>
      {#if primaryIteration && primaryIterationStatus}
        <div class="pob-home-spotlight__main">
          <h3>{primaryIteration.name}</h3>
          <span class={getStatusBadgeClass(primaryIterationStatus)}>{getStatusLabel(primaryIterationStatus)}</span>
        </div>
        <p class="pob-home-spotlight__meta">
          Iteration #{primaryIteration.iteration}{primaryIteration.round ? ` - Round #${primaryIteration.round}` : ''}
        </p>
        <Link
          to="/iteration/{primaryIteration.iteration}"
          class="pob-link-card pob-link-card--stack-mobile pob-home-spotlight__link"
          onclick={() => onSelectIteration(primaryIteration.iteration)}
        >
          <span class="pob-link-card__chip pob-chip pob-chip--compact">Round</span>
          <span class="pob-link-card__text">
            <span class="pob-link-card__label">Open round workspace</span>
            <span class="pob-link-card__meta">Projects, voting state, badges, and final results</span>
          </span>
        </Link>
      {:else}
        <p class="pob-home-spotlight__meta">
          No iterations are registered yet. The registry owner can add the first iteration below.
        </p>
      {/if}
    </aside>
  </section>

  <section class="pob-home-metrics" aria-label="Proof-of-Builders metrics">
    {#each metrics as metric (metric.label)}
      <div class="pob-home-metric pob-surface--quiet">
        <span>{metric.value}</span>
        <p>{metric.label}</p>
      </div>
    {/each}
  </section>

  <section class="pob-pane pob-surface--quiet pob-home-section" aria-labelledby="pob-how-title">
    <div class="pob-pane__heading">
      <div>
        <p class="pob-eyebrow pob-eyebrow--muted">The loop</p>
        <h3 id="pob-how-title" class="pob-pane__title">How PoB Works</h3>
      </div>
    </div>

    <div class="pob-home-steps">
      {#each howItWorks as step, index (step.title)}
        <article class="pob-home-step">
          <span class="pob-home-step__number">0{index + 1}</span>
          <h4>{step.title}</h4>
          <p>{step.description}</p>
        </article>
      {/each}
    </div>
  </section>

  <section id="about" class="pob-pane pob-surface--quiet pob-home-section pob-home-about" aria-labelledby="pob-about-title">
    <div class="pob-home-about__intro">
      <p class="pob-eyebrow pob-eyebrow--muted">About PoB</p>
      <h3 id="pob-about-title" class="pob-pane__title">A builder-recognition initiative with LATAM execution</h3>
      <p>
        Proof-of-Builders comes from a Ledger Architects initiative by Patrick, known as 1DigitalCrypto, and has grown into a Syscoin program for builders, jurors, community voting, badges, and certificates.
      </p>
      <p>
        The LATAM program is led and executed by Fernando Paredes, DevElCuy, with mentoring and event coordination across universities, online sessions, and builder cohorts. Percy Meneses supports community management and helps as a speaker.
      </p>
      <a
        href="https://syscoin.org/news/eco-update-260505"
        target="_blank"
        rel="noopener noreferrer"
        class="pob-button pob-button--outline pob-button--compact pob-home-about__source"
      >
        Read Syscoin ecosystem update
      </a>
    </div>

    <div class="pob-home-about__people">
      {#each aboutPeople as person (person.name)}
        <article class="pob-home-about-card">
          <p class="pob-eyebrow pob-eyebrow--muted">{person.role}</p>
          <h4>{person.name}</h4>
          <p>{person.description}</p>
          {#if person.href}
            <a href={person.href} target="_blank" rel="noopener noreferrer" class="pob-socials__link">
              Follow
            </a>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <section class="pob-pane pob-surface--quiet pob-home-section" aria-labelledby="pob-recognition-title">
    <div class="pob-pane__heading">
      <div>
        <p class="pob-eyebrow pob-eyebrow--muted">Recognition</p>
        <h3 id="pob-recognition-title" class="pob-pane__title">Your participation record</h3>
      </div>
    </div>

    <div class="pob-home-recognition">
      <Link to="/badges" class="pob-link-card pob-link-card--stack-mobile">
        <span class="pob-link-card__chip pob-chip pob-chip--compact">Badges</span>
        <span class="pob-link-card__text">
          <span class="pob-link-card__label">Participation proofs</span>
          <span class="pob-link-card__meta">View PoB badges earned through rounds and roles</span>
        </span>
      </Link>

      <Link to="/certs" class="pob-link-card pob-link-card--stack-mobile">
        <span class="pob-link-card__chip pob-chip pob-chip--compact">Certs</span>
        <span class="pob-link-card__text">
          <span class="pob-link-card__label">Recognition history</span>
          <span class="pob-link-card__meta">Request, review, or view participation certificates</span>
        </span>
      </Link>

      {#if profilePath}
        <Link to={profilePath} class="pob-link-card pob-link-card--stack-mobile">
          <span class="pob-link-card__chip pob-chip pob-chip--compact">Profile</span>
          <span class="pob-link-card__text">
            <span class="pob-link-card__label">Public contributor profile</span>
            <span class="pob-link-card__meta">See badges and certs connected to your wallet</span>
          </span>
        </Link>
      {:else}
        <div class="pob-home-recognition__note pob-surface--quiet">
          <p class="pob-eyebrow pob-eyebrow--muted">Profile</p>
          <p>Connect a wallet to open your public contribution profile.</p>
        </div>
      {/if}
    </div>
  </section>

  {#if isLoading}
    <section class="pob-pane pob-surface--quiet">
      <div class="flex flex-col items-center justify-center py-12 gap-4">
        <ProgressSpinner size={48} />
        <p class="text-sm text-[var(--pob-text-muted)]">Loading iterations...</p>
      </div>
    </section>
  {:else if error}
    <section class="pob-pane pob-surface--quiet">
      <div class="flex flex-col items-center justify-center py-12 gap-4">
        <p class="text-sm text-[var(--pob-warning-text)]">{error}</p>
        <button
          type="button"
          class="pob-button pob-button--compact"
          onclick={() => refreshIterations()}
        >
          Retry
        </button>
      </div>
    </section>
  {:else}
    <div id="iterations-list">
      <IterationSection
        title="Iterations and Rounds"
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
    </div>
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

<style>
  .pob-home-hero {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: 1fr;
    overflow: hidden;
  }

  .pob-home-hero__copy {
    display: grid;
    gap: 1rem;
    position: relative;
    z-index: 1;
  }

  .pob-home-hero__title {
    max-width: 13ch;
    margin: 0;
    color: var(--pob-text);
    font-size: clamp(2.4rem, 9vw, 5rem);
    font-weight: 900;
    letter-spacing: -0.07em;
    line-height: 0.92;
  }

  .pob-home-hero__lede {
    max-width: 42rem;
    margin: 0;
    color: var(--pob-text-muted);
    font-size: clamp(1rem, 2vw, 1.18rem);
    line-height: 1.65;
  }

  .pob-home-hero__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.35rem;
  }

  .pob-home-spotlight {
    display: grid;
    gap: 1rem;
    align-content: start;
    border: 1px solid var(--pob-border-accent-soft);
    border-radius: var(--pob-radius-mobile);
    background: var(--pob-surface-quiet);
    box-shadow: var(--pob-shadow-inset-subtle);
    padding: 1.25rem;
  }

  .pob-home-spotlight__main {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .pob-home-spotlight__main h3 {
    margin: 0;
    color: var(--pob-text);
    font-size: 1.15rem;
    font-weight: 800;
    line-height: 1.25;
  }

  .pob-home-spotlight__meta {
    margin: 0;
    color: var(--pob-text-muted);
    font-size: 0.9rem;
    line-height: 1.55;
  }

  .pob-home-spotlight__link {
    margin-top: 0.25rem;
  }

  .pob-home-metrics {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pob-home-metric {
    border: 1px solid var(--pob-border-subtle);
    border-radius: var(--pob-radius-mobile);
    padding: 1rem;
    box-shadow: var(--pob-shadow-inset-subtle);
  }

  .pob-home-metric span {
    display: block;
    color: var(--pob-text);
    font-size: clamp(1.8rem, 6vw, 2.8rem);
    font-weight: 900;
    line-height: 1;
  }

  .pob-home-metric p {
    margin: 0.4rem 0 0;
    color: var(--pob-text-muted);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .pob-home-steps,
  .pob-home-recognition,
  .pob-home-about__people {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
  }

  .pob-home-step,
  .pob-home-about-card,
  .pob-home-recognition__note {
    border: 1px solid var(--pob-border-subtle);
    border-radius: var(--pob-radius-mobile);
    background: var(--pob-surface-quiet);
    box-shadow: var(--pob-shadow-inset-subtle);
    padding: 1rem;
  }

  .pob-home-about {
    display: grid;
    gap: 1.25rem;
  }

  .pob-home-about__intro {
    display: grid;
    gap: 0.85rem;
  }

  .pob-home-about__intro > p:not(.pob-eyebrow) {
    max-width: 68rem;
    margin: 0;
    color: var(--pob-text-muted);
    font-size: 0.95rem;
    line-height: 1.7;
  }

  .pob-home-about__source {
    justify-self: start;
    margin-top: 0.25rem;
  }

  .pob-home-step__number {
    color: var(--pob-primary);
    font-family: 'Space Mono', monospace;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.14em;
  }

  .pob-home-step h4,
  .pob-home-about-card h4 {
    margin: 0.5rem 0 0.35rem;
    color: var(--pob-text);
    font-size: 1rem;
    font-weight: 800;
  }

  .pob-home-step p,
  .pob-home-about-card p:not(.pob-eyebrow),
  .pob-home-recognition__note p:last-child {
    margin: 0;
    color: var(--pob-text-muted);
    font-size: 0.9rem;
    line-height: 1.6;
  }

  .pob-home-about-card .pob-socials__link {
    margin-top: 0.9rem;
  }

  @media (min-width: 768px) {
    .pob-home-hero {
      grid-template-columns: minmax(0, 1.35fr) minmax(18rem, 0.65fr);
      align-items: end;
    }

    .pob-home-metrics {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .pob-home-steps,
    .pob-home-about__people,
    .pob-home-recognition {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 1280px) {
    .pob-home-steps {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .pob-home-recognition {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .pob-home-about__people {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
