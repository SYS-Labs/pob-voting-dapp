<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import type { JsonRpcSigner } from 'ethers';
  import type { Iteration } from '~/interfaces';
  import { createIterationMetadataManager, type IterationMetadataForm } from '~/stores/iterationMetadataManager';
  import { isUserRejectedError, isValidUrl } from '~/utils';

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

  let formData = $state<IterationMetadataForm>({
    name: '',
    description: '',
    link: '',
  });
  let error = $state<string | null>(null);
  let initialized = $state(false);

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

  const metadata = $derived(metadataManager ? $metadataManager.metadata : null);
  const isSubmitting = $derived(metadataManager ? $metadataManager.isSubmitting : false);

  // Initialize form data when metadata loads
  // metadata comes from the API (async) and has the real stored name.
  // currentIteration.name is a generated fallback ("Iteration #1") — only use
  // it as a placeholder until metadata arrives, never lock initialization on it.
  $effect(() => {
    if (initialized) return;
    if (metadata) {
      formData = {
        name: metadata.name || '',
        description: metadata.description || '',
        link: metadata.link || '',
      };
      initialized = true;
    } else if (currentIteration) {
      formData = {
        name: currentIteration.name || `Iteration #${currentIteration.iteration}`,
        description: '',
        link: currentIteration.link || '',
      };
      // Don't set initialized — let metadata overwrite when it arrives
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
      navigate(`/iteration/${iterationNumber}/details`);
    } catch (err) {
      if (isUserRejectedError(err)) {
        return;
      }
      console.error('Failed to submit metadata:', err);
      error = err instanceof Error ? err.message : 'Failed to submit metadata';
    }
  }
</script>

{#if !walletAddress}
  <div class="pob-page">
    <div class="pob-container pob-container--narrow">
      <div class="pob-pane">
        <p class="text-sm text-[var(--pob-text-muted)]">
          Please connect your wallet to edit iteration metadata.
        </p>
      </div>
    </div>
  </div>
{:else if !canEdit.allowed}
  <div class="pob-page">
    <div class="pob-container pob-container--narrow">
      <div style="margin-bottom: 1rem;">
        <Link
          to={`/iteration/${iterationNumber}/details`}
          class="text-sm text-[var(--pob-primary)] hover:underline"
        >
          ← Back to Iteration Details
        </Link>
      </div>
      <div class="pob-pane">
        <p class="text-sm text-[var(--pob-text-muted)]">
          {canEdit.reason}
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
          to={`/iteration/${iterationNumber}/details`}
          class="text-sm text-[var(--pob-primary)] hover:underline"
        >
          ← Back to Iteration Details
        </Link>
      </div>

      <div class="pob-pane">
        <div class="pob-pane__heading">
          <h2 class="pob-pane__title">Edit Iteration</h2>
        </div>

        <form onsubmit={handleSubmit} class="pob-form">
          <div class="pob-form__section">
            <div class="pob-form__field">
              <label for="metadata-name" class="pob-form__label">
                Iteration Name <span class="pob-form__required">*</span>
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
              <p class="pob-form__hint">
                {formData.name.length}/200 characters
              </p>
            </div>
          </div>

          <div class="pob-form__section">
            <div class="pob-form__field">
              <label for="metadata-description" class="pob-form__label">
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
              <p class="pob-form__hint">
                {formData.description.length}/2000 characters - Markdown supported
              </p>
            </div>
          </div>

          <div class="pob-form__section">
            <div class="pob-form__field">
              <label for="metadata-link" class="pob-form__label">
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
                <p class="pob-form__error">Invalid URL format</p>
              {/if}
            </div>
          </div>

          <!-- Error display -->
          {#if error}
            <div class="pob-warning">
              <p class="text-xs">{error}</p>
            </div>
          {/if}

          <!-- Form Actions -->
          <div class="pob-form__actions">
            <Link
              to={`/iteration/${iterationNumber}/details`}
              class="pob-button pob-button--outline"
              style="text-decoration: none;"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting || !isFormValid}
              class="pob-button"
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
{/if}
