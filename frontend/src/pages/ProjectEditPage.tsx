import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { JsonRpcSigner } from 'ethers';
import type { Project } from '~/interfaces';
import { useProjectMetadataManager, type ProjectMetadataForm } from '~/hooks/useProjectMetadataManager';
import { useRegistryStatus } from '~/hooks/useRegistryStatus';
import { isValidYouTubeUrl, isValidUrl, isUserRejectedError, formatCID, getExplorerTxLink, getMetadataCidUrl } from '~/utils';
import { ProgressSpinner } from '~/components/ProgressSpinner';

interface ProjectEditPageProps {
  projects: Project[];
  walletAddress: string | null;
  chainId: number | null;
  iterationChainId: number | null;
  contractAddress: string | null;
  signer: JsonRpcSigner | null;
  projectsLocked: boolean;
}

const ProjectEditPage = ({
  projects,
  walletAddress,
  chainId,
  iterationChainId,
  contractAddress,
  signer,
  projectsLocked,
}: ProjectEditPageProps) => {
  const { iterationNumber, projectAddress } = useParams<{ iterationNumber: string; projectAddress: string }>();
  const [formData, setFormData] = useState<ProjectMetadataForm>({
    name: '',
    yt_vid: '',
    proposal: '',
    socials: { x: '', instagram: '', tiktok: '', linkedin: '' },
  });
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Find the project
  const project = useMemo(() => {
    if (!projectAddress) return null;
    return projects.find(p => p.address.toLowerCase() === projectAddress.toLowerCase()) || null;
  }, [projects, projectAddress]);

  const {
    metadata,
    isSubmitting,
    submitMetadata,
    currentCID,
    currentConfirmations,
    pendingCID,
    pendingTxHash,
    pendingConfirmations,
  } = useProjectMetadataManager(
    project?.address || null,
    chainId,
    contractAddress,
    signer,
    projectsLocked
  );

  // Use iteration's chainId for registry status (not wallet's chainId)
  const { registryAvailable, initializationComplete, registryOwner } = useRegistryStatus(iterationChainId);

  // Initialize form data when metadata loads
  useMemo(() => {
    if (!initialized && (metadata || project)) {
      const source = metadata || project?.metadata;
      if (source) {
        setFormData({
          name: source.name || '',
          yt_vid: source.yt_vid || '',
          proposal: source.proposal || '',
          socials: {
            x: source.socials?.x || '',
            instagram: source.socials?.instagram || '',
            tiktok: source.socials?.tiktok || '',
            linkedin: source.socials?.linkedin || '',
          },
        });
        setInitialized(true);
      } else if (project) {
        setFormData({
          name: `Project #${project.id}`,
          yt_vid: '',
          proposal: '',
          socials: { x: '', instagram: '', tiktok: '', linkedin: '' },
        });
        setInitialized(true);
      }
    }
  }, [metadata, project, initialized]);

  // Determine if editing is allowed
  const canEdit = useMemo(() => {
    if (!signer) {
      return { allowed: false, reason: 'Connect wallet to update metadata' };
    }
    if (!registryAvailable) {
      return { allowed: false, reason: 'Metadata registry not available on this network' };
    }
    if (initializationComplete === null) {
      return { allowed: false, reason: 'Loading metadata permissions' };
    }

    const walletLower = walletAddress?.toLowerCase();
    const isRegistryOwner = Boolean(registryOwner && walletLower === registryOwner?.toLowerCase());

    // Owner bypass: when VITE_OWNER_METADATA_BYPASS is enabled, registry owner can edit any project
    const ownerBypassEnabled = import.meta.env.VITE_OWNER_METADATA_BYPASS === 'true';
    if (ownerBypassEnabled && isRegistryOwner) {
      return { allowed: true };
    }

    if (!initializationComplete) {
      if (!registryOwner) {
        return { allowed: false, reason: 'Loading registry owner' };
      }
      if (!isRegistryOwner) {
        return { allowed: false, reason: 'Only registry owner can update during initialization' };
      }
      return { allowed: true };
    }

    if (projectsLocked) {
      return { allowed: false, reason: 'Metadata editing closed (voting started)' };
    }
    if (!projectAddress || !walletLower || walletLower !== projectAddress.toLowerCase()) {
      return { allowed: false, reason: 'Only project owner can update' };
    }
    return { allowed: true };
  }, [signer, registryAvailable, initializationComplete, registryOwner, walletAddress, projectAddress, projectsLocked]);

  // Form validation
  const isFormValid = useMemo(() => {
    if (!formData.name.trim()) return false;
    if (formData.name.length > 200) return false;
    if (formData.yt_vid && !isValidYouTubeUrl(formData.yt_vid)) return false;
    if (formData.proposal && !isValidUrl(formData.proposal)) return false;
    if (formData.socials.x && !isValidUrl(formData.socials.x)) return false;
    if (formData.socials.instagram && !isValidUrl(formData.socials.instagram)) return false;
    if (formData.socials.tiktok && !isValidUrl(formData.socials.tiktok)) return false;
    if (formData.socials.linkedin && !isValidUrl(formData.socials.linkedin)) return false;
    return true;
  }, [formData]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await submitMetadata(formData);
    } catch (err) {
      if (isUserRejectedError(err)) {
        return;
      }
      console.error('Failed to submit metadata:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit metadata');
    }
  };

  if (!walletAddress) {
    return (
      <div className="pob-page">
        <div className="pob-container pob-container--narrow">
          <div className="pob-pane">
            <p className="text-sm text-[var(--pob-text-muted)]">
              Please connect your wallet to edit project metadata.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="pob-page">
        <div className="pob-container pob-container--narrow">
          <div className="pob-pane">
            <p className="text-sm text-[var(--pob-text-muted)]">
              Project not found.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!canEdit.allowed) {
    return (
      <div className="pob-page">
        <div className="pob-container pob-container--narrow">
          <div style={{ marginBottom: '1rem' }}>
            <Link
              to={`/iteration/${iterationNumber}/project/${projectAddress}`}
              className="text-sm text-[var(--pob-primary)] hover:underline"
            >
              ← Back to Project
            </Link>
          </div>
          <div className="pob-pane">
            <p className="text-sm text-[var(--pob-text-muted)]">
              {canEdit.reason}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pob-page">
      <div className="pob-container pob-container--narrow">
        {/* Back link */}
        <div style={{ marginBottom: '1rem' }}>
          <Link
            to={`/iteration/${iterationNumber}/project/${projectAddress}`}
            className="text-sm text-[var(--pob-primary)] hover:underline"
          >
            ← Back to Project
          </Link>
        </div>

        {/* Page header */}
        <div className="pob-pane">
          <div className="pob-pane__heading">
            <h2 className="pob-pane__title">Edit Project</h2>
          </div>

          <p className="pob-pane__meta">Metadata Status</p>
          <div className="pob-stack--dense">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--pob-text-muted)]">Current CID:</span>
              <div className="flex items-center gap-2">
                <code className="pob-mono text-[var(--pob-text-muted)]">
                  {currentCID ? formatCID(currentCID) : 'Not set'}
                </code>
                {currentCID && currentConfirmations >= 5 && (
                  <span
                    className="pob-pill"
                    style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: 'rgb(16, 185, 129)',
                      border: '1px solid rgba(16, 185, 129, 0.3)'
                    }}
                  >
                    ✓ {currentConfirmations}/5
                  </span>
                )}
              </div>
            </div>

            {pendingCID && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--pob-text-muted)]">Pending Update:</span>
                <div className="flex items-center gap-2">
                  <a
                    href={getMetadataCidUrl(pendingCID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--pob-primary)] hover:underline"
                    title={`View via API: ${pendingCID}`}
                  >
                    📦 IPFS
                  </a>
                  {pendingTxHash && chainId && (
                    <a
                      href={getExplorerTxLink(chainId, pendingTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--pob-primary)] hover:underline"
                      title={`View transaction: ${pendingTxHash}`}
                    >
                      🔗 TX
                    </a>
                  )}
                  <span className="pob-pill flex items-center gap-1">
                    <ProgressSpinner size={16} progress={Math.min((pendingConfirmations / 5) * 100, 100)} />
                    {pendingConfirmations}/5
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="pob-pane__divider" />

          <form onSubmit={handleSubmit} className="pob-form">
            {/* Basic Info Section */}
            <div className="pob-form__section">
              <div className="pob-form__field">
                <label className="pob-form__label">
                  Project Name <span className="pob-form__required">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="pob-input"
                  placeholder="Enter project name"
                  maxLength={200}
                  required
                />
                <p className="pob-form__hint">
                  {formData.name.length}/200 characters
                </p>
              </div>
            </div>

            {/* Proposal Section */}
            <div className="pob-form__section">
              <h3 className="pob-form__section-title">Proposal</h3>

              <div className="pob-form__field">
                <label className="pob-form__label">YouTube Video URL</label>
                <input
                  type="text"
                  value={formData.yt_vid}
                  onChange={(e) => setFormData({ ...formData, yt_vid: e.target.value })}
                  className="pob-input"
                  placeholder="https://youtu.be/... or https://youtube.com/watch?v=..."
                />
                {formData.yt_vid && !isValidYouTubeUrl(formData.yt_vid) && (
                  <p className="pob-form__error">Invalid YouTube URL format</p>
                )}
              </div>

              <div className="pob-form__field">
                <label className="pob-form__label">Proposal URL</label>
                <input
                  type="text"
                  value={formData.proposal}
                  onChange={(e) => setFormData({ ...formData, proposal: e.target.value })}
                  className="pob-input"
                  placeholder="https://..."
                />
                {formData.proposal && !isValidUrl(formData.proposal) && (
                  <p className="pob-form__error">Invalid URL format</p>
                )}
              </div>
            </div>

            {/* Socials Section */}
            <div className="pob-form__section">
              <h3 className="pob-form__section-title">Socials</h3>

              {/* X (Twitter) - Featured/Primary */}
              <div className="pob-form__field pob-form__field--featured">
                <label className="pob-form__label">X (ex Twitter)</label>
                <input
                  type="text"
                  value={formData.socials.x}
                  onChange={(e) => setFormData({
                    ...formData,
                    socials: { ...formData.socials, x: e.target.value }
                  })}
                  className="pob-input pob-input--featured"
                  placeholder="https://x.com/yourproject"
                />
                {formData.socials.x && !isValidUrl(formData.socials.x) && (
                  <p className="pob-form__error">Invalid URL format</p>
                )}
              </div>

              {/* Other Socials - Grid Layout */}
              <div className="pob-form__socials-grid">
                <div className="pob-form__field">
                  <label className="pob-form__label">Instagram</label>
                  <input
                    type="text"
                    value={formData.socials.instagram}
                    onChange={(e) => setFormData({
                      ...formData,
                      socials: { ...formData.socials, instagram: e.target.value }
                    })}
                    className="pob-input"
                    placeholder="https://instagram.com/..."
                  />
                  {formData.socials.instagram && !isValidUrl(formData.socials.instagram) && (
                    <p className="pob-form__error">Invalid URL format</p>
                  )}
                </div>

                <div className="pob-form__field">
                  <label className="pob-form__label">TikTok</label>
                  <input
                    type="text"
                    value={formData.socials.tiktok}
                    onChange={(e) => setFormData({
                      ...formData,
                      socials: { ...formData.socials, tiktok: e.target.value }
                    })}
                    className="pob-input"
                    placeholder="https://tiktok.com/@..."
                  />
                  {formData.socials.tiktok && !isValidUrl(formData.socials.tiktok) && (
                    <p className="pob-form__error">Invalid URL format</p>
                  )}
                </div>

                <div className="pob-form__field">
                  <label className="pob-form__label">LinkedIn</label>
                  <input
                    type="text"
                    value={formData.socials.linkedin}
                    onChange={(e) => setFormData({
                      ...formData,
                      socials: { ...formData.socials, linkedin: e.target.value }
                    })}
                    className="pob-input"
                    placeholder="https://linkedin.com/company/..."
                  />
                  {formData.socials.linkedin && !isValidUrl(formData.socials.linkedin) && (
                    <p className="pob-form__error">Invalid URL format</p>
                  )}
                </div>
              </div>
            </div>

            {/* Error display */}
            {error && (
              <div className="pob-warning">
                <p className="text-xs">{error}</p>
              </div>
            )}

            {/* Form Actions */}
            <div className="pob-form__actions">
              <Link
                to={`/iteration/${iterationNumber}/project/${projectAddress}`}
                className="pob-button pob-button--outline"
                style={{ textDecoration: 'none' }}
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={isSubmitting || !isFormValid}
                className="pob-button"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProjectEditPage;
