/**
 * AdminPanel Component
 *
 * Admin interface for registering and managing monitored threads
 * Requires wallet signature verification
 */

import { useState } from 'react';
import type { MonitoredThread } from '~/interfaces/forum';

interface AdminPanelProps {
  monitoredThreads: MonitoredThread[];
  onRegisterThread: (postId: string, signature: string, message: string) => Promise<void>;
  onToggleStatus: (
    threadId: number,
    postId: string,
    currentStatus: string,
    signature: string,
    message: string
  ) => Promise<void>;
  onRefresh: () => void;
  walletAddress: string | null;
  isAdminAddress: boolean;
}

const AdminPanel = ({
  monitoredThreads,
  onRegisterThread,
  onToggleStatus,
  onRefresh,
  walletAddress,
  isAdminAddress,
}: AdminPanelProps) => {
  const [newPostId, setNewPostId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRegisterThread = async () => {
    let postId = newPostId.trim();

    // Extract post ID from URL if user pasted a full URL
    const urlMatch = postId.match(/status\/(\d+)/);
    if (urlMatch) {
      postId = urlMatch[1];
    }

    if (!postId) {
      setError('Please enter a post ID or URL');
      return;
    }

    if (!walletAddress || !isAdminAddress) {
      setError('Must be admin to register threads');
      return;
    }

    if (!window.ethereum) {
      setError('No wallet detected');
      return;
    }

    const message = `Register thread ${postId} at ${new Date().toISOString()}`;

    try {
      setStatus('Requesting signature...');
      setError(null);

      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      });

      setStatus('Registering thread...');
      await onRegisterThread(postId, signature as string, message);

      setStatus('✅ Thread registered');
      setNewPostId('');
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    }
  };

  const handleToggleStatus = async (thread: MonitoredThread) => {
    if (!walletAddress || !isAdminAddress) {
      setError('Must be admin to update threads');
      return;
    }

    if (!window.ethereum) {
      setError('No wallet detected');
      return;
    }

    const newStatus = thread.status === 'active' ? 'paused' : 'active';
    const message = `Update thread ${thread.post_id} to ${newStatus} at ${new Date().toISOString()}`;

    try {
      setError(null);

      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      });

      await onToggleStatus(thread.id, thread.post_id, thread.status, signature as string, message);
      setStatus(`✅ Thread ${newStatus}`);
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const shortenAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <section className="pob-forum-admin">
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="pob-pane__heading text-lg">Admin Panel</h3>
            {walletAddress && (
              <span className={`pob-pill pob-pill--small ${isAdminAddress ? '' : 'pob-pill--danger'}`}>
                {isAdminAddress ? 'Admin' : 'Not Admin'}: {shortenAddress(walletAddress)}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--pob-text-muted)]">
            Register new X posts to index. The indexer will automatically poll these threads.
          </p>
        </div>

        {/* Register new thread */}
        <div className="flex gap-2">
          <input
            type="text"
            className="pob-input flex-1"
            placeholder="X Post ID or URL"
            value={newPostId}
            onChange={(e) => setNewPostId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRegisterThread()}
          />
          <button className="pob-button" onClick={handleRegisterThread}>
            Register Thread
          </button>
        </div>

        {status && (
          <div className="text-sm text-[var(--pob-primary)]">{status}</div>
        )}

        {error && (
          <div className="text-sm text-red-400">{error}</div>
        )}

        {/* Monitored threads list */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-medium">
              Registered Threads ({monitoredThreads.length})
            </h4>
            <button className="pob-button pob-button--outline pob-button--small" onClick={onRefresh}>
              Refresh
            </button>
          </div>

          {monitoredThreads.length === 0 ? (
            <p className="text-sm text-[var(--pob-text-muted)]">
              No threads registered yet. Register one above.
            </p>
          ) : (
            <div className="space-y-2">
              {monitoredThreads.map((thread) => (
                <div
                  key={thread.id}
                  className="pob-card flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{thread.post_id}</span>
                    <span
                      className={`pob-pill pob-pill--small ${
                        thread.status === 'active'
                          ? ''
                          : thread.status === 'paused'
                          ? 'pob-pill--warning'
                          : 'pob-pill--muted'
                      }`}
                    >
                      {thread.status}
                    </span>
                  </div>
                  {thread.status !== 'archived' && (
                    <button
                      className="pob-button pob-button--outline pob-button--small"
                      onClick={() => handleToggleStatus(thread)}
                    >
                      {thread.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default AdminPanel;
