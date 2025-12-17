/**
 * ForumPage Component
 *
 * Main page for X/Twitter thread forum functionality
 * Displays indexed threads, thread details, and admin management interface
 */

import { useEffect, useState, useMemo } from 'react';
import ThreadListPanel from '~/components/forum/ThreadListPanel';
import ThreadDetailPanel from '~/components/forum/ThreadDetailPanel';
import AdminPanel from '~/components/forum/AdminPanel';
import {
  fetchThreads,
  fetchThreadDetail,
  fetchMonitoredThreads,
  registerThread,
  updateThreadStatus,
} from '~/utils/forumApi';
import type { ThreadSummary, ThreadPost, MonitoredThread } from '~/interfaces/forum';

// Get environment variables
const configuredAdmin = (import.meta.env.VITE_FORUM_ADMIN_ADDRESS || '').toLowerCase();
const contractAddress = import.meta.env.VITE_FORUM_CONTRACT_ADDRESS || '';
const explorerUrl = import.meta.env.VITE_FORUM_EXPLORER_URL || 'https://explorer.tanenbaum.io';

interface ForumPageProps {
  walletAddress: string | null;
}

const ForumPage = ({ walletAddress }: ForumPageProps) => {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const [monitoredThreads, setMonitoredThreads] = useState<MonitoredThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingThreadDetail, setLoadingThreadDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if connected wallet is admin
  const isAdminConnected = useMemo(() => {
    if (!walletAddress || !configuredAdmin) return false;
    return walletAddress.toLowerCase() === configuredAdmin;
  }, [walletAddress]);

  // Load threads on mount
  useEffect(() => {
    void loadThreads();
    void loadMonitoredThreads();
  }, []);

  // Load thread detail when selection changes
  useEffect(() => {
    if (selectedConversation) {
      void loadThreadDetail(selectedConversation);
    }
  }, [selectedConversation]);

  async function loadThreads() {
    try {
      setLoadingThreads(true);
      const fetchedThreads = await fetchThreads();
      setThreads(fetchedThreads);

      // Auto-select first thread if none selected
      if (!selectedConversation && fetchedThreads.length > 0) {
        setSelectedConversation(fetchedThreads[0].conversationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingThreads(false);
    }
  }

  async function loadThreadDetail(conversationId: string) {
    try {
      setLoadingThreadDetail(true);
      const fetchedPosts = await fetchThreadDetail(conversationId);
      setPosts(fetchedPosts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingThreadDetail(false);
    }
  }

  async function loadMonitoredThreads() {
    try {
      const fetchedMonitoredThreads = await fetchMonitoredThreads();
      setMonitoredThreads(fetchedMonitoredThreads);
    } catch (err) {
      // Silent fail for monitored threads - not critical for viewing
      console.error('Failed to load monitored threads:', err);
    }
  }

  async function handleRegisterThread(postId: string, signature: string, message: string) {
    const thread = await registerThread(postId, signature, message);
    setMonitoredThreads((prev) => [...prev, thread]);
    await loadMonitoredThreads();
  }

  async function handleToggleStatus(
    threadId: number,
    _postId: string,
    currentStatus: string,
    signature: string,
    message: string
  ) {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    await updateThreadStatus(threadId, newStatus as 'active' | 'paused' | 'archived', signature, message);
    await loadMonitoredThreads();
  }

  const shortenAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="pob-stack" id="forum-page">
      {/* Hero section */}
      <section className="pob-pane">
        <div className="space-y-4">
          <div>
            <h2 className="pob-pane__title text-3xl">Forum</h2>
            <p className="text-sm text-[var(--pob-primary)] mt-1">
              X/Twitter threads indexed on-chain with AI responses
            </p>
          </div>

          {/* Status badges */}
          <div className="flex gap-2 flex-wrap">
            {contractAddress && (
              <a
                href={`${explorerUrl}/address/${contractAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="pob-pill pob-pill--small hover:opacity-80 transition-opacity"
                style={{ textDecoration: 'none' }}
              >
                Contract: {shortenAddress(contractAddress)} →
              </a>
            )}
            {walletAddress && (
              <span className={`pob-pill pob-pill--small ${isAdminConnected ? '' : 'pob-pill--warning'}`}>
                Wallet: {shortenAddress(walletAddress)} {isAdminConnected ? '(Admin)' : ''}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Desktop layout: thread list + detail side-by-side */}
      <div className="pob-main--desktop">
        <ThreadListPanel
          threads={threads}
          selectedConversation={selectedConversation}
          onSelectThread={setSelectedConversation}
          loading={loadingThreads}
          onRefresh={loadThreads}
        />

        <ThreadDetailPanel
          posts={posts}
          loading={loadingThreadDetail}
          explorerUrl={explorerUrl}
        />
      </div>

      {/* Admin panel (conditional) */}
      {isAdminConnected && (
        <AdminPanel
          monitoredThreads={monitoredThreads}
          onRegisterThread={handleRegisterThread}
          onToggleStatus={handleToggleStatus}
          onRefresh={loadMonitoredThreads}
          walletAddress={walletAddress}
          isAdminAddress={isAdminConnected}
        />
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 pob-card bg-red-900/90 text-white p-4 max-w-md">
          <div className="flex items-start gap-2">
            <span className="text-red-400">⚠</span>
            <div className="flex-1">
              <p className="text-sm">{error}</p>
              <button
                className="text-xs underline mt-1 opacity-75 hover:opacity-100"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ForumPage;
