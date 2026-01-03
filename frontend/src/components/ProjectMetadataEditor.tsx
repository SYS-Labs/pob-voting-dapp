import { useState, useMemo } from 'react';
import type { JsonRpcSigner } from 'ethers';
import { useProjectMetadataManager, type ProjectMetadataForm } from '~/hooks/useProjectMetadataManager';
import { formatCID, formatTxHash, getExplorerTxLink, isValidYouTubeUrl, isValidUrl } from '~/utils/format';

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

    return true;
  }, [formData]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await submitMetadata(formData);
      setEditMode(false);
      setFormData({ name: '', yt_vid: '', proposal: '' });
    } catch (err) {
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
              <span className="text-[var(--pob-text-muted)]">Pending CID:</span>
              <div className="flex items-center gap-2">
                <code className="pob-mono text-[var(--pob-primary)]">
                  {formatCID(pendingCID)}
                </code>
                <span className="pob-pill">⏳ {pendingConfirmations}/10</span>
              </div>
            </div>
          )}

          {/* Transaction Hash Link (if pending) */}
          {pendingTxHash && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--pob-text-muted)]">Transaction:</span>
              <a
                href={getExplorerTxLink(chainId, pendingTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="pob-mono text-[var(--pob-primary)] hover:underline"
              >
                {formatTxHash(pendingTxHash)}
              </a>
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
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--pob-text)]">
              Project Name *
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
            <p className="text-xs text-[var(--pob-text-muted)]">
              {formData.name.length}/200 characters
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--pob-text)]">
              YouTube Video URL
            </label>
            <input
              type="text"
              value={formData.yt_vid}
              onChange={(e) => setFormData({ ...formData, yt_vid: e.target.value })}
              className="pob-input"
              placeholder="https://youtu.be/... or https://youtube.com/watch?v=..."
            />
            {formData.yt_vid && !isValidYouTubeUrl(formData.yt_vid) && (
              <p className="text-xs" style={{ color: 'rgb(239, 68, 68)' }}>
                Invalid YouTube URL format
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--pob-text)]">
              Proposal Link
            </label>
            <input
              type="text"
              value={formData.proposal}
              onChange={(e) => setFormData({ ...formData, proposal: e.target.value })}
              className="pob-input"
              placeholder="https://..."
            />
            {formData.proposal && !isValidUrl(formData.proposal) && (
              <p className="text-xs" style={{ color: 'rgb(239, 68, 68)' }}>
                Invalid URL format
              </p>
            )}
          </div>

          {/* Error display */}
          {error && (
            <div className="pob-warning">
              <p className="text-xs">{error}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setError(null);
              }}
              disabled={isSubmitting}
              className="pob-button pob-button--outline flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isFormValid}
              className="pob-button flex-1"
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
