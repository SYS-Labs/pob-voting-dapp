import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { JsonRpcSigner } from 'ethers';
import type { Project } from '~/interfaces';
import { useProjectMetadataManager, type ProjectMetadataForm } from '~/hooks/useProjectMetadataManager';
import {
  formatAddress,
  getExplorerTxLink,
  getMetadataCidUrl,
  getYouTubeEmbedUrl,
  isUserRejectedError,
  isValidYouTubeUrl,
  isValidUrl,
} from '~/utils';
import MarkdownRenderer from '~/components/MarkdownRenderer';
import { ProgressSpinner } from '~/components/ProgressSpinner';

interface ProjectMetadataPageProps {
  projects: Project[];
  walletAddress: string | null;
  chainId: number | null;
  contractAddress: string | null;
  signer: JsonRpcSigner | null;
  votingActive: boolean;
}

const ProjectMetadataPage = ({
  projects,
  walletAddress,
  chainId,
  contractAddress,
  signer,
  votingActive,
}: ProjectMetadataPageProps) => {
  const { iterationNumber } = useParams<{ iterationNumber: string }>();
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<ProjectMetadataForm>({
    name: '',
    yt_vid: '',
    proposal: '',
    socials: { x: '', instagram: '', tiktok: '', linkedin: '' },
  });
  const [error, setError] = useState<string | null>(null);

  // Find the project for the connected wallet
  const project = useMemo(() => {
    if (!walletAddress) return null;
    return projects.find(p => p.address.toLowerCase() === walletAddress.toLowerCase()) || null;
  }, [projects, walletAddress]);

  const {
    currentCID,
    pendingCID,
    pendingTxHash,
    pendingConfirmations,
    metadata,
    isSubmitting,
    submitMetadata,
  } = useProjectMetadataManager(
    project?.address || null,
    chainId,
    contractAddress,
    signer,
    votingActive
  );

  // Redirect if not a project or no project found
  useEffect(() => {
    if (!project && walletAddress) {
      // Wallet connected but not a project - redirect to iteration page
      navigate(`/iteration/${iterationNumber}`);
    }
  }, [project, walletAddress, iterationNumber, navigate]);

  // Determine if editing is allowed
  const canEdit = useMemo(() => {
    // 1. Voting is active
    if (votingActive) {
      return { allowed: false, reason: 'Metadata locked during voting' };
    }

    // 2. Wallet not connected
    if (!signer) {
      return { allowed: false, reason: 'Connect wallet to update metadata' };
    }

    // 3. Pending transaction with < 10 confirmations
    if (pendingTxHash && pendingConfirmations < 10) {
      return { allowed: false };
    }

    // 4. Wallet address doesn't match project address
    if (walletAddress?.toLowerCase() !== project?.address.toLowerCase()) {
      return { allowed: false, reason: 'Only project owner can update' };
    }

    return { allowed: true };
  }, [votingActive, signer, pendingConfirmations, walletAddress, project]);

  // Form validation
  const isFormValid = useMemo(() => {
    // Name is required
    if (!formData.name.trim()) return false;

    // Name max length
    if (formData.name.length > 200) return false;

    // YouTube URL format (if provided)
    if (formData.yt_vid && !isValidYouTubeUrl(formData.yt_vid)) return false;

    // Proposal URL format (if provided)
    if (formData.proposal && !isValidUrl(formData.proposal)) return false;

    // Social URLs format (if provided)
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
      setEditMode(false);
      setFormData({ name: '', yt_vid: '', proposal: '', socials: { x: '', instagram: '', tiktok: '', linkedin: '' } });
    } catch (err) {
      if (isUserRejectedError(err)) {
        return;
      }
      console.error('Failed to submit metadata:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit metadata');
    }
  };

  // Handle entering edit mode - pre-fill with current metadata
  const handleEnterEditMode = () => {
    if (metadata) {
      setFormData({
        name: metadata.name || '',
        yt_vid: metadata.yt_vid || '',
        proposal: metadata.proposal || '',
        socials: {
          x: metadata.socials?.x || '',
          instagram: metadata.socials?.instagram || '',
          tiktok: metadata.socials?.tiktok || '',
          linkedin: metadata.socials?.linkedin || '',
        },
      });
    } else if (project) {
      // No metadata yet, use project defaults
      setFormData({
        name: project.metadata?.name || `Project #${project.id}`,
        yt_vid: project.metadata?.yt_vid || '',
        proposal: project.metadata?.proposal || '',
        socials: {
          x: project.metadata?.socials?.x || '',
          instagram: project.metadata?.socials?.instagram || '',
          tiktok: project.metadata?.socials?.tiktok || '',
          linkedin: project.metadata?.socials?.linkedin || '',
        },
      });
    }
    setEditMode(true);
  };

  if (!walletAddress) {
    return (
      <div className="pob-page">
        <div className="pob-container">
          <div className="pob-pane">
            <p className="text-sm text-[var(--pob-text-muted)]">
              Please connect your wallet to manage project metadata.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="pob-page">
        <div className="pob-container">
          <div className="pob-pane">
            <p className="text-sm text-[var(--pob-text-muted)]">
              Loading project data...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const projectName = metadata?.name || project.metadata?.name || `Project #${project.id}`;
  const embedUrl = getYouTubeEmbedUrl(metadata?.yt_vid || project.metadata?.yt_vid || null);
  const proposalUrl = metadata?.proposal || project.metadata?.proposal;
  const currentTxHash = metadata?.txHash || null;
  const showCurrentLinks = Boolean(currentCID || currentTxHash);

  return (
    <div className="pob-page">
      <div className="pob-container" style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Back link */}
        <div style={{ marginBottom: '1rem' }}>
          <Link
            to={`/iteration/${iterationNumber}/project/${project?.address}`}
            className="text-sm text-[var(--pob-primary)] hover:underline"
          >
            ← Back to Project
          </Link>
        </div>

        {/* Page header */}
        <div className="pob-pane">
          <div className="pob-pane__heading" style={{ marginBottom: '1rem' }}>
            <h2 className="pob-pane__title">Manage my project</h2>
            {!editMode && (
              <button
                type="button"
                onClick={() => {
                  if (!canEdit.allowed || isSubmitting) return;
                  handleEnterEditMode();
                }}
                disabled={!canEdit.allowed || isSubmitting}
                className="pob-button pob-button--compact"
                style={{
                  opacity: !canEdit.allowed || isSubmitting ? 0.6 : 1,
                  cursor: !canEdit.allowed || isSubmitting ? 'not-allowed' : 'pointer',
                }}
                title={!canEdit.allowed && canEdit.reason ? canEdit.reason : undefined}
                aria-disabled={!canEdit.allowed || isSubmitting}
              >
                Edit
              </button>
            )}
          </div>

          {/* Project preview card */}
          {!editMode ? (
            <div className="pob-fieldset space-y-3">
              <div className="space-y-2">
                <p className="text-lg font-semibold text-white">{projectName}</p>
                <p className="pob-mono text-xs text-[var(--pob-text-muted)]">
                  {formatAddress(project.address)}
                </p>
                <MarkdownRenderer content={metadata?.description || project.metadata?.description} />
                {embedUrl ? (
                  <div className="pob-video" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                    <iframe
                      src={embedUrl}
                      title={`Project video for ${projectName}`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                ) : null}
                {(proposalUrl || showCurrentLinks) && (
                  <div className="flex flex-wrap items-center gap-2" style={{ marginTop: '1rem' }}>
                    {proposalUrl && (
                      <a
                        href={proposalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pob-button pob-button--compact"
                      >
                        Read full proposal
                      </a>
                    )}
                    {showCurrentLinks && (
                      <div className="flex items-center text-xs ml-auto" style={{ gap: '0.75rem' }}>
                        {currentCID && (
                          <a
                            href={getMetadataCidUrl(currentCID)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--pob-primary)]"
                            style={{ textDecoration: 'none' }}
                            title={`View via API: ${currentCID}`}
                          >
                            📦 IPFS
                          </a>
                        )}
                        {currentTxHash && chainId && (
                          <a
                            href={getExplorerTxLink(chainId, currentTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--pob-primary)]"
                            style={{ textDecoration: 'none' }}
                            title={`View transaction: ${currentTxHash}`}
                          >
                            🔗 TX
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Metadata status */}
              {(pendingCID || !canEdit.allowed) && (
                <div
                  style={{
                    marginTop: '1.5rem',
                    paddingTop: '1rem',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {/* Pending CID (if exists) */}
                  {pendingCID && (
                    <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                      <p className="text-sm font-semibold text-[var(--pob-primary)]">
                        Update status
                      </p>
                      <div className="flex items-center text-xs" style={{ gap: '0.75rem' }}>
                        <a
                          href={getMetadataCidUrl(pendingCID)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--pob-primary)]"
                          style={{ textDecoration: 'none' }}
                          title={`View via API: ${pendingCID}`}
                        >
                          📦 IPFS
                        </a>
                        {pendingTxHash && chainId && (
                          <a
                            href={getExplorerTxLink(chainId, pendingTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--pob-primary)]"
                            style={{ textDecoration: 'none' }}
                            title={`View transaction: ${pendingTxHash}`}
                          >
                            🔗 TX
                          </a>
                        )}
                        <span className="pob-pill flex items-center gap-1">
                          <ProgressSpinner size={16} progress={(pendingConfirmations / 10) * 100} />
                          {pendingConfirmations}/10
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Edit disabled reason */}
                  {!canEdit.allowed && canEdit.reason && (
                    <p className="text-xs text-[var(--pob-text-muted)] italic" style={{ marginTop: '0.75rem' }}>
                      {canEdit.reason}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // EDIT MODE
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
                <button
                  type="button"
                  onClick={() => {
                    setEditMode(false);
                    setError(null);
                  }}
                  disabled={isSubmitting}
                  className="pob-button pob-button--outline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !isFormValid}
                  className="pob-button"
                >
                  {isSubmitting ? 'Submitting...' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectMetadataPage;
