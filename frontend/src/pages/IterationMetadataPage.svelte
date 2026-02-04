<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import type { JsonRpcSigner } from 'ethers';
  import type { Iteration } from '~/interfaces';
  import { createIterationMetadataManager, type IterationMetadataForm } from '~/stores/iterationMetadataManager';
  import {
    getExplorerTxLink,
    getMetadataCidUrl,
    isUserRejectedError,
    isValidUrl,
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

  let editMode = $state(false);
  let formData = $state<IterationMetadataForm>({
    name: '',
    description: '',
    link: '',
  });
  let error = $state<string | null>(null);

  // Iteration metadata manager
  let metadataManager = $state<ReturnType<typeof createIterationMetadataManager> | null>(null);

  $effect(() => {
    metadataManager?.destroy?.();
    metadataManager = createIterationMetadataManager(
      currentIteration?.iteration || null,
      currentIteration?.round || null,
      chainId,
      currentIteration?.jurySC || null,
      signer,
      votingActive
    );
    return () => metadataManager?.destroy?.();
  });

  const currentCID = $derived(metadataManager ? $metadataManager.currentCID : null);
  const pendingCID = $derived(metadataManager ? $metadataManager.pendingCID : null);
  const pendingTxHash = $derived(metadataManager ? $metadataManager.pendingTxHash : null);
  const pendingConfirmations = $derived(metadataManager ? $metadataManager.pendingConfirmations : 0);
  const metadata = $derived(metadataManager ? $metadataManager.metadata : null);
  const isSubmitting = $derived(metadataManager ? $metadataManager.isSubmitting : false);

  // Redirect if no iteration found
  $effect(() => {
    if (!currentIteration) {
      navigate('/');
    }
  });

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

  // Form validation
  const isFormValid = $derived.by(() => {
    if (!formData.name.trim()) return false;
    if (formData.name.length > 200) return false;
    if (formData.link && !isValidUrl(formData.link)) return false;
    return true;
  });

  // Handle form submission
  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = null;

    try {
      await metadataManager?.submitMetadata(formData);
      editMode = false;
      formData = { name: '', description: '', link: '' };
    } catch (err) {
      if (isUserRejectedError(err)) {
        return;
      }
      console.error('Failed to submit metadata:', err);
      error = err instanceof Error ? err.message : 'Failed to submit metadata';
    }
  }

  // Handle entering edit mode - pre-fill with current metadata
  function handleEnterEditMode() {
    if (metadata) {
      formData = {
        name: metadata.name || '',
        description: metadata.description || '',
        link: metadata.link || '',
      };
    } else if (currentIteration) {
      formData = {
        name: currentIteration.name || `Iteration #${currentIteration.iteration}`,
        description: '',
        link: currentIteration.link || '',
      };
    }
    editMode = true;
  }

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
{:else if !currentIteration}
  <div class="pob-page">
    <div class="pob-container">
      <div class="pob-pane">
        <p class="text-sm text-[var(--pob-text-muted)]">
          Loading iteration data...
        </p>
      </div>
    </div>
  </div>
{:else}
  <div class="pob-page">
    <div class="pob-container" style="max-width: 800px; margin: 0 auto;">
      <!-- Back link -->
      <div style="margin-bottom: 1rem;">
        <Link
          to={`/iteration/${iterationNumber}`}
          class="text-sm text-[var(--pob-primary)] hover:underline"
        >
          ← Back to Iteration {iterationNumber}
        </Link>
      </div>

      <!-- Page header -->
      <div class="pob-pane">
        <div class="pob-pane__heading" style="margin-bottom: 1rem;">
          <h2 class="pob-pane__title">Manage iteration</h2>
          {#if !editMode}
            <button
              type="button"
              onclick={() => {
                if (!canEdit.allowed || isSubmitting) return;
                handleEnterEditMode();
              }}
              disabled={!canEdit.allowed || isSubmitting}
              class="pob-button pob-button--compact"
              style="opacity: {!canEdit.allowed || isSubmitting ? 0.6 : 1}; cursor: {!canEdit.allowed || isSubmitting ? 'not-allowed' : 'pointer'};"
              title={!canEdit.allowed && canEdit.reason ? canEdit.reason : undefined}
              aria-disabled={!canEdit.allowed || isSubmitting}
            >
              Edit
            </button>
          {/if}
        </div>

        <!-- Iteration preview -->
        {#if !editMode}
          <div class="pob-fieldset space-y-3">
            <div class="space-y-2">
              <p class="text-lg font-semibold text-white">
                {iterationName}
                {#if currentIteration.round}
                  - Round #{currentIteration.round}
                {/if}
              </p>
              {#if iterationDescription}
                <div style="margin-top: 1rem;">
                  <MarkdownRenderer content={iterationDescription} />
                </div>
              {/if}
              {#if iterationLink || showCurrentLinks}
                <div class="flex flex-wrap items-center gap-2" style="margin-top: 1rem;">
                  {#if iterationLink}
                    <a
                      href={iterationLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="pob-button pob-button--compact"
                    >
                      Program brief
                    </a>
                  {/if}
                  {#if showCurrentLinks}
                    <div class="flex items-center text-xs ml-auto" style="gap: 0.75rem;">
                      {#if currentCID}
                        <a
                          href={getMetadataCidUrl(currentCID)}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-[var(--pob-primary)]"
                          style="text-decoration: none;"
                          title={`View via API: ${currentCID}`}
                        >
                          📦 IPFS
                        </a>
                      {/if}
                      {#if currentTxHash && chainId}
                        <a
                          href={getExplorerTxLink(chainId, currentTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-[var(--pob-primary)]"
                          style="text-decoration: none;"
                          title={`View transaction: ${currentTxHash}`}
                        >
                          🔗 TX
                        </a>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Metadata status -->
            {#if pendingCID || !canEdit.allowed}
              <div
                style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);"
              >
                <!-- Pending CID (if exists) -->
                {#if pendingCID}
                  <div class="flex items-center justify-between" style="margin-bottom: 0.5rem;">
                    <p class="text-sm font-semibold text-[var(--pob-primary)]">
                      Update status
                    </p>
                    <div class="flex items-center text-xs" style="gap: 0.75rem;">
                      <a
                        href={getMetadataCidUrl(pendingCID)}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[var(--pob-primary)]"
                        style="text-decoration: none;"
                        title={`View via API: ${pendingCID}`}
                      >
                        📦 IPFS
                      </a>
                      {#if pendingTxHash && chainId}
                        <a
                          href={getExplorerTxLink(chainId, pendingTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-[var(--pob-primary)]"
                          style="text-decoration: none;"
                          title={`View transaction: ${pendingTxHash}`}
                        >
                          🔗 TX
                        </a>
                      {/if}
                      <span class="pob-pill flex items-center gap-1">
                        <ProgressSpinner size={16} progress={(pendingConfirmations / 10) * 100} />
                        {pendingConfirmations}/10
                      </span>
                    </div>
                  </div>
                {/if}

                <!-- Edit disabled reason -->
                {#if !canEdit.allowed && canEdit.reason}
                  <p class="text-xs text-[var(--pob-text-muted)] italic" style="margin-top: 0.75rem;">
                    {canEdit.reason}
                  </p>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <!-- EDIT MODE -->
          <form onsubmit={handleSubmit} class="space-y-3">
            <div class="space-y-1">
              <label for="metadata-name" class="text-xs font-medium text-[var(--pob-text)]">
                Iteration Name *
              </label>
              <input
                id="metadata-name"
                type="text"
                bind:value={formData.name}
                class="pob-input"
                placeholder="Enter iteration name"
                maxlength={200}
                required
              />
              <p class="text-xs text-[var(--pob-text-muted)]">
                {formData.name.length}/200 characters
              </p>
            </div>

            <div class="space-y-1">
              <label for="metadata-description" class="text-xs font-medium text-[var(--pob-text)]">
                Description
              </label>
              <textarea
                id="metadata-description"
                bind:value={formData.description}
                class="pob-input"
                placeholder="Enter round description (markdown supported)"
                rows={6}
                maxlength={2000}
              ></textarea>
              <p class="text-xs text-[var(--pob-text-muted)]">
                {formData.description.length}/2000 characters - Markdown supported
              </p>
            </div>

            <div class="space-y-1">
              <label for="metadata-link" class="text-xs font-medium text-[var(--pob-text)]">
                Link
              </label>
              <input
                id="metadata-link"
                type="text"
                bind:value={formData.link}
                class="pob-input"
                placeholder="https://..."
              />
              {#if formData.link && !isValidUrl(formData.link)}
                <p class="text-xs" style="color: rgb(239, 68, 68);">
                  Invalid URL format
                </p>
              {/if}
            </div>

            <!-- Error display -->
            {#if error}
              <div class="pob-warning">
                <p class="text-xs">{error}</p>
              </div>
            {/if}

            <div class="flex gap-2" style="margin-top: 1.5rem;">
              <button
                type="button"
                onclick={() => {
                  editMode = false;
                  error = null;
                }}
                disabled={isSubmitting}
                class="pob-button pob-button--outline flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !isFormValid}
                class="pob-button flex-1"
              >
                {isSubmitting ? 'Submitting...' : 'Save'}
              </button>
            </div>
          </form>
        {/if}
      </div>
    </div>
  </div>
{/if}
