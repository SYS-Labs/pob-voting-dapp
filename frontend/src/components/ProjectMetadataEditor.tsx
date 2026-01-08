import { useState, useMemo } from 'react';
import type { JsonRpcSigner } from 'ethers';
import { useProjectMetadataManager, type ProjectMetadataForm } from '~/hooks/useProjectMetadataManager';
import { formatCID, getExplorerTxLink, isValidYouTubeUrl, isValidUrl } from '~/utils/format';
import { getMetadataCidUrl } from '~/utils/metadata-api';
import { isUserRejectedError } from '~/utils/errors';
import { ProgressSpinner } from './ProgressSpinner';

interface ProjectMetadataEditorProps {
  projectAddress: string;
  chainId: number;
  contractAddress: string;
  votingActive: boolean;
  signer: JsonRpcSigner | null;
  walletAddress: string | null;
}

const ProjectMetadataEditor = ({
  projectAddress,
  chainId,
  contractAddress,
  votingActive,
  signer,
  walletAddress,
}: ProjectMetadataEditorProps) => {
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<ProjectMetadataForm>({
    name: '',
    yt_vid: '',
    proposal: '',
    socials: { x: '', instagram: '', tiktok: '', linkedin: '' },
  });
  const [error, setError] = useState<string | null>(null);

  const {
    currentCID,
    currentConfirmations,
    pendingCID,
    pendingTxHash,
    pendingConfirmations,
    metadata,
    isSubmitting,
    submitMetadata,
  } = useProjectMetadataManager(
    projectAddress,
    chainId,
    contractAddress,
    signer,
    votingActive
  );

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

    // 3. Pending transaction with < 1 confirmation
    if (pendingConfirmations > 0 && pendingConfirmations < 1) {
      return {
        allowed: false,
        reason: `Wait for 1 confirmation (currently ${pendingConfirmations}/10)`
      };
    }

    // 4. Wallet address doesn't match project address
    if (walletAddress?.toLowerCase() !== projectAddress.toLowerCase()) {
      return { allowed: false, reason: 'Only project owner can update' };
    }

    return { allowed: true };
  }, [votingActive, signer, pendingConfirmations, walletAddress, projectAddress]);

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
    }
    setEditMode(true);
  };

  return (
    <div className="pob-fieldset" style={{
      marginTop: '1rem',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      paddingTop: '1rem'
    }}>
      <p className="text-sm font-semibold text-[var(--pob-primary)]" style={{ marginBottom: '0.75rem' }}>
        Manage Project Metadata
      </p>

      {!editMode ? (
        // DISPLAY MODE
        <div className="space-y-2">
          {/* Current CID */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--pob-text-muted)]">Current CID:</span>
            <div className="flex items-center gap-2">
              <code className="pob-mono text-[var(--pob-text-muted)]">
                {currentCID ? formatCID(currentCID) : 'Not set'}
              </code>
              {currentCID && currentConfirmations >= 10 && (
                <span className="pob-pill" style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: 'rgb(16, 185, 129)',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}>
                  ✓ {currentConfirmations}/10
                </span>
              )}
            </div>
          </div>

          {/* Pending CID (if exists) */}
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
                {pendingTxHash && (
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
                  <ProgressSpinner size={16} progress={(pendingConfirmations / 10) * 100} />
                  {pendingConfirmations}/10
                </span>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="pob-warning" style={{ marginTop: '0.5rem' }}>
              <p className="text-xs">{error}</p>
            </div>
          )}

          {/* Action button */}
          <button
            type="button"
            onClick={handleEnterEditMode}
            disabled={!canEdit.allowed || isSubmitting}
            className="pob-button pob-button--outline pob-button--compact pob-button--full"
            title={canEdit.reason}
            style={{ marginTop: '0.75rem' }}
          >
            {votingActive
              ? 'Locked (Voting Active)'
              : !canEdit.allowed
                ? canEdit.reason
                : 'Update Metadata'}
          </button>
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

            {/* Other Socials */}
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
              {isSubmitting ? 'Submitting...' : 'Submit to IPFS'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ProjectMetadataEditor;
