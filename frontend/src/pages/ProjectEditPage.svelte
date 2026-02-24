<script lang="ts">
  import { Link, navigate } from 'svelte-routing';
  import type { JsonRpcSigner } from 'ethers';
  import type { Project } from '~/interfaces';
  import { createProjectMetadataManager, type ProjectMetadataForm } from '~/stores/projectMetadataManager';
  import { createRegistryStatusStore } from '~/stores/registryStatus';
  import { isValidYouTubeUrl, isValidUrl, isUserRejectedError } from '~/utils';

  interface Props {
    iterationNumber: string;
    projectAddress: string;
    projects: Project[];
    walletAddress: string | null;
    chainId: number | null;
    iterationChainId: number | null;
    contractAddress: string | null;
    signer: JsonRpcSigner | null;
    projectsLocked: boolean;
  }

  let {
    iterationNumber,
    projectAddress,
    projects,
    walletAddress,
    chainId,
    iterationChainId,
    contractAddress,
    signer,
    projectsLocked,
  }: Props = $props();

  let formData = $state<ProjectMetadataForm>({
    name: '',
    app_url: '',
    yt_vid: '',
    proposal: '',
    socials: { x: '', instagram: '', tiktok: '', linkedin: '' },
  });
  let error = $state<string | null>(null);
  let initialized = $state(false);

  // Find the project
  const project = $derived(
    projectAddress
      ? projects.find(p => p.address.toLowerCase() === projectAddress.toLowerCase()) || null
      : null
  );

  // Project metadata manager
  let metadataManagerStore = $state<ReturnType<typeof createProjectMetadataManager> | null>(null);

  $effect(() => {
    const manager = createProjectMetadataManager(
      project?.address || null,
      chainId,
      contractAddress,
      signer,
    );
    metadataManagerStore = manager;
    return () => manager.destroy();
  });

  const metadata = $derived(metadataManagerStore ? $metadataManagerStore.metadata : null);
  const isSubmitting = $derived(metadataManagerStore ? $metadataManagerStore.isSubmitting : false);

  // Registry status
  let registryStatusManager = $state<ReturnType<typeof createRegistryStatusStore> | null>(null);

  $effect(() => {
    const manager = createRegistryStatusStore(iterationChainId);
    registryStatusManager = manager;
    return () => manager.destroy();
  });

  const registryAvailable = $derived(registryStatusManager?.registryAvailable ?? false);

  let initializationComplete = $state<boolean | null>(null);
  let registryOwner = $state<string | null>(null);

  $effect(() => {
    const manager = registryStatusManager;
    if (!manager) {
      initializationComplete = null;
      registryOwner = null;
      return;
    }

    const unsubInit = manager.initializationComplete.subscribe((v: boolean | null) => {
      initializationComplete = v;
    });
    const unsubOwner = manager.registryOwner.subscribe((v: string | null) => {
      registryOwner = v;
    });

    return () => {
      unsubInit();
      unsubOwner();
    };
  });

  // Initialize form data when metadata loads
  // metadata (from registry API) has the real stored values.
  // project?.metadata (from contract state) or project.id fallback are placeholders —
  // don't lock initialization on them so metadata can overwrite when it arrives.
  $effect(() => {
    if (initialized) return;
    const source = metadata || project?.metadata;
    if (metadata) {
      formData = {
        name: metadata.name || '',
        app_url: metadata.app_url || '',
        yt_vid: metadata.yt_vid || '',
        proposal: metadata.proposal || '',
        socials: {
          x: metadata.socials?.x || '',
          instagram: metadata.socials?.instagram || '',
          tiktok: metadata.socials?.tiktok || '',
          linkedin: metadata.socials?.linkedin || '',
        },
      };
      initialized = true;
    } else if (source) {
      formData = {
        name: source.name || '',
        app_url: source.app_url || '',
        yt_vid: source.yt_vid || '',
        proposal: source.proposal || '',
        socials: {
          x: source.socials?.x || '',
          instagram: source.socials?.instagram || '',
          tiktok: source.socials?.tiktok || '',
          linkedin: source.socials?.linkedin || '',
        },
      };
      // Don't set initialized — let registry metadata overwrite when it arrives
    } else if (project) {
      formData = {
        name: `Project #${project.id}`,
        app_url: '',
        yt_vid: '',
        proposal: '',
        socials: { x: '', instagram: '', tiktok: '', linkedin: '' },
      };
      // Don't set initialized — let metadata overwrite when it arrives
    }
  });

  // Determine if editing is allowed (matches contract authorization logic)
  const canEdit = $derived.by(() => {
    if (!signer) {
      return { allowed: false, reason: 'Connect wallet to update metadata' };
    }
    if (!registryAvailable) {
      return { allowed: false, reason: 'Metadata registry not available on this network' };
    }
    if (initializationComplete === null) {
      return { allowed: false, reason: 'Loading registry status...' };
    }

    const walletLower = walletAddress?.toLowerCase();
    const isRegistryOwner = Boolean(registryOwner && walletLower === registryOwner?.toLowerCase());
    const isProjectWallet = Boolean(projectAddress && walletLower === projectAddress.toLowerCase());

    if (!initializationComplete) {
      // Before initialization complete: only owner can edit
      if (isRegistryOwner) return { allowed: true };
      return { allowed: false, reason: 'Only the registry owner can set metadata during initialization' };
    }

    // After initialization complete: only project wallet, and only when not locked
    if (isProjectWallet) {
      if (projectsLocked) {
        return { allowed: false, reason: 'Metadata editing is closed (voting has started)' };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: 'Only the project wallet can update its metadata' };
  });

  // Form validation
  const isFormValid = $derived.by(() => {
    if (!formData.name.trim()) return false;
    if (formData.name.length > 200) return false;
    if (formData.app_url && !isValidUrl(formData.app_url)) return false;
    if (formData.yt_vid && !isValidYouTubeUrl(formData.yt_vid)) return false;
    if (formData.proposal && !isValidUrl(formData.proposal)) return false;
    if (formData.socials.x && !isValidUrl(formData.socials.x)) return false;
    if (formData.socials.instagram && !isValidUrl(formData.socials.instagram)) return false;
    if (formData.socials.tiktok && !isValidUrl(formData.socials.tiktok)) return false;
    if (formData.socials.linkedin && !isValidUrl(formData.socials.linkedin)) return false;
    return true;
  });

  // Handle form submission
  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = null;

    try {
      await metadataManagerStore?.submitMetadata(formData);
      navigate(`/iteration/${iterationNumber}/project/${projectAddress}`);
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
          Please connect your wallet to edit project metadata.
        </p>
      </div>
    </div>
  </div>
{:else if !project}
  <div class="pob-page">
    <div class="pob-container pob-container--narrow">
      <div class="pob-pane">
        <p class="text-sm text-[var(--pob-text-muted)]">
          Project not found.
        </p>
      </div>
    </div>
  </div>
{:else if !canEdit.allowed}
  <div class="pob-page">
    <div class="pob-container pob-container--narrow">
      <div style="margin-bottom: 1rem;">
        <Link
          to={`/iteration/${iterationNumber}/project/${projectAddress}`}
          class="text-sm text-[var(--pob-primary)] hover:underline"
        >
          ← Back to Project
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
          to={`/iteration/${iterationNumber}/project/${projectAddress}`}
          class="text-sm text-[var(--pob-primary)] hover:underline"
        >
          ← Back to Project
        </Link>
      </div>

      <!-- Page header -->
      <div class="pob-pane">
        <div class="pob-pane__heading">
          <h2 class="pob-pane__title">Edit Project</h2>
        </div>

        <form onsubmit={handleSubmit} class="pob-form">
          <!-- Basic Info Section -->
          <div class="pob-form__section">
            <div class="pob-form__field">
              <label for="project-name" class="pob-form__label">
                Project Name <span class="pob-form__required">*</span>
              </label>
              <input
                id="project-name"
                type="text"
                bind:value={formData.name}
                class="pob-input"
                placeholder="Enter project name"
                maxlength={200}
                required
              />
              <p class="pob-form__hint">
                {formData.name.length}/200 characters
              </p>
            </div>

            <div class="pob-form__field pob-form__field--featured">
              <label for="project-app-url" class="pob-form__label">App URL</label>
              <input
                id="project-app-url"
                type="text"
                bind:value={formData.app_url}
                class="pob-input pob-input--featured"
                placeholder="https://yourapp.com"
              />
              {#if formData.app_url && !isValidUrl(formData.app_url)}
                <p class="pob-form__error">Invalid URL format</p>
              {/if}
            </div>
          </div>

          <!-- Proposal Section -->
          <div class="pob-form__section">
            <h3 class="pob-form__section-title">Proposal</h3>

            <div class="pob-form__field">
              <label for="project-youtube" class="pob-form__label">YouTube Video URL</label>
              <input
                id="project-youtube"
                type="text"
                bind:value={formData.yt_vid}
                class="pob-input"
                placeholder="https://youtu.be/... or https://youtube.com/watch?v=..."
              />
              {#if formData.yt_vid && !isValidYouTubeUrl(formData.yt_vid)}
                <p class="pob-form__error">Invalid YouTube URL format</p>
              {/if}
            </div>

            <div class="pob-form__field">
              <label for="project-proposal" class="pob-form__label">Proposal URL</label>
              <input
                id="project-proposal"
                type="text"
                bind:value={formData.proposal}
                class="pob-input"
                placeholder="https://..."
              />
              {#if formData.proposal && !isValidUrl(formData.proposal)}
                <p class="pob-form__error">Invalid URL format</p>
              {/if}
            </div>
          </div>

          <!-- Socials Section -->
          <div class="pob-form__section">
            <h3 class="pob-form__section-title">Socials</h3>

            <!-- X (Twitter) - Featured/Primary -->
            <div class="pob-form__field pob-form__field--featured">
              <label for="project-x" class="pob-form__label">X (ex Twitter)</label>
              <input
                id="project-x"
                type="text"
                bind:value={formData.socials.x}
                class="pob-input pob-input--featured"
                placeholder="https://x.com/yourproject"
              />
              {#if formData.socials.x && !isValidUrl(formData.socials.x)}
                <p class="pob-form__error">Invalid URL format</p>
              {/if}
            </div>

            <!-- Other Socials - Grid Layout -->
            <div class="pob-form__socials-grid">
              <div class="pob-form__field">
                <label for="project-instagram" class="pob-form__label">Instagram</label>
                <input
                  id="project-instagram"
                  type="text"
                  bind:value={formData.socials.instagram}
                  class="pob-input"
                  placeholder="https://instagram.com/..."
                />
                {#if formData.socials.instagram && !isValidUrl(formData.socials.instagram)}
                  <p class="pob-form__error">Invalid URL format</p>
                {/if}
              </div>

              <div class="pob-form__field">
                <label for="project-tiktok" class="pob-form__label">TikTok</label>
                <input
                  id="project-tiktok"
                  type="text"
                  bind:value={formData.socials.tiktok}
                  class="pob-input"
                  placeholder="https://tiktok.com/@..."
                />
                {#if formData.socials.tiktok && !isValidUrl(formData.socials.tiktok)}
                  <p class="pob-form__error">Invalid URL format</p>
                {/if}
              </div>

              <div class="pob-form__field">
                <label for="project-linkedin" class="pob-form__label">LinkedIn</label>
                <input
                  id="project-linkedin"
                  type="text"
                  bind:value={formData.socials.linkedin}
                  class="pob-input"
                  placeholder="https://linkedin.com/company/..."
                />
                {#if formData.socials.linkedin && !isValidUrl(formData.socials.linkedin)}
                  <p class="pob-form__error">Invalid URL format</p>
                {/if}
              </div>
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
              to={`/iteration/${iterationNumber}/project/${projectAddress}`}
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
