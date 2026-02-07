<script lang="ts">
  import { Link } from 'svelte-routing';
  import type { JsonRpcSigner } from 'ethers';
  import type { Iteration } from '~/interfaces';
  import { createIterationMetadataManager } from '~/stores/iterationMetadataManager';
  import {
    getExplorerTxLink,
    getMetadataCidUrl,
  } from '~/utils';
  import MarkdownRenderer from '~/components/MarkdownRenderer.svelte';
  import ProgressSpinner from '~/components/ProgressSpinner.svelte';

  interface Props {
    iterationNumber: string;
    currentIteration: Iteration | null;
    walletAddress: string | null;
    chainId: number | null;
    signer: JsonRpcSigner | null;
    votingActive: boolean;
    isOwner: boolean;
  }

  let {
    iterationNumber,
    currentIteration,
    walletAddress,
    chainId,
    signer,
    votingActive,
    isOwner,
  }: Props = $props();

  // Iteration metadata manager
  let metadataManager = $state<ReturnType<typeof createIterationMetadataManager> | null>(null);

  $effect(() => {
    const manager = createIterationMetadataManager(
      currentIteration?.iteration || null,
      currentIteration?.round || null,
      chainId,
      currentIteration?.jurySC || null,
      signer,
      votingActive
    );
    metadataManager = manager;
    return () => manager.destroy();
  });

  const currentCID = $derived(metadataManager ? $metadataManager.currentCID : null);
  const pendingCID = $derived(metadataManager ? $metadataManager.pendingCID : null);
  const pendingTxHash = $derived(metadataManager ? $metadataManager.pendingTxHash : null);
  const pendingConfirmations = $derived(metadataManager ? $metadataManager.pendingConfirmations : 0);
  const metadata = $derived(metadataManager ? $metadataManager.metadata : null);

  // Determine if editing is allowed
  const canEdit = $derived.by(() => {
    if (votingActive) {
      return { allowed: false, reason: 'Metadata locked during voting' };
    }
    if (!signer) {
      return { allowed: false, reason: 'Connect wallet to update metadata' };
    }
    if (pendingTxHash && pendingConfirmations < 10) {
      return { allowed: false };
    }
    if (!isOwner) {
      return { allowed: false, reason: 'Only contract owner can update iteration metadata' };
    }
    return { allowed: true };
  });

  const iterationName = $derived(metadata?.name || currentIteration?.name || `Iteration #${currentIteration?.iteration}`);
  const iterationDescription = $derived(metadata?.description || '');
  const iterationLink = $derived(metadata?.link || currentIteration?.link);
  const currentTxHash = $derived(metadata?.txHash || null);
  const showCurrentLinks = $derived(Boolean(currentCID || currentTxHash));
</script>

{#if !walletAddress}
  <div class="pob-page">
    <div class="pob-container">
      <div class="pob-pane">
        <p class="text-sm text-[var(--pob-text-muted)]">
          Please connect your wallet to manage iteration metadata.
        </p>
      </div>
    </div>
  </div>
{:else}
  <div class="pob-page">
    <div class="pob-container pob-container--narrow">
      <!-- Back link -->
      <div style="margin-bottom: 1rem;">
        <Link
          to={`/iteration/${iterationNumber}`}
          class="text-sm text-[var(--pob-primary)] hover:underline"
        >
          ← Back to Iteration {iterationNumber}
        </Link>
      </div>

      <div class="pob-pane">
        <div class="pob-pane__heading">
          <div>
            <h2 class="pob-pane__title">{iterationName}</h2>
            <p class="mt-1 text-sm text-[var(--pob-text-muted)]">
              Iteration #{currentIteration.iteration}{currentIteration.round ? ` - Round #${currentIteration.round}` : ''}
            </p>
          </div>
          {#if canEdit.allowed}
            <Link
              to={`/iteration/${iterationNumber}/details/edit`}
              class="pob-button pob-button--outline pob-button--compact"
              style="text-decoration: none;"
            >
              Edit
            </Link>
          {/if}
        </div>

        {#if iterationDescription}
          <div style="margin-top: 1rem;">
            <MarkdownRenderer content={iterationDescription} />
          </div>
        {/if}
        {#if iterationLink}
          <div style="margin-top: 1rem;">
            <a
              href={iterationLink}
              target="_blank"
              rel="noopener noreferrer"
              class="pob-button pob-button--outline pob-button--compact"
            >
              Program brief
            </a>
          </div>
        {/if}

        {#if showCurrentLinks}
          <div class="pob-socials" style="margin-top: 1.5rem;">
            <span style="flex: 1;"></span>
            {#if currentCID}
              <a
                href={getMetadataCidUrl(currentCID)}
                target="_blank"
                rel="noopener noreferrer"
                class="pob-socials__link"
                title={`IPFS CID: ${currentCID}`}
              >
                📦 IPFS
              </a>
            {/if}
            {#if currentTxHash && chainId}
              <a
                href={getExplorerTxLink(chainId, currentTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                class="pob-socials__link"
                title={`Transaction: ${currentTxHash}`}
              >
                ⛓️ TX
              </a>
            {/if}
          </div>
        {/if}

        <!-- Metadata status -->
        {#if pendingCID}
          {#if !showCurrentLinks}<div class="pob-pane__divider"></div>{/if}
          <div class="flex items-center gap-2 justify-end" style={showCurrentLinks ? 'margin-top: 0.75rem;' : ''}>
            <p class="pob-pane__meta">Updating...</p>
            <span class="pob-pill flex items-center gap-1">
              <ProgressSpinner size={16} progress={Math.min((pendingConfirmations / 10) * 100, 100)} />
              {pendingConfirmations}/10
            </span>
          </div>
        {/if}

        {#if !canEdit.allowed && canEdit.reason}
          <p class="text-xs text-[var(--pob-text-muted)] italic" style="margin-top: 0.75rem;">
            {canEdit.reason}
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}
