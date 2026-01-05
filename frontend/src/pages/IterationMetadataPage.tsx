import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { JsonRpcSigner } from 'ethers';
import type { Iteration } from '~/interfaces';
import { useIterationMetadataManager, type IterationMetadataForm } from '~/hooks/useIterationMetadataManager';
import {
  getExplorerTxLink,
  getMetadataCidUrl,
  isUserRejectedError,
  isValidUrl,
} from '~/utils';
import MarkdownRenderer from '~/components/MarkdownRenderer';
import { ProgressSpinner } from '~/components/ProgressSpinner';

interface IterationMetadataPageProps {
  currentIteration: Iteration | null;
  walletAddress: string | null;
  chainId: number | null;
  signer: JsonRpcSigner | null;
  votingActive: boolean;
  isOwner: boolean; // Whether the connected wallet is the contract owner
}

const IterationMetadataPage = ({
  currentIteration,
  walletAddress,
  chainId,
  signer,
  votingActive,
  isOwner,
}: IterationMetadataPageProps) => {
  const { iterationNumber } = useParams<{ iterationNumber: string }>();
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<IterationMetadataForm>({
    name: '',
    description: '',
    link: '',
  });
  const [error, setError] = useState<string | null>(null);

  const {
    currentCID,
    pendingCID,
    pendingTxHash,
    pendingConfirmations,
    metadata,
    isSubmitting,
    submitMetadata,
  } = useIterationMetadataManager(
    currentIteration?.iteration || null,
    currentIteration?.round || null,
    chainId,
    currentIteration?.jurySC || null,
    signer,
    votingActive
  );

  // Redirect if no iteration found
  useEffect(() => {
    if (!currentIteration) {
      navigate('/');
    }
  }, [currentIteration, navigate]);

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

    // 4. Not the contract owner
    if (!isOwner) {
      return { allowed: false, reason: 'Only contract owner can update iteration metadata' };
    }

    return { allowed: true };
  }, [votingActive, signer, pendingConfirmations, isOwner]);

  // Form validation
  const isFormValid = useMemo(() => {
    // Name is required
    if (!formData.name.trim()) return false;

    // Name max length
    if (formData.name.length > 200) return false;

    // Link URL format (if provided)
    if (formData.link && !isValidUrl(formData.link)) return false;

    return true;
  }, [formData]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await submitMetadata(formData);
      setEditMode(false);
      setFormData({ name: '', description: '', link: '' });
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
        description: metadata.description || '',
        link: metadata.link || '',
      });
    } else if (currentIteration) {
      // No metadata yet, use iteration defaults
      setFormData({
        name: currentIteration.name || `Iteration #${currentIteration.iteration}`,
        description: '',
        link: currentIteration.link || '',
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
              Please connect your wallet to manage iteration metadata.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentIteration) {
    return (
      <div className="pob-page">
        <div className="pob-container">
          <div className="pob-pane">
            <p className="text-sm text-[var(--pob-text-muted)]">
              Loading iteration data...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const iterationName = metadata?.name || currentIteration.name || `Iteration #${currentIteration.iteration}`;
  const iterationDescription = metadata?.description || '';
  const iterationLink = metadata?.link || currentIteration.link;
  const currentTxHash = metadata?.txHash || null;
  const showCurrentLinks = Boolean(currentCID || currentTxHash);

  return (
    <div className="pob-page">
      <div className="pob-container" style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Back link */}
        <div style={{ marginBottom: '1rem' }}>
          <Link
            to={`/iteration/${iterationNumber}`}
            className="text-sm text-[var(--pob-primary)] hover:underline"
          >
            ← Back to Iteration {iterationNumber}
          </Link>
        </div>

        {/* Page header */}
        <div className="pob-pane">
          <div className="pob-pane__heading" style={{ marginBottom: '1rem' }}>
            <h2 className="pob-pane__title">Manage iteration</h2>
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

          {/* Iteration preview */}
          {!editMode ? (
            <div className="pob-fieldset space-y-3">
              <div className="space-y-2">
                <p className="text-lg font-semibold text-white">
                  {iterationName}
                  {currentIteration.round && ` - Round #${currentIteration.round}`}
                </p>
                {iterationDescription && (
                  <div style={{ marginTop: '1rem' }}>
                    <MarkdownRenderer content={iterationDescription} />
                  </div>
                )}
                {(iterationLink || showCurrentLinks) && (
                  <div className="flex flex-wrap items-center gap-2" style={{ marginTop: '1rem' }}>
                    {iterationLink && (
                      <a
                        href={iterationLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pob-button pob-button--compact"
                      >
                        Program brief
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
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--pob-text)]">
                  Iteration Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="pob-input"
                  placeholder="Enter iteration name"
                  maxLength={200}
                  required
                />
                <p className="text-xs text-[var(--pob-text-muted)]">
                  {formData.name.length}/200 characters
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--pob-text)]">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="pob-input"
                  placeholder="Enter round description (markdown supported)"
                  rows={6}
                  maxLength={2000}
                />
                <p className="text-xs text-[var(--pob-text-muted)]">
                  {formData.description.length}/2000 characters • Markdown supported
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--pob-text)]">
                  Link
                </label>
                <input
                  type="text"
                  value={formData.link}
                  onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                  className="pob-input"
                  placeholder="https://..."
                />
                {formData.link && !isValidUrl(formData.link) && (
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

              <div className="flex gap-2" style={{ marginTop: '1.5rem' }}>
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

export default IterationMetadataPage;
